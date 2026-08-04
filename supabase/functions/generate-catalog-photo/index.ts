// ═══════════════════════════════════════════════════════════════════════════
// generate-catalog-photo — foto de estúdio do produto em uma cor da cartela.
//
// Recebe a foto CRUA (bucket público reference-images) + cor alvo, chama o
// Google Gemini (nano banana — gemini-3.1-flash-image) com prompt que
// preserva solado e peças metálicas, salva o PNG em reference-images/catalog/
// e registra em catalog_photos. Segurança espelha a recolor-image: JWT +
// papel admin/gerente (gasto de créditos de IA), SSRF allowlist, validação.
//
// Secrets: GEMINI_API_KEY (obrigatório) · GEMINI_IMAGE_MODEL (opcional,
// default gemini-3.1-flash-image). Trocado de OpenAI pra Gemini em 02/08/2026
// a pedido do dono (chave OpenAI de revendedor não funcionou).
//
// 04/08/2026: a chamada passou pro _shared/gemini.ts, que centraliza a política
// de erro das 4 funções de IA (ADR 0002). GEMINI_IMAGE_MODEL agora vale também
// pra recolor-image — um secret controla as duas funções de imagem.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  callGemini,
  extractInlineImage,
  geminiErrorResponse,
  getGeminiApiKey,
  imageModels,
} from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const PROMPT_TEMPLATE = (colorName: string, colorHex: string, extra: string) => `
Professional studio product photography of this exact sandal/shoe on a solid clean white background.
The item is floating at a dynamic diagonal 45-degree angle to showcase the side profile and top details simultaneously.
Soft, realistic drop shadow underneath to create depth. High-end commercial lighting, sharp focus, minimalist aesthetic, clean lines.

Change ONLY the color of the upper/straps to "${colorName}" (hex ${colorHex}).
CRITICAL RULES — do not violate:
- Keep the sole (solado) EXACTLY as in the original photo: same structure, material, color and tone. Do not recolor the sole.
- Keep ALL metallic pieces, buckles, ornaments and decorative stones EXACTLY as in the original: same shape, position, colors and tones.
- Keep the exact same model, shape, proportions, stitching and construction. It must look like the same physical product, only in a different strap color.
${extra ? `Additional instructions: ${extra}` : ""}`.trim();

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    // --- Autenticação ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);

    // --- Autorização: só admin/gerente gastam créditos de IA ---
    const userId = claimsData.claims.sub;
    const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    const { data: roles, error: rolesError } = await adminClient
      .from("user_roles").select("role").eq("user_id", userId);
    if (rolesError) return json({ error: "Falha ao validar permissão" }, 500);
    const allowedRoles = new Set(["admin", "gerente"]);
    if (!(roles || []).some((r: { role: string }) => allowedRoles.has(r.role))) {
      return json({ error: "Apenas administradores podem gerar fotos de catálogo." }, 403);
    }

    // --- Inputs ---
    const { imageUrl, colorName, colorHex, referenceId, referenceCode, extraInstructions } = await req.json();
    if (!imageUrl || !colorName || !colorHex) {
      return json({ error: "imageUrl, colorName e colorHex são obrigatórios" }, 400);
    }
    if (typeof colorName !== "string" || colorName.length > 60 ||
        !/^[\w\s\-\/()áéíóúàâêîôûãõçÁÉÍÓÚÀÂÊÎÔÛÃÕÇ#,.]+$/.test(colorName)) {
      return json({ error: "colorName inválido." }, 400);
    }
    if (typeof colorHex !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(colorHex)) {
      return json({ error: "colorHex inválido (use #RRGGBB)." }, 400);
    }
    const extra = typeof extraInstructions === "string"
      ? extraInstructions.slice(0, 1000).replace(/[<>]/g, "")
      : "";

    // --- SSRF: só HTTPS do próprio projeto, bucket público de imagens ---
    let parsedUrl: URL;
    try { parsedUrl = new URL(imageUrl); } catch { return json({ error: "imageUrl inválida" }, 400); }
    const allowedHost = (() => { try { return new URL(supabaseUrl).hostname; } catch { return ""; } })();
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== allowedHost) {
      return json({ error: "imageUrl deve ser HTTPS do domínio do projeto." }, 400);
    }
    if (!parsedUrl.pathname.startsWith("/storage/v1/object/public/reference-images/")) {
      return json({ error: "imageUrl deve apontar pro bucket público reference-images." }, 400);
    }
    if (parsedUrl.search) return json({ error: "imageUrl não pode conter query string." }, 400);

    // --- Baixa a foto crua e converte pra base64 ---
    const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgResp.ok) throw new Error(`Falha ao baixar imagem: ${imgResp.status}`);
    const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
    const imgBuffer = await imgResp.arrayBuffer();
    if (imgBuffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`Imagem muito grande (${imgBuffer.byteLength} bytes). Máximo: 15 MB.`);
    }
    const contentType = imgResp.headers.get("content-type") || "image/jpeg";
    const uint8 = new Uint8Array(imgBuffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
    }
    const base64Image = btoa(binary);

    // --- Google Gemini (nano banana) ---
    console.log(`Gerando cor ${colorName} (${colorHex}) ref=${referenceCode || "-"}`);
    const aiData = await callGemini({
      apiKey: getGeminiApiKey(),
      models: imageModels(),
      modality: "image",
      label: "generate-catalog-photo",
      timeoutMs: 120_000,
      body: {
        contents: [{
          parts: [
            { inlineData: { mimeType: contentType, data: base64Image } },
            { text: PROMPT_TEMPLATE(colorName, colorHex, extra) },
          ],
        }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      },
    });

    const image = extractInlineImage(aiData);
    if (!image) {
      console.error("Sem imagem na resposta:", JSON.stringify(aiData).slice(0, 400));
      return json({ error: "A IA não retornou imagem. Tente novamente." }, 502);
    }
    const b64 = image.base64;
    const outMime = image.mimeType;

    // --- Upload no Storage + registro ---
    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const ext = outMime.includes("png") ? "png" : outMime.includes("webp") ? "webp" : "jpg";
    const fileName = `catalog/${slug(referenceCode || "ref")}-${slug(colorName)}-${Date.now()}.${ext}`;

    const { error: uploadError } = await adminClient.storage
      .from("reference-images")
      .upload(fileName, bytes, { contentType: outMime, upsert: true });
    if (uploadError) throw new Error(`Erro ao salvar imagem: ${uploadError.message}`);

    const { data: { publicUrl } } = adminClient.storage.from("reference-images").getPublicUrl(fileName);

    const { data: row, error: insertError } = await adminClient
      .from("catalog_photos")
      .insert({
        reference_id: referenceId || null,
        reference_code: referenceCode || null,
        color_nome: colorName,
        color_hex: colorHex,
        image_url: publicUrl,
        source_image_url: imageUrl,
        created_by: userId,
      })
      .select()
      .single();
    if (insertError) {
      console.error("Insert catalog_photos:", insertError);
      return json({ url: publicUrl, id: null, warning: "Imagem gerada, mas falhou o registro no banco." });
    }

    return json({ url: publicUrl, id: row.id, colorName });
  } catch (e) {
    console.error("generate-catalog-photo error:", e);
    return geminiErrorResponse(e, corsHeaders);
  }
});

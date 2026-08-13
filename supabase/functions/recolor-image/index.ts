import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    // --- Authentication check ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authorization: only admin/manager roles can spend AI credits.
    // Without this, any authenticated user could drain GEMINI_API_KEY budget.
    const userId = claimsData.claims.sub;
    const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    const { data: roles, error: rolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (rolesError) {
      return new Response(
        JSON.stringify({ error: "Falha ao validar permissão" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const allowedRoles = new Set(["admin", "gerente"]);
    const hasAccess = (roles || []).some((r: any) => allowedRoles.has(r.role));
    if (!hasAccess) {
      return new Response(
        JSON.stringify({ error: "Apenas administradores podem usar o recurso de recolorização." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { imageUrl, targetColor, referenceCode } = await req.json();

    if (!imageUrl || !targetColor) {
      return new Response(
        JSON.stringify({ error: "imageUrl and targetColor are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate targetColor to prevent prompt injection via crafted color strings.
    if (typeof targetColor !== "string" || targetColor.length > 100 || !/^[\w\s\-\/()áéíóúàâêîôûãõçÁÉÍÓÚÀÂÊÎÔÛÃÕÇ#,.]+$/.test(targetColor)) {
      return new Response(
        JSON.stringify({ error: "targetColor inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- SSRF protection: only allow HTTPS from trusted hosts ---
    // Deriva do SUPABASE_URL do ambiente — antes estava hardcoded no PROJETO
    // MORTO (qrdvwoijghmgugejponz), então toda imagem do projeto atual era
    // rejeitada e a recolorização ficava quebrada. Auditoria 2026-06-14, Área 8.
    const ALLOWED_HOSTS = (() => {
      try { return [new URL(supabaseUrl).hostname]; }
      catch { return [] as string[]; }
    })();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid imageUrl" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (parsedUrl.protocol !== "https:" || !ALLOWED_HOSTS.includes(parsedUrl.hostname)) {
      return new Response(
        JSON.stringify({ error: "imageUrl must be an HTTPS URL from a trusted domain" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Restrict to known public image buckets to prevent SSRF exfiltration of
    // private storage objects or signed URLs through the AI gateway.
    const ALLOWED_PATH_PREFIXES = [
      "/storage/v1/object/public/reference-images/",
      "/storage/v1/object/public/technical-sheets/",
      "/storage/v1/object/public/product-photos/",
    ];
    if (!ALLOWED_PATH_PREFIXES.some((p) => parsedUrl.pathname.startsWith(p))) {
      return new Response(
        JSON.stringify({ error: "imageUrl deve apontar para um bucket público de imagens." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (parsedUrl.search) {
      return new Response(
        JSON.stringify({ error: "imageUrl não pode conter query string." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY não configurada nos secrets da função.");
    const model = Deno.env.get("GEMINI_IMAGE_MODEL") || "gemini-3.1-flash-image";

    // Download the original image and convert to base64
    console.log("Downloading image:", imageUrl);
    const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgResp.ok) throw new Error(`Failed to download image: ${imgResp.status}`);

    const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    const contentLength = parseInt(imgResp.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_IMAGE_BYTES) {
      throw new Error(`Imagem muito grande (${contentLength} bytes). Máximo permitido: 10 MB.`);
    }
    const imgBuffer = await imgResp.arrayBuffer();
    if (imgBuffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`Imagem muito grande (${imgBuffer.byteLength} bytes). Máximo permitido: 10 MB.`);
    }
    const uint8 = new Uint8Array(imgBuffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
    }
    const base64Image = btoa(binary);

    const contentType = imgResp.headers.get("content-type") || "image/jpeg";
    console.log(`Enviando recoloração para Gemini: cor=${targetColor}, modelo=${model}`);

    // Chamada direta à conta Google: não passa pelo AI Gateway da Lovable.
    const aiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: contentType, data: base64Image } },
              { text: `Change the color of this shoe/footwear to "${targetColor}". Keep the exact same shoe design, shape, style, details, textures and proportions. Only change the main color to ${targetColor}. Keep the background and lighting the same. The result must look like a professional product photo.` },
            ],
          }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        }),
        signal: AbortSignal.timeout(120_000),
      }
    );

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("Gemini error:", aiResp.status, errText.slice(0, 800));

      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns minutos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResp.status === 401 || aiResp.status === 403) {
        return new Response(
          JSON.stringify({ error: "A chave Gemini não tem permissão para este modelo. Confira GEMINI_API_KEY e o faturamento da conta Google." }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Erro ao processar imagem com IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResp.json();
    console.log("AI response received, extracting image...");

    // Gemini devolve a imagem codificada em inlineData.
    const parts = aiData?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part: { inlineData?: { data?: string } }) => part.inlineData?.data);
    const resultBase64: string | null = imagePart?.inlineData?.data || null;
    const resultMimeType: string = imagePart?.inlineData?.mimeType || "image/png";

    if (!resultBase64) {
      console.error("No image in AI response:", JSON.stringify(aiData).slice(0, 500));
      return new Response(
        JSON.stringify({ error: "A IA não retornou uma imagem. Tente novamente." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload to Supabase Storage
    const ext = resultMimeType.includes("png") ? "png" : "jpg";
    const colorSlug = targetColor.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const refSlug = (referenceCode || "ref").toLowerCase().replace(/[^a-z0-9]/g, "-");
    const fileName = `recolor/${refSlug}-${colorSlug}-${Date.now()}.${ext}`;

    // Decode base64 to Uint8Array
    const binaryStr = atob(resultBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error: uploadError } = await supabase.storage
      .from("reference-images")
      .upload(fileName, bytes, { contentType: resultMimeType, upsert: true });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error(`Erro ao salvar imagem: ${uploadError.message}`);
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("reference-images").getPublicUrl(fileName);

    console.log("Recolored image uploaded:", publicUrl);

    return new Response(
      JSON.stringify({ url: publicUrl, color: targetColor }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("recolor-image error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Erro desconhecido",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  callGemini,
  extractText,
  geminiErrorResponse,
  getGeminiApiKey,
  textModels,
} from "../_shared/gemini.ts";

// Suggest-ncm: chama a API do Google Gemini direto (sem Lovable middleware).
// Migrado 2026-05-19 — Lovable AI Gateway descontinuado quando projeto saiu
// pra Vercel. A chave fica em GEMINI_API_KEY (secret do Supabase).
//
// 04/08/2026: chamada movida pro _shared/gemini.ts e modelo deixou de ser
// hardcoded (`gemini-2.0-flash`) — agora vem de textModels(), com cascata de
// 404 pra sobreviver a renomeação do Google. Ver ADR 0002.

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: exigir JWT de usuário autenticado E APROVADO.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authorization header obrigatório." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("SUPABASE env não configurada");
    }
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Token inválido ou expirado." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: approved, error: approvedErr } = await supabaseClient.rpc("is_approved_user");
    if (approvedErr || approved !== true) {
      return new Response(JSON.stringify({ error: "Usuário não aprovado." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { productName, category, description } = await req.json();

    if (!productName && !category && !description) {
      return new Response(
        JSON.stringify({ error: "Informe ao menos o nome do produto, categoria ou descrição." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GEMINI_API_KEY = getGeminiApiKey();

    const prompt = `Você é um especialista em classificação fiscal NCM (Nomenclatura Comum do Mercosul) para a indústria calçadista brasileira.

Com base nas informações abaixo, sugira o código NCM mais adequado:
- Nome do produto/material: ${productName || "não informado"}
- Categoria: ${category || "não informada"}
- Descrição adicional: ${description || "não informada"}

Responda APENAS com um JSON no formato:
{
  "ncm": "XXXX.XX.XX",
  "description": "Breve descrição do NCM",
  "confidence": "alta|média|baixa"
}

Se não conseguir determinar com certeza, sugira o mais provável e indique confiança "baixa".`;

    // responseMimeType=json + responseSchema garantem saída JSON parseável sem
    // precisar de regex/fallback.
    const data = await callGemini({
      apiKey: GEMINI_API_KEY,
      models: textModels(),
      modality: "text",
      label: "suggest-ncm",
      timeoutMs: 30_000,
      body: {
        systemInstruction: {
          parts: [{ text: "Você é um classificador fiscal NCM especializado em calçados e seus componentes (couros, solados, palmilhas, adesivos, etc). Responda sempre em JSON válido conforme o schema." }],
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              ncm: { type: "string", description: "Código NCM no formato XXXX.XX.XX" },
              description: { type: "string", description: "Descrição resumida do NCM" },
              confidence: { type: "string", enum: ["alta", "média", "baixa"] },
            },
            required: ["ncm", "description", "confidence"],
          },
        },
      },
    });

    const content = extractText(data) || "";

    try {
      // responseSchema garante JSON puro, mas vou tentar regex de fallback
      // caso algum modelo futuro adicione markdown ```json``` wrapper.
      const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const result = JSON.parse(cleaned);
      if (result?.ncm) {
        // Valida 8 dígitos antes de devolver — a IA às vezes retorna NCM com
        // posição (ex.: "6402.99.00") ou incompleto. emit-nfe exige 8 dígitos;
        // normalizar/validar aqui evita sugerir um NCM que falharia na emissão.
        // Auditoria 2026-06-14, Área 4.
        const digits = String(result.ncm).replace(/\D/g, "");
        if (digits.length !== 8) {
          return new Response(JSON.stringify({
            error: `NCM sugerido pela IA inválido ("${result.ncm}" → ${digits.length} dígitos; precisa 8). Tente novamente ou informe manualmente.`,
          }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ ...result, ncm: digits }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (parseErr) {
      console.error("Failed to parse Gemini response:", parseErr, "raw:", content);
    }

    return new Response(JSON.stringify({ error: "Não foi possível gerar sugestão de NCM (resposta inválida do modelo)." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-ncm error:", e);
    return geminiErrorResponse(e, corsHeaders);
  }
});

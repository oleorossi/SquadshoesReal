import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

// extract-clients: recebe base64 + mime de PDF/JPG/PNG/WEBP, manda pra
// Gemini (Google) e retorna array de clientes JSON.
// Excel/CSV NÃO passam aqui — o front parseia local com SheetJS.
//
// 19/05/2026 (v4): voltou pra Gemini 2.0 Flash. Tier free é generoso
// (15 req/min, 1k req/dia, 1M tokens/dia) e suporta PDF + imagem nativamente
// + responseSchema pra JSON estruturado garantido (equivalente ao tool_use
// do Claude). Pega chave grátis em https://aistudio.google.com/app/apikey

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Gemini 2.0 Flash — generoso no free tier, suporta PDF + vision + structured output
const MODEL = "gemini-2.0-flash";
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authorization header obrigatório." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("SUPABASE env não configurada");

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Token inválido ou expirado." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: approved } = await supabaseClient.rpc("is_approved_user");
    if (approved !== true) {
      return new Response(JSON.stringify({ error: "Usuário não aprovado." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { fileBase64, mimeType, fileName } = await req.json();
    if (!fileBase64 || !mimeType) {
      return new Response(JSON.stringify({ error: "Envie fileBase64 e mimeType." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({
        error: "GEMINI_API_KEY não configurada. Cadastre em Supabase → Edge Functions → Secrets. Pegue grátis em https://aistudio.google.com/app/apikey",
      }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Aceita PDF e imagem comum. .docx não tem caminho viável aqui — front filtra antes.
    const mime = (mimeType || "").toLowerCase();
    const cleanMime = mime === "image/jpg" ? "image/jpeg" : mime;
    const isAccepted =
      cleanMime === "application/pdf" ||
      cleanMime === "image/jpeg" ||
      cleanMime === "image/png" ||
      cleanMime === "image/webp" ||
      cleanMime === "image/heic" ||
      cleanMime === "image/heif";
    if (!isAccepted) {
      return new Response(JSON.stringify({
        error: `Formato '${mime}' não suportado pelo extrator. Aceito: PDF, JPEG, PNG, WEBP. ` +
               `Pra Word, salve como PDF antes de enviar. Pra Excel/CSV, use a aba normal (parseado local).`,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // responseSchema força JSON estruturado direto da API — bem mais confiável
    // que pedir JSON no prompt e dar parse no texto.
    const responseSchema = {
      type: "OBJECT",
      properties: {
        clients: {
          type: "ARRAY",
          description: "Lista de clientes identificados no documento.",
          items: {
            type: "OBJECT",
            properties: {
              razao_social: { type: "STRING", description: "Razão social ou nome da empresa" },
              nome_fantasia: { type: "STRING", nullable: true },
              cnpj: { type: "STRING", nullable: true, description: "CNPJ formatado ou só dígitos. NÃO inventar." },
              inscricao_estadual: { type: "STRING", nullable: true },
              regime_tributario: { type: "STRING", nullable: true },
              endereco: { type: "STRING", nullable: true },
              numero: { type: "STRING", nullable: true },
              bairro: { type: "STRING", nullable: true },
              cidade: { type: "STRING", nullable: true },
              estado: { type: "STRING", nullable: true, description: "UF, 2 letras maiúsculas" },
              cep: { type: "STRING", nullable: true },
              email: { type: "STRING", nullable: true },
              telefone: { type: "STRING", nullable: true },
              contato: { type: "STRING", nullable: true },
            },
            required: ["razao_social"],
          },
        },
      },
      required: ["clients"],
    };

    const systemInstruction =
      "Você é um extrator de dados de cadastro de clientes/lojistas de uma indústria " +
      "calçadista brasileira. Analise o documento (PDF, foto de cartão de visita, lista " +
      "de lojas, contrato, planilha impressa) e extraia TODOS os clientes que conseguir " +
      "identificar.\n\n" +
      "REGRAS:\n" +
      "- Use null pra qualquer campo que não conseguir ler com certeza.\n" +
      "- NUNCA invente CNPJ, IE, CEP ou outros documentos.\n" +
      "- Aceite variações: CNPJ formatado ou só dígitos; UF extenso ou abreviado.\n" +
      "- Se o documento tem várias lojas/filiais do mesmo grupo, retorne CADA UMA como " +
      "  cliente separado (filiais têm CNPJ próprio).\n" +
      "- Ignore cabeçalhos, totais, rodapés, marcas d'água.\n" +
      "- razao_social é obrigatório: se não conseguir identificar pelo menos o nome da " +
      "  empresa, NÃO inclua aquela entrada.";

    const response = await fetch(`${GEMINI_API}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: cleanMime, data: fileBase64 } },
              { text: `Extraia os clientes/lojistas deste arquivo: ${fileName || "(sem nome)"}` },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
          maxOutputTokens: 8192,
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText.slice(0, 500));
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite gratuito do Gemini excedido (15 req/min ou 1k req/dia). Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 401 || response.status === 403) {
        return new Response(JSON.stringify({
          error: "GEMINI_API_KEY inválida ou sem permissão. Confira em Supabase → Edge Functions → Secrets.",
        }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 400) {
        let detail = "";
        try { detail = JSON.parse(errText)?.error?.message || ""; } catch { detail = errText.slice(0, 200); }
        return new Response(JSON.stringify({
          error: `Requisição inválida (${response.status}): ${detail || "arquivo possivelmente grande demais ou corrompido"}.`,
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `Erro ao consultar Gemini (HTTP ${response.status})` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    // Gemini retorna candidates[0].content.parts[0].text com o JSON serializado
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error("Gemini sem texto:", JSON.stringify(data).slice(0, 400));
      return new Response(JSON.stringify({ error: "IA não retornou estrutura esperada. Tente outro arquivo ou reformule." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error("Falha ao parsear JSON do Gemini:", text.slice(0, 400));
      return new Response(JSON.stringify({ error: "IA retornou JSON inválido. Tente novamente." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clients = Array.isArray(parsed?.clients) ? parsed.clients : [];
    // Filtra noise: entradas sem razao_social só atrapalham o wizard de revisão.
    const valid = clients.filter((c: any) => c?.razao_social && String(c.razao_social).trim().length > 0);
    return new Response(JSON.stringify({ clients: valid, total: valid.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-clients error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

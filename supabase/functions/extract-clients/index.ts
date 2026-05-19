import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

// extract-clients: recebe base64 + mime de PDF/DOCX/JPG/PNG, manda pra
// Gemini Vision e retorna array de clientes JSON.
// Excel/CSV NÃO passam aqui — o front parseia local com SheetJS.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
        error: "GEMINI_API_KEY não configurada. Cadastre em Supabase → Edge Functions → Secrets. Pegue grátis em https://ai.google.dev",
      }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `Você está analisando um arquivo (PDF/Word/imagem) com lista de CLIENTES/LOJISTAS de uma indústria calçadista brasileira.

Extraia TODOS os clientes que conseguir identificar. Para cada um, retorne os campos abaixo (use null quando não conseguir extrair):

- razao_social (obrigatório se conseguir identificar pelo menos o nome da empresa)
- nome_fantasia
- cnpj (formato XX.XXX.XXX/XXXX-XX ou só dígitos, sem inventar)
- inscricao_estadual
- regime_tributario (ex: "Simples Nacional", "Lucro Presumido", "Lucro Real", "MEI")
- endereco (rua/avenida + número, sem bairro/cidade)
- numero (separado quando claro)
- bairro
- cidade
- estado (UF, 2 letras maiúsculas)
- cep (formato XXXXX-XXX ou só dígitos)
- email
- telefone
- contato (nome da pessoa de contato, se houver)

IMPORTANTE:
- NÃO INVENTE dados. Se não conseguir ler, use null.
- Aceite formatos variados (CNPJ pode vir formatado ou não, UF pode vir extenso ou abreviado).
- Se o documento tiver várias lojas/filiais do MESMO grupo, retorne cada uma como um cliente separado.
- Ignore cabeçalhos, totais, rodapés.

Arquivo: ${fileName || "(sem nome)"}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: "Você é um extrator de dados de cadastro de clientes. Responda SEMPRE em JSON válido conforme o schema. Não invente dados — use null quando não conseguir ler com certeza." }],
        },
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: fileBase64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              clients: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    razao_social: { type: "string", nullable: true },
                    nome_fantasia: { type: "string", nullable: true },
                    cnpj: { type: "string", nullable: true },
                    inscricao_estadual: { type: "string", nullable: true },
                    regime_tributario: { type: "string", nullable: true },
                    endereco: { type: "string", nullable: true },
                    numero: { type: "string", nullable: true },
                    bairro: { type: "string", nullable: true },
                    cidade: { type: "string", nullable: true },
                    estado: { type: "string", nullable: true },
                    cep: { type: "string", nullable: true },
                    email: { type: "string", nullable: true },
                    telefone: { type: "string", nullable: true },
                    contato: { type: "string", nullable: true },
                  },
                },
              },
            },
            required: ["clients"],
          },
        },
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("Gemini API error:", response.status, t.slice(0, 500));
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite do Gemini excedido. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 400) {
        return new Response(JSON.stringify({ error: "Requisição inválida (arquivo grande demais ou chave Gemini errada). HTTP 400." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `Erro ao consultar IA (HTTP ${response.status})` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    try {
      const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const result = JSON.parse(cleaned);
      const clients = Array.isArray(result?.clients) ? result.clients : [];
      // Filtra fora entradas sem razao_social (provavelmente noise)
      const valid = clients.filter((c: any) => c?.razao_social && String(c.razao_social).trim().length > 0);
      return new Response(JSON.stringify({ clients: valid, total: valid.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (parseErr) {
      console.error("Failed to parse Gemini response:", parseErr, "raw:", content.slice(0, 500));
      return new Response(JSON.stringify({ error: "IA retornou JSON inválido. Tente outro arquivo ou reformule." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("extract-clients error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

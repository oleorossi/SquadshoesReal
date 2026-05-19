import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

// extract-clients: recebe base64 + mime de PDF/JPG/PNG/WEBP, manda pra
// Claude (Anthropic) e retorna array de clientes JSON.
// Excel/CSV NÃO passam aqui — o front parseia local com SheetJS.
//
// 19/05/2026: migrado de Gemini → Claude API a pedido do user.
// Claude suporta PDF nativamente (até 32MB / 100 páginas via document block)
// e imagens (JPEG/PNG/WEBP/GIF). Força JSON estruturado via tool_use.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
// Modelo: Claude Haiku 4.5 — rápido + barato pra extração estruturada
// (Sonnet/Opus seriam overkill pra este caso e queimariam quota desnecessária).
const MODEL = "claude-haiku-4-5-20251001";

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

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({
        error: "ANTHROPIC_API_KEY não configurada. Cadastre em Supabase → Edge Functions → Secrets. Pegue em https://console.anthropic.com",
      }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detecta tipo do arquivo pra montar o content block correto:
    // - PDF → document block (vision automática, até 100 páginas)
    // - imagem → image block
    // - outro → erro claro pro front (não tem caminho viável pra .docx via Claude API)
    const mime = (mimeType || "").toLowerCase();
    let contentBlock: any;
    if (mime === "application/pdf") {
      contentBlock = {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: fileBase64 },
      };
    } else if (mime.startsWith("image/")) {
      // Normaliza JPEG variants pro mime padrão da Anthropic
      const cleanMime = mime === "image/jpg" ? "image/jpeg" : mime;
      contentBlock = {
        type: "image",
        source: { type: "base64", media_type: cleanMime, data: fileBase64 },
      };
    } else {
      return new Response(JSON.stringify({
        error: `Formato '${mime}' não suportado pelo extrator. Aceito: PDF, JPEG, PNG, WEBP. ` +
               `Pra Word, salve como PDF antes de enviar. Pra Excel/CSV, use a aba normal (parseado local).`,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Força JSON estruturado via tool_use: Claude é OBRIGADO a chamar essa
    // "tool" como output. Bem mais confiável que pedir JSON no prompt e dar
    // parse (que falha em ~5% dos casos com texto solto antes/depois).
    const extractTool = {
      name: "extract_clients",
      description:
        "Retorna a lista estruturada de clientes/lojistas extraídos do documento. " +
        "Use null pra campos que não conseguir ler com certeza — não invente.",
      input_schema: {
        type: "object",
        properties: {
          clients: {
            type: "array",
            description: "Lista de clientes identificados no documento.",
            items: {
              type: "object",
              properties: {
                razao_social: { type: "string", description: "Razão social ou nome da empresa (obrigatório se conseguir identificar)" },
                nome_fantasia: { type: ["string", "null"] },
                cnpj: { type: ["string", "null"], description: "CNPJ formatado XX.XXX.XXX/XXXX-XX ou só dígitos. NÃO inventar." },
                inscricao_estadual: { type: ["string", "null"] },
                regime_tributario: { type: ["string", "null"], description: "Simples Nacional, Lucro Presumido, Lucro Real, MEI" },
                endereco: { type: ["string", "null"], description: "Rua/avenida + número, sem bairro/cidade" },
                numero: { type: ["string", "null"] },
                bairro: { type: ["string", "null"] },
                cidade: { type: ["string", "null"] },
                estado: { type: ["string", "null"], description: "UF, 2 letras maiúsculas (RJ, SP, MG...)" },
                cep: { type: ["string", "null"], description: "XXXXX-XXX ou só dígitos" },
                email: { type: ["string", "null"] },
                telefone: { type: ["string", "null"] },
                contato: { type: ["string", "null"], description: "Nome da pessoa de contato" },
              },
              required: ["razao_social"],
            },
          },
        },
        required: ["clients"],
      },
    };

    const systemPrompt =
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

    const userPrompt = `Extraia os clientes/lojistas deste arquivo: ${fileName || "(sem nome)"}\n\nChame a tool extract_clients com a lista completa.`;

    const apiHeaders: Record<string, string> = {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
    // Beta header obrigatório pra suporte a PDF via document block.
    if (mime === "application/pdf") {
      apiHeaders["anthropic-beta"] = "pdfs-2024-09-25";
    }

    const response = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        tools: [extractTool],
        // Força Claude a chamar EXATAMENTE essa tool — garante JSON estruturado.
        tool_choice: { type: "tool", name: "extract_clients" },
        messages: [
          {
            role: "user",
            content: [contentBlock, { type: "text", text: userPrompt }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText.slice(0, 500));
      // Erros conhecidos do Claude: mapeia pra HTTP claro
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite da Anthropic excedido. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 401 || response.status === 403) {
        return new Response(JSON.stringify({
          error: "ANTHROPIC_API_KEY inválida ou sem permissão. Confira em Supabase → Edge Functions → Secrets.",
        }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 400) {
        // Arquivo muito grande, mime errado, base64 corrompido
        let detail = "";
        try { detail = JSON.parse(errText)?.error?.message || ""; } catch { detail = errText.slice(0, 200); }
        return new Response(JSON.stringify({
          error: `Requisição inválida (${response.status}): ${detail || "arquivo possivelmente grande demais ou corrompido"}.`,
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `Erro ao consultar IA Claude (HTTP ${response.status})` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    // Claude retorna lista de content blocks. Com tool_choice forçado, há sempre
    // pelo menos um bloco tool_use. Extraímos o `input` dele.
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const toolBlock = blocks.find((b: any) => b?.type === "tool_use" && b?.name === "extract_clients");
    if (!toolBlock) {
      console.error("Claude não retornou tool_use:", JSON.stringify(blocks).slice(0, 400));
      return new Response(JSON.stringify({ error: "IA não retornou estrutura esperada. Tente outro arquivo ou reformule." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clients = Array.isArray(toolBlock.input?.clients) ? toolBlock.input.clients : [];
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

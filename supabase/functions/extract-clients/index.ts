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
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Modelos em ordem de preferência. 20/05/2026: chaves criadas no Google AI
// Studio depois de jan/2025 batem 429 imediato em `gemini-2.0-flash` quando
// não têm billing habilitado. `gemini-1.5-flash` ainda tem free tier sólido
// sem exigir billing — usado como fallback automático.
// Lista atualizada para 2026. Google mudou nomes de modelos várias vezes:
// nomes antigos (gemini-2.0-flash, gemini-1.5-flash) retornam 404 com chaves
// novas. Tenta em ordem: 2.5 flash → 2.0 flash com -001 → flash-latest →
// versões antigas como último fallback.
const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash",
];
const geminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Lista modelos disponíveis pra essa chave (usado pra diagnóstico quando
// todos os modelos hardcoded retornam 404). Não custa quota — é metadata.
async function listAvailableModels(apiKey: string): Promise<string[]> {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!r.ok) return [];
    const j = await r.json();
    const list = Array.isArray(j?.models) ? j.models : [];
    return list
      .filter((m: any) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map((m: any) => String(m?.name || "").replace(/^models\//, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

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

    const requestBody = JSON.stringify({
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
    });

    // Tenta cada modelo em ordem. 4xx (exceto 429) param imediato.
    // 429/503/5xx → tenta o próximo modelo.
    const attempts: Array<{ model: string; status: number; detail: string }> = [];
    let response: Response | null = null;
    for (const model of MODELS) {
      const r = await fetch(`${geminiUrl(model)}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
      if (r.ok) {
        response = r;
        console.log(`[extract-clients] OK com modelo ${model}`);
        break;
      }
      const errText = await r.text();
      let geminiMsg = "";
      try { geminiMsg = JSON.parse(errText)?.error?.message || ""; } catch { geminiMsg = errText.slice(0, 300); }
      attempts.push({ model, status: r.status, detail: geminiMsg });
      console.warn(`[extract-clients] ${model} → ${r.status}: ${geminiMsg.slice(0, 300)}`);
      // 400/401/403 = erro do cliente (key/request) — não adianta tentar outro modelo.
      if (r.status === 400 || r.status === 401 || r.status === 403) break;
    }

    if (!response) {
      const lastStatus = attempts[attempts.length - 1]?.status ?? 500;
      const summary = attempts.map(a => `${a.model}: ${a.status} ${a.detail.slice(0, 120)}`).join(" | ");
      console.error(`[extract-clients] Falhou em todos os modelos. ${summary}`);

      // Se TODOS os modelos hardcoded retornaram 404, o problema é nome de
      // modelo defasado. Lista o que essa chave realmente tem disponível e
      // tenta o primeiro que faz sentido (flash). Salva o user de bater na
      // documentação procurando o nome certo.
      const all404 = attempts.length > 0 && attempts.every(a => a.status === 404);
      if (all404) {
        const available = await listAvailableModels(GEMINI_API_KEY);
        console.log(`[extract-clients] Modelos disponíveis pra essa chave: ${available.join(", ")}`);
        // Prioriza modelos "flash" (rápidos, baratos) — depois "pro" se nada de flash.
        const flash = available.filter(m => /flash/i.test(m) && !/embedding|tts|image|audio/i.test(m));
        const candidate = flash[0] || available.find(m => /gemini.*pro/i.test(m) && !/vision|embedding/i.test(m));
        if (candidate) {
          console.log(`[extract-clients] Tentando fallback dinâmico: ${candidate}`);
          const r = await fetch(`${geminiUrl(candidate)}?key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody,
          });
          if (r.ok) {
            response = r;
            console.log(`[extract-clients] OK com modelo dinâmico ${candidate}`);
          } else {
            const t = await r.text();
            let m = "";
            try { m = JSON.parse(t)?.error?.message || ""; } catch { m = t.slice(0, 300); }
            attempts.push({ model: candidate, status: r.status, detail: m });
          }
        }
        if (!response) {
          return new Response(JSON.stringify({
            error: `Modelos hardcoded retornam 404. Modelos disponíveis pra sua chave: ${available.join(", ") || "(nenhum)"}. Detalhes das tentativas: ${attempts.map(a => `${a.model}=${a.status}`).join(", ")}`,
            attempts,
            available_models: available,
          }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      if (!response) {
        let userError = "";
        if (attempts.every(a => a.status === 429)) {
          userError = `Cota do Gemini esgotada em todos modelos free. Detalhes: ${summary}. Habilite billing em https://aistudio.google.com/app/apikey ou tente em alguns minutos.`;
        } else if (attempts.some(a => a.status === 401 || a.status === 403)) {
          userError = `GEMINI_API_KEY inválida ou sem permissão. Detalhes: ${summary}`;
        } else if (attempts.some(a => a.status === 400)) {
          userError = `Requisição inválida — arquivo possivelmente grande demais ou corrompido. Detalhes: ${summary}`;
        } else {
          userError = `Falha ao consultar Gemini. Detalhes: ${summary}`;
        }
        return new Response(JSON.stringify({ error: userError, attempts }), {
          status: lastStatus >= 400 && lastStatus < 600 ? lastStatus : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

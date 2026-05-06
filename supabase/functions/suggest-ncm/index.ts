import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: exigir JWT de usuário autenticado E APROVADO. A função consome
    // créditos pagos da Lovable AI Gateway — sem auth, qualquer requisição
    // anônima dreina os créditos do projeto.
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
    // Exige usuário aprovado (mesmo padrão das RPCs sensíveis do projeto).
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um classificador fiscal NCM especializado em calçados e seus componentes (couros, solados, palmilhas, adesivos, etc). Responda sempre em JSON válido." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest_ncm",
              description: "Retorna sugestão de código NCM para um produto calçadista",
              parameters: {
                type: "object",
                properties: {
                  ncm: { type: "string", description: "Código NCM no formato XXXX.XX.XX" },
                  description: { type: "string", description: "Descrição resumida do NCM" },
                  confidence: { type: "string", enum: ["alta", "média", "baixa"], description: "Nível de confiança da sugestão" },
                },
                required: ["ncm", "description", "confidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest_ncm" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA insuficientes." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Erro ao consultar IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback: try to parse content directly
    const content = data.choices?.[0]?.message?.content || "";
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch { /* ignore parse error */ }

    return new Response(JSON.stringify({ error: "Não foi possível gerar sugestão de NCM." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-ncm error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
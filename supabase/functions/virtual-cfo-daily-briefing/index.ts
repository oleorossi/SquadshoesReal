import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Validate user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Restrict to financial/management roles — cashflow data must not be
    // accessible to all authenticated users (operators, picking staff, etc.).
    const { data: roles, error: rolesErr } = await supabase
      .from("user_roles").select("role").eq("user_id", user.id);
    if (rolesErr) {
      return new Response(
        JSON.stringify({ error: "Falha ao validar permissão" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const allowed = ["admin", "gerente", "financeiro"];
    if (!roles?.some((r: any) => allowed.includes(r.role))) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse optional days parameter (default 15, max 90)
    let days = 15;
    const url = new URL(req.url);
    const daysParam = url.searchParams.get("days");
    if (daysParam) {
      const parsed = parseInt(daysParam, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 90) {
        days = parsed;
      }
    }

    const today = new Date().toISOString().split("T")[0];
    const futureDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const { data: cashflow, error: cfError } = await supabase
      .from("vw_virtual_cfo_cashflow")
      .select("*")
      .gte("data_movimento", today)
      .lte("data_movimento", futureDate);

    if (cfError) {
      console.error("Cashflow query error:", cfError.message);
      return new Response(
        JSON.stringify({ error: "Failed to fetch cashflow data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalEntradas = 0;
    let totalSaidas = 0;

    (cashflow ?? []).forEach((item: { tipo: string; valor: number | null }) => {
      const valor = Number(item.valor) || 0;
      if (item.tipo === "ENTRADA") totalEntradas += valor;
      if (item.tipo === "SAIDA") totalSaidas += valor;
    });

    const saldoProjetado = totalEntradas - totalSaidas;

    let alerta: string;
    if (saldoProjetado < 0) {
      alerta = `ALERTA DE CAIXA: Projeção de déficit de R$ ${Math.abs(saldoProjetado).toFixed(2)} para os próximos ${days} dias. Ação recomendada: Avaliar antecipação de recebíveis (Factoring) ou negociar prorrogação com fornecedores críticos.`;
    } else {
      alerta = `CAIXA SAUDÁVEL: Projeção positiva de R$ ${saldoProjetado.toFixed(2)} para os próximos ${days} dias.`;
    }

    // Save notification (non-fatal: log error but don't fail the response)
    const { error: notifErr } = await supabase.from("notifications").insert({
      message: alerta,
      sector: "financeiro",
      read: false,
      user_id: user.id,
    });
    if (notifErr) console.error("virtual-cfo: failed to insert notification:", notifErr.message);

    return new Response(
      JSON.stringify({
        status: "Análise concluída",
        periodo_dias: days,
        total_entradas: totalEntradas,
        total_saidas: totalSaidas,
        saldo_projetado: saldoProjetado,
        alerta,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("CFO briefing error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

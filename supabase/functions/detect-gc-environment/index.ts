/**
 * detect-gc-environment — Detecta ambiente SEFAZ real do tenant GestaoClick.
 *
 * Audit round 3 (2026-05-29): `companies.ambiente` local no DB era decorativo
 * — nunca ia no payload pro GC, e o GC decidia ambiente pelo painel próprio.
 * Resultado: divergência possível e perigosa entre o que o ERP acha e o que
 * a SEFAZ realmente registra. Confirmado: DB dizia 'homologacao' mas o GC
 * estava em produção real (20 NFs autorizadas com tipo_ambiente='1' SEFAZ).
 *
 * Esta edge fn:
 * 1. Busca as últimas N NFs emitidas no GestaoClick (que retornam tipo_ambiente)
 * 2. Determina ambiente mais recente observado
 * 3. Atualiza companies.ambiente caso divergente
 * 4. Retorna estado + histórico pra dashboard exibir
 *
 * Pode ser chamada via:
 * - Cron diária (pg_cron) — auto-correção
 * - Botão "Sincronizar ambiente" no NfeDiagnosticPanel — sob demanda
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GESTAOCLICK_BASE = "https://api.gestaoclick.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function gcHeaders() {
  const access = Deno.env.get("CLICKNOTAS_ACCESS_TOKEN");
  const secret = Deno.env.get("CLICKNOTAS_SECRET_TOKEN");
  if (!access || !secret) {
    throw new Error("Tokens CLICKNOTAS_ACCESS_TOKEN/CLICKNOTAS_SECRET_TOKEN não configurados.");
  }
  return {
    "Content-Type": "application/json",
    "access-token": access,
    "secret-access-token": secret,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 1. Busca as últimas NFs já registradas localmente que têm tipo_ambiente
    //    no gc_detail_response. Se houver, usamos o mais recente como sinal
    //    autoritativo (vem direto da SEFAZ).
    const { data: localNfes } = await adminClient
      .from("nfe_emitidas")
      .select("id, numero, status, created_at, tp_amb_sefaz, gc_detail_response")
      .eq("status", "autorizada")
      .order("created_at", { ascending: false })
      .limit(5);

    let observedAmbiente: string | null = null;
    let observedSource: string = "none";
    for (const n of (localNfes || [])) {
      const tp = (n as any).tp_amb_sefaz
        ?? (n as any).gc_detail_response?.data?.tipo_ambiente;
      if (tp && ["1", "2"].includes(String(tp))) {
        observedAmbiente = tp === "1" ? "producao" : "homologacao";
        observedSource = `nfe_emitidas.numero=${n.numero}`;
        break;
      }
    }

    // 2. Se nenhuma NF local tem info, faz GET /lojas (call mais leve) e
    //    inspeciona resposta — algumas APIs retornam ambiente no body.
    //    Como fallback, marca como "indeterminado" e UI orienta operador.
    let lojasResponse: any = null;
    if (!observedAmbiente) {
      try {
        const r = await fetch(`${GESTAOCLICK_BASE}/lojas`, {
          method: "GET",
          headers: gcHeaders(),
          signal: AbortSignal.timeout(10_000),
        });
        lojasResponse = await r.json();
        // Lojas response normally não inclui ambiente — só pra confirmar
        // que o tenant existe e tokens funcionam.
      } catch (e) {
        lojasResponse = { error: String(e) };
      }
    }

    // 3. Pega ambiente atual do DB
    const { data: companies } = await adminClient
      .from("companies")
      .select("id, name, cnpj, ambiente, is_primary, active")
      .eq("active", true);

    const primaryCompany = (companies || []).find((c: any) => c.is_primary)
      || (companies || [])[0]
      || null;
    const dbAmbiente = primaryCompany?.ambiente ?? null;

    // 4. Decide ação
    const divergent = observedAmbiente && dbAmbiente && observedAmbiente !== dbAmbiente;
    let updated = false;
    if (divergent && primaryCompany) {
      const { error: updErr } = await adminClient
        .from("companies")
        .update({ ambiente: observedAmbiente })
        .eq("id", primaryCompany.id);
      if (!updErr) {
        updated = true;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      db_ambiente: dbAmbiente,
      observed_ambiente: observedAmbiente,
      observed_source: observedSource,
      divergent,
      updated,
      lojas_probed: !!lojasResponse,
      lojas_response: lojasResponse,
      message: !observedAmbiente
        ? "Sem NF autorizada com tipo_ambiente registrado — emita uma NF de teste pra detectar ambiente automaticamente."
        : divergent
          ? `DB dizia '${dbAmbiente}' mas SEFAZ confirmou '${observedAmbiente}'. ${updated ? "Corrigido." : "Falha ao atualizar."}`
          : `Ambiente OK: ${dbAmbiente} (confirmado por ${observedSource}).`,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

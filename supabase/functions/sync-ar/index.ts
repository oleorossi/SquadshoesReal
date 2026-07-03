// sync-ar — reconciliação SERVER-SIDE de contas a receber (P0.4, 2026-07-03).
//
// Problema: syncFinancialRecords rodava só no browser (emissão de NF pela UI ou
// clique em "Reconciliar" no dashboard). PV faturado com NF autorizada pelo
// poller — ou com NF externa — ficava SEM conta a receber até alguém abrir o
// dashboard (R$ 418k medidos em 03/07). Esta função roda o MESMO core TS
// (financialSync.ts, espelho byte-idêntico de src/lib/financialSync.ts) com
// service role, varrendo a view v_faturado_sem_ar.
//
// ⚠ verify_jwt=FALSE (supabase/config.toml) — mesma razão do
// sync-nfe-from-provider: o pg_cron (trigger_sync_ar_cron, */30) chama SEM
// Authorization, autenticando por X-Cron-Secret (vault nfe_sync_cron_secret,
// validado via RPC get_nfe_sync_cron_secret). Não reabilitar verify_jwt sem
// mover a auth do cron.
//
// Body (POST, JSON):
//   {}                          → varre a view (nf_autorizada + nf_externa)
//   { sale_order_id }           → sincroniza 1 PV
//   { force_sem_nf: true }      → TAMBÉM gera AR pros PVs 'sem_nf' (backfill
//                                 autorizado pelo usuário em 2026-07-03; as
//                                 parcelas nascem com marcador de auditoria)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { syncFinancialRecordsCore } from "./financialSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Autenticação: X-Cron-Secret (pg_cron) OU Bearer == service role key.
  const cronSecretHeader = req.headers.get("X-Cron-Secret");
  const authHeader = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let authorized = false;
  if (cronSecretHeader) {
    const { data: storedSecret } = await admin.rpc("get_nfe_sync_cron_secret");
    authorized = !!storedSecret && cronSecretHeader === storedSecret;
  }
  if (!authorized && authHeader && authHeader === serviceKey) {
    authorized = true;
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
  }

  let body: { sale_order_id?: string; force_sem_nf?: boolean } = {};
  try { body = await req.json(); } catch { /* body vazio ok */ }

  const results: Array<{ sale_order_id: string; order_number?: string; situacao_nf?: string; ok: boolean; error?: string }> = [];

  const runOne = async (saleOrderId: string, orderNumber?: string, situacao?: string, allowMissingNf = false) => {
    try {
      await syncFinancialRecordsCore(admin, saleOrderId, { allowMissingNf });
      results.push({ sale_order_id: saleOrderId, order_number: orderNumber, situacao_nf: situacao, ok: true });
    } catch (e) {
      results.push({
        sale_order_id: saleOrderId, order_number: orderNumber, situacao_nf: situacao,
        ok: false, error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  if (body.sale_order_id) {
    await runOne(body.sale_order_id, undefined, undefined, body.force_sem_nf === true);
  } else {
    const { data: pending, error } = await admin
      .from("v_faturado_sem_ar")
      .select("id, order_number, situacao_nf");
    if (error) {
      return new Response(JSON.stringify({ error: `v_faturado_sem_ar: ${error.message}` }), { status: 500, headers: corsHeaders });
    }
    for (const row of pending ?? []) {
      const reconcilable = row.situacao_nf === "nf_autorizada" || row.situacao_nf === "nf_externa";
      const forceThis = row.situacao_nf === "sem_nf" && body.force_sem_nf === true;
      if (!reconcilable && !forceThis) continue;
      await runOne(row.id, row.order_number, row.situacao_nf, forceThis);
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`sync-ar: ${ok} PV(s) sincronizado(s), ${failed.length} falha(s)`, failed);
  return new Response(JSON.stringify({ synced: ok, failed, results }), { headers: corsHeaders });
});

// Consumidor durável da outbox de Pedido de Venda.
//
// Autenticação: X-Cron-Secret (pg_cron) ou Bearer == service role key.
// O gateway fica com verify_jwt=false porque o cron interno não envia JWT; o
// handler valida o segredo antes de qualquer claim.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { syncFinancialRecordsCore } from "../sync-ar/financialSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

interface OutboxEvent {
  id: string;
  sale_order_id: string | null;
  event_type: string;
  aggregate_key: string;
  aggregate_version: number;
  payload: Record<string, unknown>;
  attempts: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cronSecretHeader = req.headers.get("X-Cron-Secret");
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let authorized = Boolean(bearer && bearer === serviceKey);
  if (!authorized && cronSecretHeader) {
    const { data: storedSecret, error } = await admin.rpc("get_nfe_sync_cron_secret");
    if (error) console.error("outbox: falha ao validar segredo do cron", error.message);
    authorized = Boolean(storedSecret && cronSecretHeader === storedSecret);
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  let body: { limit?: number; worker_id?: string } = {};
  try { body = await req.json(); } catch { /* corpo vazio usa defaults */ }
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 20));
  const workerId = String(
    body.worker_id || `edge-${crypto.randomUUID()}`,
  ).slice(0, 120);

  let claimed = 0;
  let published = 0;
  let failed = 0;
  let deadLetter = 0;
  let topLevelError: string | null = null;
  const results: Array<{
    id: string;
    event_type: string;
    ok: boolean;
    status?: string;
    error?: string;
  }> = [];

  try {
    const { data, error } = await admin.rpc("claim_sale_order_outbox", {
      p_worker_id: workerId,
      p_limit: limit,
    });
    if (error) throw new Error(`claim: ${error.message}`);
    const events = (data || []) as OutboxEvent[];
    claimed = events.length;

    for (const event of events) {
      try {
        const effectResult: Record<string, unknown> = {};

        // Receipt recusado já contém o erro durável; não há efeito derivado.
        if (event.event_type !== "sale_order.command_failed" && event.sale_order_id) {
          // Idempotente: reconcilia AR/lançamentos pela identidade do PV, sem
          // duplicar parcelas nem apagar registros financeiros confirmados.
          await syncFinancialRecordsCore(admin, event.sale_order_id);
          effectResult.financial_sync = { ok: true };

          // Idempotente por PV+fornecedor e status-aware. Em Draft/Faturado/
          // cancelado retorna skipped; em Aprovado/Em Produção recalcula pelo
          // motor canônico e cria/reusa OCs das faltas válidas.
          const { data: purchase, error: purchaseError } = await admin.rpc(
            "process_sale_order_purchase_shortages",
            { p_sale_order_id: event.sale_order_id },
          );
          if (purchaseError) throw new Error(`purchase_shortages: ${purchaseError.message}`);
          effectResult.purchase_shortages = purchase;
        } else {
          effectResult.skipped = event.event_type === "sale_order.command_failed"
            ? "command_failed"
            : "missing_sale_order_id";
        }

        const { data: completed, error: completeError } = await admin.rpc(
          "complete_sale_order_outbox",
          {
            p_event_id: event.id,
            p_worker_id: workerId,
            p_effect_result: effectResult,
          },
        );
        if (completeError) throw new Error(`complete: ${completeError.message}`);
        if (completed !== true) throw new Error("complete recusou evento sem lock do worker");
        published += 1;
        results.push({ id: event.id, event_type: event.event_type, ok: true });
      } catch (eventError) {
        const message = errorMessage(eventError);
        const { data: nextStatus, error: failError } = await admin.rpc(
          "fail_sale_order_outbox",
          {
            p_event_id: event.id,
            p_worker_id: workerId,
            p_error: message,
            p_max_attempts: 8,
          },
        );
        if (failError) {
          console.error(`outbox ${event.id}: falha também ao registrar retry`, failError.message);
        }
        if (nextStatus === "dead_letter") deadLetter += 1;
        else failed += 1;
        results.push({
          id: event.id,
          event_type: event.event_type,
          ok: false,
          status: String(nextStatus || "unknown"),
          error: message,
        });
      }
    }
  } catch (error) {
    topLevelError = errorMessage(error);
    console.error("process-sale-order-outbox:", topLevelError);
  }

  const { error: heartbeatError } = await admin.rpc("record_sale_order_outbox_run", {
    p_worker_id: workerId,
    p_claimed: claimed,
    p_published: published,
    p_failed: failed,
    p_dead_letter: deadLetter,
    p_duration_ms: Math.max(0, Date.now() - startedAt),
    p_error: topLevelError,
  });
  if (heartbeatError) {
    console.error("outbox: falha ao gravar heartbeat", heartbeatError.message);
  }

  const response = {
    worker_id: workerId,
    claimed,
    published,
    failed,
    dead_letter: deadLetter,
    error: topLevelError,
    results,
  };
  return new Response(JSON.stringify(response), {
    status: topLevelError ? 500 : 200,
    headers: corsHeaders,
  });
});

// Worker de materialização pesada de status do PV (confirm/promote/cancel/
// Aprovado→Rascunho). Autenticação: X-Cron-Secret (pg_cron/pg_net) ou Bearer
// service role. verify_jwt=false no gateway — o handler valida o segredo.
//
// Processa NO MÁXIMO 1 job por invocação (serial global anti-deadlock em
// products), espelhando o bulk serial que existia no browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://squadshoes-real.vercel.app",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

interface MaterializationJob {
  id: string;
  sale_order_id: string;
  command_name: string;
  target_status: string;
  expected_order_version: number;
  payload: Record<string, unknown>;
  override_id: string | null;
  idempotency_key: string;
  attempts: number;
  locked_at: string;
  lock_token: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const rec = error as Record<string, unknown>;
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message.trim();
    if (typeof rec.details === "string" && rec.details.trim()) return rec.details.trim();
  }
  return String(error ?? "erro desconhecido");
}

function isBusyError(message: string): boolean {
  return /canceling statement due to (statement|lock) timeout/i.test(message)
    || /lock timeout/i.test(message)
    || /deadlock detected/i.test(message)
    || /40P01|57014|55P03/i.test(message);
}

/** Backoff alinhado ao client: 2s / 7s / 16s. */
function retryAfterSeconds(attempts: number): number {
  if (attempts <= 1) return 2;
  if (attempts === 2) return 7;
  return 16;
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
    if (error) console.error("materialization: falha ao validar segredo", error.message);
    authorized = Boolean(storedSecret && cronSecretHeader === storedSecret);
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  let body: { limit?: number; worker_id?: string } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  // Hard cap 1: serial global (plan Q6/Q13).
  const limit = Math.min(1, Math.max(1, Number(body.limit) || 1));
  const workerId = String(
    body.worker_id || `mat-${crypto.randomUUID()}`,
  ).slice(0, 120);

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;
  let deadLetter = 0;
  let topLevelError: string | null = null;
  const results: Array<Record<string, unknown>> = [];

  try {
    const { data, error } = await admin.rpc("claim_sale_order_materialization_jobs", {
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_seconds: 180,
    });
    if (error) throw new Error(`claim: ${error.message}`);
    const jobs = (data || []) as MaterializationJob[];
    claimed = jobs.length;

    for (const job of jobs) {
      try {
        // Versão atual do PV — pode ter avançado se outro comando sync rodou.
        const { data: soRow, error: soErr } = await admin
          .from("sale_orders")
          .select("order_version, status, command_phase")
          .eq("id", job.sale_order_id)
          .maybeSingle();
        if (soErr) throw new Error(`load pv: ${soErr.message}`);
        const expectedVersion = Number(
          soRow?.order_version ?? job.expected_order_version,
        ) || 0;

        const { data: receiptRaw, error: execErr } = await admin.rpc(
          "execute_sale_order_command",
          {
            p_sale_order_id: job.sale_order_id,
            p_command: job.command_name,
            p_expected_order_version: expectedVersion,
            p_idempotency_key: job.idempotency_key,
            p_payload: {
              ...(job.payload || {}),
              ...(job.command_name === "transition"
                ? { target_status: job.target_status }
                : {}),
            },
            p_override_id: job.override_id,
          },
        );
        if (execErr) throw new Error(execErr.message);

        const receipt = (receiptRaw || {}) as Record<string, unknown>;
        if (receipt.ok !== true) {
          const errObj = (receipt.error || {}) as Record<string, unknown>;
          throw new Error(
            String(errObj.message || errObj.code || "execute_sale_order_command recusou"),
          );
        }

        // Gate de materiais pós-sucesso (antes bloqueava o browser).
        try {
          await admin.rpc("recompute_material_gate_for_sale_orders", {
            p_sale_order_ids: [job.sale_order_id],
          });
        } catch (gateErr) {
          console.warn(
            "materialization: material gate pós-commit falhou",
            errorMessage(gateErr),
          );
        }

        const { data: completed, error: completeErr } = await admin.rpc(
          "complete_sale_order_materialization_job",
          {
            p_job_id: job.id,
            p_worker_id: workerId,
            p_lock_token: job.lock_token,
            p_receipt_id: receipt.receipt_id ?? null,
          },
        );
        if (completeErr) throw new Error(`complete: ${completeErr.message}`);
        if (completed !== true) throw new Error("complete recusou job sem lock do worker");

        succeeded += 1;
        results.push({
          id: job.id,
          sale_order_id: job.sale_order_id,
          command: job.command_name,
          ok: true,
          ops_criadas: (receipt.result as Record<string, unknown> | undefined)?.ops_criadas,
        });
      } catch (jobError) {
        const message = errorMessage(jobError);
        const busy = isBusyError(message);
        const { data: nextStatus, error: failErr } = await admin.rpc(
          "fail_sale_order_materialization_job",
          {
            p_job_id: job.id,
            p_worker_id: workerId,
            p_lock_token: job.lock_token,
            p_error: message,
            p_retry_after_seconds: busy ? retryAfterSeconds(job.attempts) : 5,
            p_dead_letter: false,
          },
        );
        if (failErr) {
          console.error(`materialization ${job.id}: falha ao registrar retry`, failErr.message);
        }
        if (nextStatus === "dead_letter") deadLetter += 1;
        else failed += 1;
        results.push({
          id: job.id,
          sale_order_id: job.sale_order_id,
          command: job.command_name,
          ok: false,
          status: String(nextStatus || "unknown"),
          error: message,
        });
      }
    }
  } catch (error) {
    topLevelError = errorMessage(error);
    console.error("process-sale-order-materialization:", topLevelError);
  }

  // Se ainda há pendentes e processamos 1, agenda outro wake (pipeline).
  if (!topLevelError && succeeded + failed + deadLetter > 0) {
    try {
      await admin.rpc("trigger_sale_order_materialization_worker");
    } catch (wakeErr) {
      console.warn("materialization: wake follow-up falhou", errorMessage(wakeErr));
    }
  }

  const response = {
    worker_id: workerId,
    claimed,
    succeeded,
    failed,
    dead_letter: deadLetter,
    duration_ms: Math.max(0, Date.now() - startedAt),
    error: topLevelError,
    results,
  };
  return new Response(JSON.stringify(response), {
    status: topLevelError ? 500 : 200,
    headers: corsHeaders,
  });
});

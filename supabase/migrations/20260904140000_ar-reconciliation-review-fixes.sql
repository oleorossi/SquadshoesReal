-- Code-review 2026-07-04 (setor de emissão de nota / contas a receber).
-- Correções server-side da reconciliação de AR introduzida em P0.4:
--
--   #1 Sub-faturamento permanente: v_faturado_sem_ar checava EXISTÊNCIA de
--      qualquer AR ativa, não COMPLETUDE. O insert de parcelas em
--      reconcileARInstallments é não-transacional (1 request por parcela). Se a
--      parcela 1 grava e a 2/N falha (race 23505, timeout de 60s da edge,
--      erro transitório), o PV passa a ter 1 AR ativa → some da view → o cron
--      nunca revisita → parcelas 2..N nunca nascem. Agora a view reaparece o PV
--      enquanto count(AR ativa) < max(total_installments).
--
--   #2 Receita fantasma: a classificação nf_externa aceitava so.nfe (texto)
--      preenchido. Mas so.nfe é populado pelo trigger sync_nfe_numero SÓ em NF
--      autorizada e NUNCA é limpo quando a NF é cancelada na SEFAZ e detectada
--      pelo poller (sync-nfe-from-provider não toca sale_orders). Resultado: PV
--      com NF cancelada continuava classificado nf_externa → cron recriava AR +
--      receita 'confirmed'. Removido so.nfe; NF externa = só marcador explícito
--      (nfe_external ou external_nfe_number).
--
--   #5 Divergência UI×servidor: a view era security_invoker=true, mas
--      nfe_emitidas tem RLS restrita a is_approved_user(). Um usuário não-aprovado
--      lendo a view no dashboard via EXISTS(nfe_emitidas ...) = false →
--      PV com NF autorizada aparecia como 'sem_nf' (remediação errada). A edge
--      function usa service role (correto). Definer torna a classificação
--      consistente pros dois leitores. A view só expõe colunas já legíveis por
--      authenticated em sale_orders (RLS USING true) — não vaza dado protegido.
--
--   #6 Halt silencioso: net.http_post (trigger_sync_ar_cron) é fire-and-forget →
--      cron.job_run_details fica "verde" mesmo se a sync-ar retornar 500 ou
--      estourar o timeout. Tabela sync_ar_runs registra o resultado de cada
--      execução (heartbeat) pra tornar a falha detectável em /diagnostics.

-- ─────────────────────────────────────────────────────────────────────────────
-- #1 + #2 + #5 — v_faturado_sem_ar
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_faturado_sem_ar
WITH (security_invoker = false) AS   -- definer (#5): classificação consistente
                                     -- mesmo p/ usuário sem RLS em nfe_emitidas
SELECT so.id, so.order_number, so.client_name, so.total,
       so.delivery_deadline, so.nfe_first_due_date,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.nfe_emitidas n
                  WHERE n.sale_order_id = so.id AND n.status = 'autorizada') THEN 'nf_autorizada'
    -- #2: só marcador EXPLÍCITO de NF externa (removido o fallback so.nfe).
    WHEN COALESCE(so.nfe_external, false)
      OR NULLIF(btrim(COALESCE(so.external_nfe_number::text, '')), '') IS NOT NULL THEN 'nf_externa'
    ELSE 'sem_nf'
  END AS situacao_nf
FROM public.sale_orders so
WHERE so.status = 'Faturado'
  AND so.deleted_at IS NULL
  AND COALESCE(so.nfe_required, true) = true
  -- #1: "AR incompleta", não só "AR ausente". count(ativa) < max(total_installments)
  -- ⇒ PV reaparece pro cron completar as parcelas que faltaram no insert parcial.
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts_receivable ar
     WHERE ar.sale_order_id = so.id
       AND lower(COALESCE(ar.status, '')) NOT IN ('cancelled', 'cancelado')
     GROUP BY ar.sale_order_id
     HAVING count(*) >= COALESCE(max(ar.total_installments), 1));

GRANT SELECT ON public.v_faturado_sem_ar TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- #6 — heartbeat da edge function sync-ar
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sync_ar_runs (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at   timestamptz NOT NULL DEFAULT now(),
  trigger  text NOT NULL DEFAULT 'cron',   -- 'cron' | 'manual' | 'single'
  scanned  int  NOT NULL DEFAULT 0,
  synced   int  NOT NULL DEFAULT 0,
  failed   int  NOT NULL DEFAULT 0,
  error    text
);

COMMENT ON TABLE public.sync_ar_runs IS
  'Resultado de cada execução da edge function sync-ar. Detecta halt silencioso: '
  'net.http_post (trigger_sync_ar_cron) é fire-and-forget, então cron.job_run_details '
  'fica verde mesmo com 500/timeout. code-review 2026-07-04 finding #6.';

CREATE INDEX IF NOT EXISTS idx_sync_ar_runs_ran_at ON public.sync_ar_runs (ran_at DESC);

ALTER TABLE public.sync_ar_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view sync_ar_runs" ON public.sync_ar_runs;
CREATE POLICY "Auth users can view sync_ar_runs"
  ON public.sync_ar_runs FOR SELECT TO authenticated USING (true);

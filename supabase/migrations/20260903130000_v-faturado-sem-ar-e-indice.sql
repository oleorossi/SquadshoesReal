-- P0.4 — detecção server-side do loop AR aberto + blindagem contra duplicata.
--
-- v_faturado_sem_ar: todo PV 'Faturado' (não deletado, que exige NF) sem conta a
-- receber ativa, categorizado por situação da NF:
--   nf_autorizada → reconciliável (gate de receita passa)
--   nf_externa    → reconciliável desde a extensão do gate (2026-07-03)
--   sem_nf        → exige decisão humana (backfill autorizado via sync-ar force)
-- Substitui a detecção client-side de useReconcileMissingAR (que só via
-- nf_autorizada) e alimenta a edge function sync-ar (cron */30).
--
-- Índice único parcial: (sale_order_id, parcela) ativo — torna seguro qualquer
-- executor concorrente (2 abas, cron + UI). Dedup pré-flight verificado em
-- 03/07: zero duplicatas ativas.

CREATE OR REPLACE VIEW public.v_faturado_sem_ar
WITH (security_invoker = true) AS
SELECT so.id, so.order_number, so.client_name, so.total,
       so.delivery_deadline, so.nfe_first_due_date,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.nfe_emitidas n
                  WHERE n.sale_order_id = so.id AND n.status = 'autorizada') THEN 'nf_autorizada'
    WHEN COALESCE(so.nfe_external, false)
      OR NULLIF(btrim(COALESCE(so.external_nfe_number::text, '')), '') IS NOT NULL
      OR NULLIF(btrim(COALESCE(so.nfe::text, '')), '') IS NOT NULL THEN 'nf_externa'
    ELSE 'sem_nf'
  END AS situacao_nf
FROM public.sale_orders so
WHERE so.status = 'Faturado'
  AND so.deleted_at IS NULL
  AND COALESCE(so.nfe_required, true) = true
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts_receivable ar
     WHERE ar.sale_order_id = so.id
       AND lower(COALESCE(ar.status, '')) NOT IN ('cancelled', 'cancelado'));

GRANT SELECT ON public.v_faturado_sem_ar TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_sale_order_installment
  ON public.accounts_receivable (sale_order_id, COALESCE(installment_number, 1))
  WHERE sale_order_id IS NOT NULL
    AND lower(COALESCE(status, '')) NOT IN ('cancelled', 'cancelado');

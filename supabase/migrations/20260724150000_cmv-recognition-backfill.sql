-- =============================================================================
-- Decisão Leonardo 2026-06-14 — CMV cash matching: BACKFILL do reconhecido
-- =============================================================================
-- Semeia sale_order_cmv_recognized pros pagamentos JÁ existentes. Roda DEPOIS de
-- 20260724140000 (infra) e de 20260724120000 (AR bruta) — então recompute usa a
-- base de rateio já bruta. Idempotente (recompute faz upsert/delete).
-- =============================================================================

DO $backfill$
DECLARE
  r RECORD;
  n int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT sale_order_id
      FROM public.accounts_receivable
     WHERE sale_order_id IS NOT NULL
       AND COALESCE(amount_received, 0) > 0
       AND status NOT IN ('cancelled', 'cancelado')
  LOOP
    PERFORM public.recompute_sale_order_cmv_recognition(r.sale_order_id);
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'CMV cash-matching backfill: reconhecimento recalculado para % PVs com recebimento.', n;
END
$backfill$;

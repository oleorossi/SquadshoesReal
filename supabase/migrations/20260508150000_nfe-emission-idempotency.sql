-- =============================================================================
-- Audit-2 Batch L: prevent duplicate active NF-e per sale order
-- =============================================================================
--
-- Problem (audit emit-nfe #1/#3): the edge function emit-nfe inserts a new
-- nfe_emitidas row without checking whether an active one already exists for
-- the same sale_order_id. A double-click, network retry or two concurrent
-- browser tabs would submit two requests to SEFAZ via Focus NFe and create
-- two distinct fiscal documents for the same sale — fiscal duplication that
-- pollutes SEFAZ records and breaks audit reconciliation.
--
-- This migration adds a partial unique index that guarantees AT MOST ONE row
-- with status in ('processando','autorizada') per sale_order_id. The edge
-- function gets a complementary pre-check (commit accompanying this migration)
-- so the typical case fails with a clean 409 instead of a constraint error.
--
-- 'rejeitada' and 'cancelada' status are NOT covered by the index — a rejected
-- emission is meant to be retried, and a cancelled one is fiscally finalised.
-- =============================================================================

-- Pre-flight: warn if duplicates already exist. Resolve manually before the
-- index is created (the CREATE UNIQUE INDEX would fail if duplicates remain).
DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT count(*) INTO v_dup_count
    FROM (
      SELECT sale_order_id
        FROM public.nfe_emitidas
       WHERE sale_order_id IS NOT NULL
         AND status IN ('processando', 'autorizada')
       GROUP BY sale_order_id
      HAVING count(*) > 1
    ) t;

  IF v_dup_count > 0 THEN
    RAISE WARNING
      'nfe_emitidas: % sale_order_id(s) have multiple active NF-es (status processando/autorizada). '
      'Review and cancel the wrong one in Focus NFe before applying the unique index. '
      'Run: SELECT sale_order_id, count(*) FROM nfe_emitidas WHERE status IN (''processando'',''autorizada'') GROUP BY sale_order_id HAVING count(*) > 1;',
      v_dup_count;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_nfe_active_per_sale_order
  ON public.nfe_emitidas (sale_order_id)
  WHERE status IN ('processando', 'autorizada');

COMMENT ON INDEX public.uq_nfe_active_per_sale_order IS
  'Prevents duplicate active NF-e per sale_order_id. Allows multiple rejeitadas '
  'or canceladas (legitimate retries). Enforces fiscal uniqueness even if the '
  'app-level pre-check in emit-nfe is bypassed.';

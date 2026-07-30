-- =============================================================================
-- Fix NF-e partial unique index to cover 'cancelando' status
-- =============================================================================
-- Audit-35 finding [1]: The partial unique index uq_nfe_active_per_sale_order
-- only covers status IN ('processando','autorizada'). During the in-flight
-- cancellation window (status='cancelando', up to 30s HTTP call to Focus NFe),
-- a concurrent re-emission passes the pre-check and POSTs a second NF-e to
-- Focus NFe, and the PV-cancel guard in useSaleOrders lets the operator cancel
-- the PV while the NF-e cancellation is in flight.
--
-- Fix: recreate the index including 'cancelando' so all three guards
-- (unique index, emit-nfe pre-check, useSaleOrders status guard) are aligned.
-- emit-nfe/index.ts and useSaleOrders.ts are patched in the same commit.
-- =============================================================================

DROP INDEX IF EXISTS public.uq_nfe_active_per_sale_order;

CREATE UNIQUE INDEX uq_nfe_active_per_sale_order
  ON public.nfe_emitidas (sale_order_id)
  WHERE status IN ('processando', 'autorizada', 'cancelando');

COMMENT ON INDEX public.uq_nfe_active_per_sale_order IS
  'Prevents duplicate active/in-flight NF-e for the same sale order. '
  'Covers processando (submitted to Focus), autorizada (SEFAZ-confirmed), '
  'and cancelando (cancellation in flight) to block concurrent re-emission '
  'and PV cancellation during the Focus NFe HTTP window.';

-- =============================================================================
-- Fix uq_ap_per_service_order partial unique index
-- =============================================================================
--
-- The original index (20260519120000) blocks INSERT when ANY AP row exists for
-- a service_order — including rows with status='cancelled'. This prevents a
-- re-completed OS (Concluído→Cancelado→Concluído) from creating a new AP after
-- the prior one was cancelled, silently dropping the contractor payment.
--
-- Fix: add `status <> 'cancelled'` to the WHERE clause so cancelled rows are
-- excluded from uniqueness enforcement.
-- =============================================================================

DROP INDEX IF EXISTS public.uq_ap_per_service_order;

CREATE UNIQUE INDEX uq_ap_per_service_order
  ON public.accounts_payable (reference_id)
  WHERE reference_type = 'service_order'
    AND status <> 'cancelled';

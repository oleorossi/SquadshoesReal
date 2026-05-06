-- Prevent duplicate accounts_payable entries for the same purchase order.
-- The notes field carries "OC: <order_number>" so we use a partial unique index
-- based on (supplier_id, description) to catch exact duplicate calls.
-- A function-based approach covers the idempotency check done in the app layer.

-- Unique index: one pending/unpaid AP entry per (supplier_id, description).
-- This blocks the double-AP bug when handleSendToFinance + handleFinalize
-- are both called on the same OC without status transitioning in between.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_payable_supplier_desc_pending
  ON public.accounts_payable (supplier_id, description)
  WHERE status IN ('pending', 'approved');

COMMENT ON INDEX public.uq_accounts_payable_supplier_desc_pending IS
  'Prevents duplicate pending AP entries with the same supplier and description (guards against double-click / double-finalization of purchase orders).';

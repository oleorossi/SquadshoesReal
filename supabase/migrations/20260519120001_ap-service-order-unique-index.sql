-- Prevent duplicate accounts_payable rows for the same service_order.
-- Contractors.tsx already pre-checks for existing AP before insert, but a
-- partial unique index gives a hard guarantee against concurrent submissions
-- (two browser tabs finalising the same OS at the same moment).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_per_service_order
  ON public.accounts_payable (reference_id)
  WHERE reference_type = 'service_order';

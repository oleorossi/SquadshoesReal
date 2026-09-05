-- =============================================================================
-- NF de entrada ↔ Ordem de Compra
--
-- Uma conferência: a NF importa vinculada à OC escolhida. O estoque entra
-- pelo comando receive da OC (não pelo auto-lançamento da NF). O financeiro
-- já tem accounts_payable.purchase_order_id; a NF passa a guardar o mesmo
-- vínculo pra não creditar 2×.
-- =============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid
    REFERENCES public.purchase_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_purchase_order_id_idx
  ON public.invoices (purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;

COMMENT ON COLUMN public.invoices.purchase_order_id IS
  'OC conferida nesta NF de entrada. Estoque entra pelo receive da OC, não pelo auto-lançamento da NF.';

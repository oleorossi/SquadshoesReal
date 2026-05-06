-- Prevent duplicate accounts_receivable rows for the same sale_order when two
-- concurrent status transitions both find no active AR and both INSERT.
-- syncFinancialRecords (useSaleOrders.ts) already checks activeAR.length === 0
-- before inserting, but concurrent calls can race past that check.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_active_per_sale_order
  ON public.accounts_receivable (sale_order_id)
  WHERE status NOT IN ('cancelled', 'received') AND sale_order_id IS NOT NULL;

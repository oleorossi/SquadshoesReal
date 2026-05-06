-- ERP Improvements: promised_date on purchase_orders, credit_limit on clients,
-- performance indexes, and analytical views.

-- ─── purchase_orders: supplier delivery tracking ─────────────────────────────
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS promised_date date,
  ADD COLUMN IF NOT EXISTS received_date date;

-- ─── clients: credit limit ───────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0;

-- ─── orders: due_date column (added here so following indexes/views work) ────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS due_date date;

-- ─── accounts_receivable: client_id (added so index/view works) ──────────────
ALTER TABLE public.accounts_receivable
  ADD COLUMN IF NOT EXISTS client_id uuid;

-- ─── Performance indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_status       ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_due_date     ON public.orders(due_date);
CREATE INDEX IF NOT EXISTS idx_orders_sale_order   ON public.orders(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_ap_due_date         ON public.accounts_payable(due_date);
CREATE INDEX IF NOT EXISTS idx_ap_status           ON public.accounts_payable(status);
CREATE INDEX IF NOT EXISTS idx_ar_due_date         ON public.accounts_receivable(due_date);
CREATE INDEX IF NOT EXISTS idx_ar_status           ON public.accounts_receivable(status);
CREATE INDEX IF NOT EXISTS idx_ar_client_id        ON public.accounts_receivable(client_id);
CREATE INDEX IF NOT EXISTS idx_stock_mvmt_product  ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_po_status           ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier_id      ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_promised_date    ON public.purchase_orders(promised_date);

-- ─── View: client credit exposure ────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_client_credit_exposure CASCADE;
CREATE OR REPLACE VIEW public.v_client_credit_exposure AS
SELECT
  c.id                                                      AS client_id,
  c.razao_social,
  c.nome_fantasia,
  c.credit_limit,
  COALESCE(SUM(ar.amount - COALESCE(ar.amount_received, 0))
    FILTER (WHERE ar.status NOT IN ('received', 'cancelled')), 0)   AS open_exposure,
  c.credit_limit - COALESCE(SUM(ar.amount - COALESCE(ar.amount_received, 0))
    FILTER (WHERE ar.status NOT IN ('received', 'cancelled')), 0)   AS available_credit,
  COUNT(ar.id) FILTER (WHERE ar.status NOT IN ('received', 'cancelled')) AS open_ar_count
FROM public.clients c
LEFT JOIN public.accounts_receivable ar ON ar.client_id = c.id
GROUP BY c.id, c.razao_social, c.nome_fantasia, c.credit_limit;

-- RLS: same as clients (authenticated read)
DROP POLICY IF EXISTS "Auth users can view v_client_credit_exposure" ON public.v_client_credit_exposure;

-- ─── View: late production orders ────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_late_orders CASCADE;
CREATE OR REPLACE VIEW public.v_late_orders AS
SELECT
  o.id,
  o.order_number,
  o.status,
  o.reference_id,
  o.color,
  o.quantity,
  o.due_date,
  o.sale_order_id,
  ts.name  AS reference_name,
  ts.code  AS reference_code,
  so.client_name,
  so.order_number AS sale_order_number,
  (CURRENT_DATE - o.due_date) AS days_late
FROM public.orders o
LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
LEFT JOIN public.sale_orders      so ON so.id = o.sale_order_id
WHERE o.status IN ('Reservado', 'Em Produção')
  AND o.due_date IS NOT NULL
  AND o.due_date < CURRENT_DATE;

-- ─── View: purchase orders overdue (sent but promised_date passed) ────────────
DROP VIEW IF EXISTS public.v_overdue_purchase_orders CASCADE;
CREATE OR REPLACE VIEW public.v_overdue_purchase_orders AS
SELECT
  po.id,
  po.order_number,
  po.supplier_name,
  po.supplier_id,
  po.total_value,
  po.promised_date,
  (CURRENT_DATE - po.promised_date) AS days_overdue,
  po.status
FROM public.purchase_orders po
WHERE po.status IN ('sent', 'approved')
  AND po.promised_date IS NOT NULL
  AND po.promised_date < CURRENT_DATE;

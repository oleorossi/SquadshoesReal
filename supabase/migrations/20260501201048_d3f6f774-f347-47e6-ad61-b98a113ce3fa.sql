-- === 20260420100000_erp-improvements.sql ===

-- Adicionando coluna de limite de crédito se não existir
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0;

-- Índices básicos
CREATE INDEX IF NOT EXISTS idx_orders_status       ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_sale_order   ON public.orders(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_ap_due_date         ON public.accounts_payable(due_date);
CREATE INDEX IF NOT EXISTS idx_ap_status           ON public.accounts_payable(status);
CREATE INDEX IF NOT EXISTS idx_ar_due_date         ON public.accounts_receivable(due_date);
CREATE INDEX IF NOT EXISTS idx_ar_status           ON public.accounts_receivable(status);
CREATE INDEX IF NOT EXISTS idx_stock_mvmt_product  ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_po_status           ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier_id      ON public.purchase_orders(supplier_id);

-- View de Exposição de Crédito
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
LEFT JOIN public.accounts_receivable ar ON ar.client_cnpj = c.cnpj
GROUP BY c.id, c.razao_social, c.nome_fantasia, c.credit_limit;

-- View de Ordens Atrasadas
DROP VIEW IF EXISTS public.v_late_orders CASCADE;
CREATE OR REPLACE VIEW public.v_late_orders AS
SELECT
  o.id,
  o.order_number,
  o.status,
  o.reference_id,
  o.color,
  o.quantity,
  o.created_at::date AS due_date,
  o.sale_order_id,
  ts.name  AS reference_name,
  ts.code  AS reference_code,
  so.client_name,
  so.order_number AS sale_order_number,
  (CURRENT_DATE - o.created_at::date) AS days_late
FROM public.orders o
LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
LEFT JOIN public.sale_orders      so ON so.id = o.sale_order_id
WHERE o.status IN ('Reservado', 'Em Produção')
  AND o.created_at IS NOT NULL
  AND o.created_at::date < CURRENT_DATE;

-- View de Ordens de Compra Atrasadas
DROP VIEW IF EXISTS public.v_overdue_purchase_orders CASCADE;
CREATE OR REPLACE VIEW public.v_overdue_purchase_orders AS
SELECT
  po.id,
  po.order_number,
  po.supplier_name,
  po.supplier_id,
  po.total_value,
  po.created_at::date AS promised_date,
  (CURRENT_DATE - po.created_at::date) AS days_overdue,
  po.status
FROM public.purchase_orders po
WHERE po.status IN ('sent', 'approved')
  AND po.created_at IS NOT NULL
  AND po.created_at::date < CURRENT_DATE;
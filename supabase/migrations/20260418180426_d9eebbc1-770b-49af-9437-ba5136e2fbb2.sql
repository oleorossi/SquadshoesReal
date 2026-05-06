-- Performance: indexes for hot queries
CREATE INDEX IF NOT EXISTS idx_orders_created_at_desc ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_reference_id ON public.orders (reference_id);
CREATE INDEX IF NOT EXISTS idx_orders_planned_delivery ON public.orders (planned_delivery);

CREATE INDEX IF NOT EXISTS idx_sale_orders_created_at_desc ON public.sale_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_orders_status ON public.sale_orders (status);
CREATE INDEX IF NOT EXISTS idx_sale_orders_client_id ON public.sale_orders (client_id);
CREATE INDEX IF NOT EXISTS idx_sale_orders_delivery ON public.sale_orders (delivery_month, delivery_week);

CREATE INDEX IF NOT EXISTS idx_sale_order_items_sale_order_id ON public.sale_order_items (sale_order_id);

CREATE INDEX IF NOT EXISTS idx_order_stages_order_id ON public.order_stages (order_id);
CREATE INDEX IF NOT EXISTS idx_order_stages_stage_status ON public.order_stages (stage_name, status);

CREATE INDEX IF NOT EXISTS idx_ap_due_date ON public.accounts_payable (due_date);
CREATE INDEX IF NOT EXISTS idx_ap_status ON public.accounts_payable (status);
CREATE INDEX IF NOT EXISTS idx_ap_supplier_id ON public.accounts_payable (supplier_id);
CREATE INDEX IF NOT EXISTS idx_ar_due_date ON public.accounts_receivable (due_date);
CREATE INDEX IF NOT EXISTS idx_ar_status ON public.accounts_receivable (status);
CREATE INDEX IF NOT EXISTS idx_ar_sale_order_id ON public.accounts_receivable (sale_order_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON public.stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at_desc ON public.stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_order_id ON public.stock_movements (order_id);

CREATE INDEX IF NOT EXISTS idx_material_reservations_order_id ON public.material_reservations (order_id);
CREATE INDEX IF NOT EXISTS idx_material_reservations_product_id ON public.material_reservations (product_id);
CREATE INDEX IF NOT EXISTS idx_material_reservations_status ON public.material_reservations (status);

CREATE INDEX IF NOT EXISTS idx_products_group_id ON public.products (group_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products (active);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp_desc ON public.audit_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs (resource, resource_id);

ANALYZE public.orders;
ANALYZE public.sale_orders;
ANALYZE public.accounts_payable;
ANALYZE public.accounts_receivable;
ANALYZE public.stock_movements;
ANALYZE public.material_reservations;
ANALYZE public.products;
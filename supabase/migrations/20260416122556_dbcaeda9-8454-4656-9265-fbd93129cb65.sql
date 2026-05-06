-- 1. Índices para acelerar o Kanban de Produção
CREATE INDEX IF NOT EXISTS idx_orders_status_sector ON orders(status, production_step);
CREATE INDEX IF NOT EXISTS idx_order_stages_order_id ON order_stages(order_id);

-- 2. Índices para o MRP e Reservas
CREATE INDEX IF NOT EXISTS idx_mat_reservations_product_status ON material_reservations(product_id, status);

-- 3. Índices para o CFO Virtual (Fluxo de Caixa rápido)
CREATE INDEX IF NOT EXISTS idx_ap_due_date_status ON accounts_payable(due_date, status);
CREATE INDEX IF NOT EXISTS idx_ar_due_date_status ON accounts_receivable(due_date, status);
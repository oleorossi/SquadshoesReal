-- Índices otimizados para consultas frequentes
CREATE INDEX idx_products_category_active ON products(category, active) WHERE active = true;
CREATE INDEX idx_products_low_stock ON products(quantity, min_stock) WHERE quantity <= min_stock;
CREATE INDEX idx_orders_status_date ON orders(status, created_at);
CREATE INDEX idx_audit_logs_user_date ON audit_logs(user_id, created_at);

-- Índices compostos para queries complexas
CREATE INDEX idx_products_search ON products USING gin(to_tsvector('portuguese', name || ' ' || coalesce(sku, '')));

-- 1. Add supplier lead time column to products
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS supplier_lead_time_days INT DEFAULT 7;

-- 2. Create the purchase projection timeline view
CREATE OR REPLACE VIEW public.purchase_projection_timeline AS
SELECT 
    o.id AS order_id,
    o.order_number AS pedido_ref,
    o.sale_order_id,
    so.delivery_deadline AS data_entrega_cliente,
    o.quantity AS op_quantity,
    (so.delivery_deadline::date - 5) AS data_inicio_producao,
    m.id AS material_id,
    m.name AS material,
    m.group_id AS material_group_id,
    pg.name AS grupo_material,
    m.unit AS unidade,
    m.quantity AS estoque_atual,
    m.min_stock,
    m.supplier_lead_time_days,
    m.supplier_id,
    sup.name AS supplier_name,
    COALESCE(sm.quantity_per_unit, 1) * o.quantity AS quantidade_necessaria,
    (so.delivery_deadline::date - 5 - COALESCE(m.supplier_lead_time_days, 7)) AS data_limite_compra,
    o.status AS order_status,
    o.reference_id,
    ts.name AS referencia_nome
FROM public.orders o
JOIN public.sale_orders so ON so.id = o.sale_order_id
JOIN public.technical_sheets ts ON ts.id = o.reference_id
JOIN public.sheet_materials sm ON sm.sheet_id = ts.id
JOIN public.products m ON m.id = sm.product_id
LEFT JOIN public.product_groups pg ON pg.id = m.group_id
LEFT JOIN public.suppliers sup ON sup.id = m.supplier_id
WHERE o.status NOT IN ('Pronto', 'FINALIZADO', 'Cancelado')
  AND so.delivery_deadline IS NOT NULL;

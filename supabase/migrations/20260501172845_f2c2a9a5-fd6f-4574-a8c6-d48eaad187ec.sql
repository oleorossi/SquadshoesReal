-- Atualizar a view v_mrp_needs com nomes de colunas corretos (v3)
DROP VIEW IF EXISTS public.v_mrp_needs;

CREATE VIEW public.v_mrp_needs
WITH (security_invoker = true) AS
WITH demand AS (
  SELECT * FROM public.fn_projected_demand()
),
po_open AS (
  -- Ordens de compra abertas (que ainda vão entrar no estoque)
  SELECT 
    poi.product_id, 
    SUM(poi.quantity) AS qty_in_pipeline
  FROM public.purchase_order_items poi
  JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
  WHERE po.status IN ('pending', 'ordered')
  GROUP BY poi.product_id
),
reserved AS (
  -- Estoque já reservado para OPs
  SELECT 
    product_id, 
    SUM(quantity_reserved) AS total_reserved
  FROM public.material_reservations
  WHERE status = 'active'
  GROUP BY product_id
)
SELECT 
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  p.unit, -- Corrigido para 'unit'
  p.quantity AS current_stock,
  COALESCE(r.total_reserved, 0) AS reserved_stock,
  -- Estoque livre para novos pedidos
  (p.quantity - COALESCE(r.total_reserved, 0)) AS available_now,
  COALESCE(d.total_required, 0) AS total_demand,
  COALESCE(po.qty_in_pipeline, 0) AS incoming_stock,
  p.min_stock,
  -- Sugestão de compra: Demanda + Min_Stock - (Estoque Livre + Incoming)
  GREATEST(
    COALESCE(d.total_required, 0) + p.min_stock - (p.quantity - COALESCE(r.total_reserved, 0) + COALESCE(po.qty_in_pipeline, 0)),
    0
  ) AS suggested_qty,
  (d.earliest_deadline - (p.lead_time_days || ' days')::interval)::date AS order_by_date,
  s.name AS supplier_name
FROM public.products p
LEFT JOIN demand d ON d.product_id = p.id
LEFT JOIN po_open po ON po.product_id = p.id
LEFT JOIN reserved r ON r.product_id = p.id
LEFT JOIN public.suppliers s ON s.id = p.preferred_supplier_id
WHERE COALESCE(d.total_required, 0) > 0 
   OR p.quantity < p.min_stock;
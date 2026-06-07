-- Fix #3 (auditoria 2026-06-06): v_mrp_needs contava OCs status='suggested' (geradas
-- automaticamente pelo ROP, NÃO colocadas a fornecedor) no pipeline qty_in_po → laço de
-- auto-supressão: ROP sugere, MRP acha que já comprou, para de sugerir. Exclui 'suggested'.
CREATE OR REPLACE VIEW public.v_mrp_needs AS
WITH demand AS (
  SELECT product_id, product_name, total_required, earliest_deadline, orders_count, order_ids
  FROM fn_projected_demand() fn_projected_demand(product_id, product_name, total_required, earliest_deadline, orders_count, order_ids)
), po_open AS (
  SELECT poi.product_id, sum(poi.quantity) AS qty_in_pipeline
  FROM purchase_order_items poi
    JOIN purchase_orders po_1 ON po_1.id = poi.purchase_order_id
  WHERE po_1.status <> ALL (ARRAY['cancelled'::text, 'received'::text, 'suggested'::text])
  GROUP BY poi.product_id
), reserved AS (
  SELECT material_reservations.product_id,
    sum(material_reservations.quantity_reserved - material_reservations.quantity_consumed) AS qty_reserved
  FROM material_reservations
  WHERE material_reservations.status = ANY (ARRAY['reserved'::text, 'partially_consumed'::text])
  GROUP BY material_reservations.product_id
)
SELECT p.id AS product_id, p.name AS product_name, p.sku, p.category, p.unit, p.unit_price,
  p.purchase_order_unit, COALESCE(p.conversion_rate, 1::numeric) AS conversion_rate,
  p.min_order_quantity, p.lead_time_days, p.preferred_supplier_id, s.name AS supplier_name,
  p.min_stock, p.quantity AS on_hand, COALESCE(r.qty_reserved, 0::numeric) AS reserved,
  GREATEST(p.quantity - COALESCE(r.qty_reserved, 0::numeric), 0::numeric) AS available_now,
  COALESCE(po.qty_in_pipeline, 0::numeric) AS qty_in_po,
  COALESCE(d.total_required, 0::numeric) AS projected_demand,
  d.earliest_deadline, d.orders_count,
  GREATEST(COALESCE(d.total_required, 0::numeric) + p.min_stock - p.quantity - COALESCE(po.qty_in_pipeline, 0::numeric), 0::numeric) AS suggested_qty,
  (d.earliest_deadline - ((p.lead_time_days || ' days'::text)::interval))::date AS order_by_date
FROM products p
  LEFT JOIN demand d ON d.product_id = p.id
  LEFT JOIN po_open po ON po.product_id = p.id
  LEFT JOIN reserved r ON r.product_id = p.id
  LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
WHERE COALESCE(d.total_required, 0::numeric) > 0::numeric OR p.quantity < p.min_stock;

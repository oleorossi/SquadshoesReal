-- ---------------------------------------------------------------
-- Fix v_mrp_needs:
--   suggested_qty now uses available_now (on_hand minus reserved)
--   instead of raw on_hand.  Orders in 'reserved' or
--   'partially_consumed' status lock those units — the MRP must
--   treat them as unavailable when calculating what to buy.
--
--   Old: total_required + min_stock - quantity - qty_in_po
--   New: total_required + min_stock - available_now - qty_in_po
--        where available_now = GREATEST(quantity - reserved, 0)
-- ---------------------------------------------------------------

DROP VIEW IF EXISTS public.v_mrp_needs;

CREATE VIEW public.v_mrp_needs
WITH (security_invoker = true) AS
WITH demand AS (SELECT * FROM public.fn_projected_demand()),
po_open AS (
  SELECT poi.product_id, SUM(poi.quantity) AS qty_in_pipeline
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
   WHERE po.status NOT IN ('Cancelado', 'Recebido')
   GROUP BY poi.product_id
),
reserved AS (
  SELECT product_id, SUM(quantity_reserved - quantity_consumed) AS qty_reserved
    FROM public.material_reservations
   WHERE status IN ('reserved','partially_consumed')
   GROUP BY product_id
)
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  p.category,
  p.unit,
  p.unit_price,
  p.purchase_order_unit,
  COALESCE(p.conversion_rate, 1) AS conversion_rate,
  p.min_order_quantity,
  p.lead_time_days,
  p.preferred_supplier_id,
  s.name AS supplier_name,
  p.min_stock,
  p.quantity AS on_hand,
  COALESCE(r.qty_reserved, 0) AS reserved,
  GREATEST(p.quantity - COALESCE(r.qty_reserved, 0), 0) AS available_now,
  COALESCE(po.qty_in_pipeline, 0) AS qty_in_po,
  COALESCE(d.total_required, 0) AS projected_demand,
  d.earliest_deadline,
  d.orders_count,
  GREATEST(
    COALESCE(d.total_required, 0) + p.min_stock
      - GREATEST(p.quantity - COALESCE(r.qty_reserved, 0), 0)
      - COALESCE(po.qty_in_pipeline, 0),
    0
  ) AS suggested_qty,
  (d.earliest_deadline - (p.lead_time_days || ' days')::interval)::date AS order_by_date
FROM public.products p
LEFT JOIN demand   d  ON d.product_id  = p.id
LEFT JOIN po_open  po ON po.product_id = p.id
LEFT JOIN reserved r  ON r.product_id  = p.id
LEFT JOIN public.suppliers s ON s.id = p.preferred_supplier_id
WHERE COALESCE(d.total_required, 0) > 0
   OR p.quantity < p.min_stock;

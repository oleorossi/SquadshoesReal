-- ════════════════════════════════════════════════════════════════════════════
-- Fix ALTO + MÉDIO (auditoria 2026-06-11) — v_mrp_needs
-- ════════════════════════════════════════════════════════════════════════════
-- (ALTO) suggested_qty usava p.quantity (estoque BRUTO), regredindo o fix
--   20260503130000 que passou a deduzir reserva. available_now já deduzia, mas
--   suggested_qty não → o MRP ignorava estoque reservado e sugeria comprar de
--   MENOS (otimista). Passa a usar GREATEST(quantity − reserved, 0).
--
-- (MÉDIO) o CTE po_open excluía só status em inglês/minúsculo
--   ('cancelled','received','suggested'). As OCs do sistema têm grafias mistas
--   PT+EN; uma OC 'Recebido'/'Cancelado' (PT) era contada em qty_in_pipeline,
--   suprimindo sugestão mesmo já tendo chegado/sido cancelada. Normaliza com
--   unaccent(lower(...)) e exclui ambas as grafias.

CREATE OR REPLACE VIEW public.v_mrp_needs AS
WITH demand AS (
  SELECT product_id, product_name, total_required, earliest_deadline, orders_count, order_ids
  FROM fn_projected_demand() fn_projected_demand(product_id, product_name, total_required, earliest_deadline, orders_count, order_ids)
), po_open AS (
  SELECT poi.product_id, sum(poi.quantity) AS qty_in_pipeline
  FROM purchase_order_items poi
    JOIN purchase_orders po_1 ON po_1.id = poi.purchase_order_id
  -- Normaliza grafia (PT+EN) antes de excluir cancelado/recebido/sugerido.
  WHERE lower(extensions.unaccent(COALESCE(po_1.status, ''))) <> ALL (ARRAY[
          'cancelled','cancelado','cancelada',
          'received','recebido','recebida',
          'suggested','sugerido','sugerida'])
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
  -- ALTO: deduz reserva (available_now), não estoque bruto.
  GREATEST(
    COALESCE(d.total_required, 0::numeric) + p.min_stock
      - GREATEST(p.quantity - COALESCE(r.qty_reserved, 0::numeric), 0::numeric)
      - COALESCE(po.qty_in_pipeline, 0::numeric),
    0::numeric) AS suggested_qty,
  (d.earliest_deadline - ((p.lead_time_days || ' days'::text)::interval))::date AS order_by_date
FROM products p
  LEFT JOIN demand d ON d.product_id = p.id
  LEFT JOIN po_open po ON po.product_id = p.id
  LEFT JOIN reserved r ON r.product_id = p.id
  LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
WHERE COALESCE(d.total_required, 0::numeric) > 0::numeric OR p.quantity < p.min_stock;

COMMENT ON VIEW public.v_mrp_needs IS
  'Necessidades de compra por produto. suggested_qty deduz reserva (available_now), '
  'não estoque bruto. po_open normaliza status PT+EN (não conta OC recebida/cancelada). '
  'Demanda via fn_projected_demand (já converte dm²→física).';

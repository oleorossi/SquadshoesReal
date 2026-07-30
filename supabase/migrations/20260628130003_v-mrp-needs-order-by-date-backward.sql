-- Auditoria 2026-06-28: v_mrp_needs.order_by_date = earliest_deadline − lead do
-- fornecedor em dias CORRIDOS, ignorando o lead de PRODUÇÃO → mandava comprar tarde.
-- Fix: usar o purchase_deadline da onda (backward completo = faturamento − produção
-- − buffer − fornecedor, mesmo join do auto_create_purchase_order); fallback quando
-- o produto não está em onda = earliest_deadline − supplier_lead em DIAS ÚTEIS.
-- (Aplicada via MCP. A OC do MRP já saía correta via tg_set_po_purchase_by_date;
-- isto corrige o DISPLAY do order_by_date nas telas de projeção/MRP.)
CREATE OR REPLACE VIEW public.v_mrp_needs AS
 WITH demand AS (
         SELECT fn_projected_demand.product_id,
            fn_projected_demand.product_name,
            fn_projected_demand.total_required,
            fn_projected_demand.earliest_deadline,
            fn_projected_demand.orders_count,
            fn_projected_demand.order_ids
           FROM fn_projected_demand() fn_projected_demand(product_id, product_name, total_required, earliest_deadline, orders_count, order_ids)
        ), po_open AS (
         SELECT poi.product_id,
            sum(poi.quantity) AS qty_in_pipeline
           FROM (purchase_order_items poi
             JOIN purchase_orders po_1 ON ((po_1.id = poi.purchase_order_id)))
          WHERE (po_1.status <> ALL (ARRAY['cancelled'::text, 'received'::text, 'suggested'::text]))
          GROUP BY poi.product_id
        ), reserved AS (
         SELECT material_reservations.product_id,
            sum((material_reservations.quantity_reserved - material_reservations.quantity_consumed)) AS qty_reserved
           FROM material_reservations
          WHERE (material_reservations.status = ANY (ARRAY['reserved'::text, 'partially_consumed'::text]))
          GROUP BY material_reservations.product_id
        ), wave_deadline AS (
         SELECT sm.product_id,
            min(pw.purchase_deadline) AS wave_purchase_deadline
           FROM production_waves pw
             JOIN production_wave_items pwi ON pwi.wave_id = pw.id
             JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
             JOIN sale_order_items soi ON soi.id = pwis.sale_order_item_id
             JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
          WHERE pw.status::text <> ALL (ARRAY['finished'::text, 'cancelled'::text])
            AND pw.purchase_deadline IS NOT NULL
          GROUP BY sm.product_id
        )
 SELECT p.id AS product_id,
    p.name AS product_name,
    p.sku,
    p.category,
    p.unit,
    p.unit_price,
    p.purchase_order_unit,
    COALESCE(p.conversion_rate, (1)::numeric) AS conversion_rate,
    p.min_order_quantity,
    p.lead_time_days,
    p.preferred_supplier_id,
    s.name AS supplier_name,
    p.min_stock,
    p.quantity AS on_hand,
    COALESCE(r.qty_reserved, (0)::numeric) AS reserved,
    GREATEST((p.quantity - COALESCE(r.qty_reserved, (0)::numeric)), (0)::numeric) AS available_now,
    COALESCE(po.qty_in_pipeline, (0)::numeric) AS qty_in_po,
    COALESCE(d.total_required, (0)::numeric) AS projected_demand,
    d.earliest_deadline,
    d.orders_count,
    GREATEST((((COALESCE(d.total_required, (0)::numeric) + p.min_stock) - p.quantity) - COALESCE(po.qty_in_pipeline, (0)::numeric)), (0)::numeric) AS suggested_qty,
    COALESCE(
      wd.wave_purchase_deadline,
      public.add_business_days(d.earliest_deadline, - COALESCE(p.lead_time_days, 0))
    ) AS order_by_date
   FROM ((((( products p
     LEFT JOIN demand d ON ((d.product_id = p.id)))
     LEFT JOIN po_open po ON ((po.product_id = p.id)))
     LEFT JOIN reserved r ON ((r.product_id = p.id)))
     LEFT JOIN wave_deadline wd ON ((wd.product_id = p.id)))
     LEFT JOIN suppliers s ON ((s.id = p.preferred_supplier_id)))
  WHERE ((COALESCE(d.total_required, (0)::numeric) > (0)::numeric) OR (p.quantity < p.min_stock));

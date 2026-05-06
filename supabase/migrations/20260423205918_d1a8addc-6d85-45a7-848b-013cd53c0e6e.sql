-- Drop and recreate view to avoid column mismatch error
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
  COALESCE(d.total_required, 0)   AS projected_demand,
  d.earliest_deadline,
  d.orders_count,
  GREATEST(
    COALESCE(d.total_required,0) + p.min_stock - p.quantity - COALESCE(po.qty_in_pipeline,0),
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

-- Update generate_purchase_orders_from_mrp function to handle conversion
CREATE OR REPLACE FUNCTION public.generate_purchase_orders_from_mrp(
  p_product_ids uuid[] DEFAULT NULL
) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_supplier uuid;
  v_po_id uuid;
  v_po_number text;
  v_qty_to_order numeric;
  v_unit_price_po numeric;
  v_unit_po text;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_mrp_needs
     WHERE suggested_qty > 0
       AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids))
     ORDER BY preferred_supplier_id NULLS LAST, product_name
  LOOP
    v_supplier := v_row.preferred_supplier_id;

    -- Calculate converted values
    v_qty_to_order := v_row.suggested_qty / COALESCE(v_row.conversion_rate, 1);
    v_unit_price_po := COALESCE(v_row.unit_price, 0) * COALESCE(v_row.conversion_rate, 1);
    v_unit_po := COALESCE(v_row.purchase_order_unit, v_row.unit);

    -- Apply min_order_quantity (usually in purchase units)
    v_qty_to_order := GREATEST(v_qty_to_order, COALESCE(v_row.min_order_quantity, 0));

    -- Round up for discrete units
    IF v_unit_po IN ('un', 'cx', 'rolo', 'chapa', 'unidade', 'par') THEN
      v_qty_to_order := CEIL(v_qty_to_order);
    END IF;

    SELECT id INTO v_po_id
      FROM public.purchase_orders
     WHERE supplier_id IS NOT DISTINCT FROM v_supplier
       AND status = 'Rascunho'
       AND created_at > now() - interval '2 minutes'
     LIMIT 1;

    IF v_po_id IS NULL THEN
      v_po_number := 'PO-MRP-' || to_char(now(),'YYYYMMDDHH24MISS') ||
                     '-' || substr(md5(random()::text),1,4);
      INSERT INTO public.purchase_orders
        (order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated)
      VALUES (
        v_po_number, 'Rascunho', v_supplier,
        COALESCE(v_row.supplier_name, ''),
        0,
        'Gerada automaticamente pelo MRP em ' || to_char(now(),'DD/MM/YYYY HH24:MI'),
        true
      ) RETURNING id INTO v_po_id;
    END IF;

    -- Insert item with converted values
    INSERT INTO public.purchase_order_items
      (purchase_order_id, product_id, quantity, unit_price, unit, current_stock, min_stock, suggested_quantity)
    VALUES (
      v_po_id, v_row.product_id,
      v_qty_to_order, v_unit_price_po, v_unit_po,
      v_row.on_hand, v_row.min_stock, v_row.suggested_qty
    );

    UPDATE public.purchase_orders
       SET total_value = (
         SELECT COALESCE(SUM(quantity * unit_price), 0)
           FROM public.purchase_order_items
          WHERE purchase_order_id = v_po_id
       ),
       updated_at = now()
     WHERE id = v_po_id;

    RETURN NEXT v_po_id;
  END LOOP;
END;
$$;
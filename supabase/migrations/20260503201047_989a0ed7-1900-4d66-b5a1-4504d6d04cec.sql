ALTER TABLE public.order_costs
  ADD COLUMN IF NOT EXISTS packaging_cost numeric DEFAULT 0;

CREATE OR REPLACE FUNCTION public.calculate_order_cost(
  p_sale_order_id uuid,
  p_sale_order_item_id uuid DEFAULT NULL,
  p_persist boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item record;
  v_ref uuid;
  v_color text;
  v_qty numeric;
  v_unit_price numeric;
  v_grade jsonb;
  v_cons jsonb;
  v_line jsonb;
  v_material numeric := 0;
  v_labor numeric := 0;
  v_overhead_pct numeric;
  v_overhead numeric := 0;
  v_packaging_per_pair numeric := 0;
  v_packaging numeric := 0;
  v_total numeric := 0;
  v_breakdown_materials jsonb := '[]'::jsonb;
  v_breakdown_labor jsonb := '[]'::jsonb;
  v_revenue numeric;
  v_margin numeric;
  v_margin_pct numeric;
  v_op record;
  v_prod record;
  v_out jsonb;
BEGIN
  SELECT i.id, i.reference_id, i.color, i.quantity, i.unit_price,
         CASE WHEN i.grade IS NOT NULL AND i.grade::text <> 'null' THEN i.grade ELSE NULL END AS grade,
         i.material_variant_id
    INTO v_item
    FROM public.sale_order_items i
   WHERE i.sale_order_id = p_sale_order_id
     AND (p_sale_order_item_id IS NULL OR i.id = p_sale_order_item_id)
   LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_ref        := v_item.reference_id;
  v_color      := v_item.color;
  v_qty        := v_item.quantity;
  v_unit_price := COALESCE(v_item.unit_price, 0);
  v_grade      := v_item.grade;

  SELECT COALESCE(overhead_pct, 0) / 100.0 INTO v_overhead_pct
    FROM public.cost_policies LIMIT 1;
  v_overhead_pct := COALESCE(v_overhead_pct, 0);

  SELECT COALESCE(packaging_cost_per_pair, 0) INTO v_packaging_per_pair
    FROM public.cost_policies LIMIT 1;
  v_packaging_per_pair := COALESCE(v_packaging_per_pair, 0);

  SELECT consumption_snapshot INTO v_cons
    FROM public.technical_sheet_snapshots
   WHERE sale_order_id = p_sale_order_id
     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)
   LIMIT 1;

  IF v_cons IS NULL THEN
    IF v_grade IS NOT NULL AND v_grade <> '{}'::jsonb THEN
      v_cons := public.calculate_order_consumption_by_grade(
        v_ref, v_grade, COALESCE(v_color, ''), v_item.material_variant_id
      );
    ELSE
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
        INTO v_cons
        FROM public.calculate_order_consumption(v_ref, v_qty, COALESCE(v_color,''), v_item.material_variant_id) c;
    END IF;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_cons) AS value LOOP
    SELECT unit_price, name INTO v_prod
      FROM public.products WHERE id = (v_line ->> 'product_id')::uuid;

    v_material := v_material + COALESCE(v_prod.unit_price,0) * (v_line ->> 'required')::numeric;

    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id',   v_line ->> 'product_id',
      'product_name', v_prod.name,
      'component',    v_line ->> 'component',
      'required',     (v_line ->> 'required')::numeric,
      'unit_price',   COALESCE(v_prod.unit_price,0),
      'subtotal',     COALESCE(v_prod.unit_price,0) * (v_line ->> 'required')::numeric
    );
  END LOOP;

  FOR v_op IN
    SELECT lc.operation_name, lc.hour_cost, o.minutes_per_unit
      FROM public.technical_sheet_operations o
      JOIN public.labor_costs lc ON lc.id = o.labor_cost_id
     WHERE o.sheet_id = v_ref
  LOOP
    v_labor := v_labor + (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty;
    v_breakdown_labor := v_breakdown_labor || jsonb_build_object(
      'operation',        v_op.operation_name,
      'hour_cost',        v_op.hour_cost,
      'minutes_per_unit', v_op.minutes_per_unit,
      'subtotal',         (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty
    );
  END LOOP;

  v_overhead  := v_overhead_pct * (v_material + v_labor);
  v_packaging := v_packaging_per_pair * v_qty;
  v_total     := v_material + v_labor + v_overhead + v_packaging;
  v_revenue   := v_unit_price * v_qty;
  v_margin    := v_revenue - v_total;
  v_margin_pct := CASE WHEN v_revenue > 0 THEN v_margin / v_revenue ELSE 0 END;

  v_out := jsonb_build_object(
    'material_cost',  v_material,
    'labor_cost',     v_labor,
    'overhead_cost',  v_overhead,
    'packaging_cost', v_packaging,
    'total_cost',     v_total,
    'revenue',        v_revenue,
    'margin',         v_margin,
    'margin_pct',     v_margin_pct,
    'breakdown', jsonb_build_object(
      'materials',          v_breakdown_materials,
      'labor',              v_breakdown_labor,
      'overhead_pct',       v_overhead_pct,
      'packaging_per_pair', v_packaging_per_pair,
      'used_grade',         v_grade IS NOT NULL AND v_grade <> '{}'::jsonb
    )
  );

  IF p_persist THEN
    INSERT INTO public.order_costs (
      sale_order_id, sale_order_item_id, reference_id, color, quantity,
      material_cost, labor_cost, overhead_cost, packaging_cost, total_cost,
      revenue, margin, margin_pct, breakdown
    ) VALUES (
      p_sale_order_id, v_item.id, v_ref, COALESCE(v_color,''), v_qty,
      v_material, v_labor, v_overhead, v_packaging, v_total,
      v_revenue, v_margin, v_margin_pct, v_out -> 'breakdown'
    )
    ON CONFLICT (sale_order_id, sale_order_item_id) DO UPDATE SET
      material_cost  = EXCLUDED.material_cost,
      labor_cost     = EXCLUDED.labor_cost,
      overhead_cost  = EXCLUDED.overhead_cost,
      packaging_cost = EXCLUDED.packaging_cost,
      total_cost     = EXCLUDED.total_cost,
      revenue        = EXCLUDED.revenue,
      margin         = EXCLUDED.margin,
      margin_pct     = EXCLUDED.margin_pct,
      breakdown      = EXCLUDED.breakdown,
      calculated_at  = now();
  END IF;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_cost(uuid, uuid, boolean) TO authenticated;
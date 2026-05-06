-- Remover gatilhos e funções de ressincronização
DROP TRIGGER IF EXISTS trg_resync_for_sole_conjugation ON public.sole_size_conjugations;
DROP FUNCTION IF EXISTS public.resync_op_atomic(uuid);
DROP FUNCTION IF EXISTS public.process_resync_queue(integer);
DROP TABLE IF EXISTS public.resync_queue;

-- Limpar colunas em production_consumptions
ALTER TABLE public.production_consumptions
  DROP COLUMN IF EXISTS superseded_at,
  DROP COLUMN IF EXISTS superseded_reason;

-- Restaurar versão original de calculate_order_cost (removendo embalagem)
CREATE OR REPLACE FUNCTION public.calculate_order_cost(p_sale_order_id uuid, p_sale_order_item_id uuid DEFAULT NULL::uuid, p_persist boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_item record;
  v_ref uuid;
  v_color text;
  v_qty numeric;
  v_unit_price numeric;
  v_cons jsonb;
  v_line jsonb;
  v_material numeric := 0;
  v_labor numeric := 0;
  v_overhead_pct numeric;
  v_overhead numeric := 0;
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
  SELECT value INTO v_overhead_pct FROM public.cost_parameters WHERE key = 'overhead_pct';
  v_overhead_pct := COALESCE(v_overhead_pct, 0);

  SELECT soi.id, soi.reference_id, soi.color, soi.quantity, soi.unit_price
    INTO v_item
    FROM public.sale_order_items soi
   WHERE soi.sale_order_id = p_sale_order_id
     AND (p_sale_order_item_id IS NULL OR soi.id = p_sale_order_item_id)
   ORDER BY soi.created_at
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item do pedido não encontrado (order=%, item=%)',
      p_sale_order_id, p_sale_order_item_id;
  END IF;

  v_ref := v_item.reference_id; v_color := v_item.color;
  v_qty := v_item.quantity; v_unit_price := v_item.unit_price;

  SELECT consumption_snapshot INTO v_cons
    FROM public.technical_sheet_snapshots
   WHERE sale_order_id = p_sale_order_id
     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)
   LIMIT 1;

  IF v_cons IS NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      INTO v_cons
      FROM public.calculate_order_consumption(v_ref, v_qty, COALESCE(v_color,''), NULL) c;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_cons) AS value LOOP
    SELECT unit_price, name INTO v_prod
      FROM public.products WHERE id = (v_line ->> 'product_id')::uuid;
    v_material := v_material + COALESCE(v_prod.unit_price,0) * (v_line ->> 'required')::numeric;
    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id', v_line ->> 'product_id',
      'product_name', v_prod.name,
      'component', v_line ->> 'component',
      'required', (v_line ->> 'required')::numeric,
      'unit_price', COALESCE(v_prod.unit_price,0),
      'subtotal', COALESCE(v_prod.unit_price,0) * (v_line ->> 'required')::numeric
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
      'operation', v_op.operation_name,
      'hour_cost', v_op.hour_cost,
      'minutes_per_unit', v_op.minutes_per_unit,
      'subtotal', (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty
    );
  END LOOP;

  v_overhead := v_overhead_pct * (v_material + v_labor);
  v_total := v_material + v_labor + v_overhead;
  v_revenue := v_unit_price * v_qty;
  v_margin := v_revenue - v_total;
  v_margin_pct := CASE WHEN v_revenue > 0 THEN v_margin / v_revenue ELSE 0 END;

  v_out := jsonb_build_object(
    'material_cost', v_material,
    'labor_cost', v_labor,
    'overhead_cost', v_overhead,
    'total_cost', v_total,
    'revenue', v_revenue,
    'margin', v_margin,
    'margin_pct', v_margin_pct,
    'breakdown', jsonb_build_object(
      'materials', v_breakdown_materials,
      'labor', v_breakdown_labor,
      'overhead_pct', v_overhead_pct
    )
  );

  IF p_persist THEN
    INSERT INTO public.order_costs (
      sale_order_id, sale_order_item_id, reference_id, color, quantity,
      material_cost, labor_cost, overhead_cost, total_cost,
      revenue, margin, margin_pct, breakdown
    ) VALUES (
      p_sale_order_id, v_item.id, v_ref, COALESCE(v_color,''), v_qty,
      v_material, v_labor, v_overhead, v_total,
      v_revenue, v_margin, v_margin_pct, v_out -> 'breakdown'
    )
    ON CONFLICT (sale_order_id, sale_order_item_id) DO UPDATE SET
      material_cost = EXCLUDED.material_cost,
      labor_cost    = EXCLUDED.labor_cost,
      overhead_cost = EXCLUDED.overhead_cost,
      total_cost    = EXCLUDED.total_cost,
      revenue       = EXCLUDED.revenue,
      margin        = EXCLUDED.margin,
      margin_pct    = EXCLUDED.margin_pct,
      breakdown     = EXCLUDED.breakdown,
      calculated_at = now();
  END IF;

  RETURN v_out;
END;
$function$;

-- Restaurar versão original de fn_projected_demand
CREATE OR REPLACE FUNCTION public.fn_projected_demand(p_product_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_total numeric;
BEGIN
    SELECT COALESCE(SUM(required_quantity), 0)
    INTO v_total
    FROM public.v_mrp_needs
    WHERE product_id = p_product_id;
    
    RETURN v_total;
END;
$function$;
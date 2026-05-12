-- =============================================================================
-- 20260627123000 — FIX calculate_order_cost MULTI-ITEM (Bug B1 da auditoria)
-- =============================================================================
--
-- Bug crítico: calculate_order_cost(uuid, NULL, true) tinha SELECT ... LIMIT 1
-- na seleção de sale_order_items, então quando o auto-cost-recalc (Round 10)
-- chamava com p_sale_order_item_id=NULL pra "processar PV inteiro", a função
-- pegava 1 item arbitrário e ignorava os demais.
--
-- Impacto: TODO PV com 2+ itens tinha apenas 1/N da receita/custo gravados
-- em order_costs. Dashboard Financeiro (NetMarginChart) e Relatório Gerencial
-- (ManagementReport) mostravam ~20-50% da receita real.
--
-- Fix:
--   1. Quebra em duas funções:
--      - calculate_order_cost_item(p_sale_order_item_id, p_persist) → 1 item
--      - calculate_order_cost(p_sale_order_id, p_sale_order_item_id, p_persist)
--        → se item_id dado, delega; se NULL, loopa por TODOS os itens
--   2. Wrapper retorna jsonb com:
--      - items[]: array de outputs per-item
--      - aggregate: totais do PV (somas)
--   3. Backfill: marca todos PVs ativos como costs_dirty_at=now() — cron
--      vai repopular order_costs corretamente.

-- =============================================================================
-- Função per-item (lógica original, sem LIMIT 1 — usa ID exato)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.calculate_order_cost_item(
  p_sale_order_item_id uuid,
  p_persist boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item record;
  v_sale_order_id uuid;
  v_ref uuid; v_color text; v_qty numeric; v_unit_price numeric;
  v_grade jsonb; v_cons jsonb; v_line jsonb;
  v_material numeric := 0; v_labor numeric := 0;
  v_overhead_per_pair numeric; v_overhead numeric := 0;
  v_packaging_per_pair numeric := 0; v_packaging numeric := 0;
  v_total numeric := 0;
  v_breakdown_materials jsonb := '[]'::jsonb;
  v_breakdown_labor jsonb := '[]'::jsonb;
  v_revenue numeric; v_margin numeric; v_margin_pct numeric;
  v_op record; v_prod record; v_out jsonb;
  v_required_in_product_unit numeric; v_subtotal numeric;
BEGIN
  SELECT i.id, i.sale_order_id, i.reference_id, i.color, i.quantity, i.unit_price,
         CASE WHEN i.grade IS NOT NULL AND i.grade::text <> 'null' THEN i.grade ELSE NULL END AS grade,
         i.material_variant_id
    INTO v_item
    FROM public.sale_order_items i
   WHERE i.id = p_sale_order_item_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_sale_order_id := v_item.sale_order_id;
  v_ref := v_item.reference_id; v_color := v_item.color;
  v_qty := v_item.quantity; v_unit_price := COALESCE(v_item.unit_price, 0);
  v_grade := v_item.grade;

  SELECT COALESCE(custom_overhead, 0) INTO v_overhead_per_pair
    FROM public.technical_sheets WHERE id = v_ref;
  IF v_overhead_per_pair IS NULL OR v_overhead_per_pair = 0 THEN
    SELECT COALESCE(overhead_rate_per_pair, 0) INTO v_overhead_per_pair
      FROM public.cost_policies WHERE active = true LIMIT 1;
  END IF;
  v_overhead_per_pair := COALESCE(v_overhead_per_pair, 0);

  SELECT COALESCE(packaging_cost_per_pair, 0) INTO v_packaging_per_pair
    FROM public.cost_policies WHERE active = true LIMIT 1;
  v_packaging_per_pair := COALESCE(v_packaging_per_pair, 0);

  SELECT consumption_snapshot INTO v_cons FROM public.technical_sheet_snapshots
   WHERE sale_order_id = v_sale_order_id
     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)
   LIMIT 1;

  IF v_cons IS NULL THEN
    IF v_grade IS NOT NULL AND v_grade <> '{}'::jsonb THEN
      v_cons := public.calculate_order_consumption_by_grade(
        v_ref, v_grade, COALESCE(v_color, ''), v_item.material_variant_id);
    ELSE
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_cons
        FROM public.calculate_order_consumption(v_ref, v_qty, COALESCE(v_color,''), NULL::integer, v_item.material_variant_id) c;
    END IF;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_cons) AS value LOOP
    SELECT unit_price, name, unit INTO v_prod FROM public.products WHERE id = (v_line ->> 'product_id')::uuid;
    v_required_in_product_unit := public.convert_to_product_unit(
      (v_line ->> 'required')::numeric,
      v_line ->> 'unit',
      COALESCE(v_prod.unit, ''));
    -- Se convert retornar NULL (incompatibilidade detectada), pula a linha
    -- pra não inflar/zerar custo silenciosamente.
    IF v_required_in_product_unit IS NULL THEN
      v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
        'product_id', v_line ->> 'product_id',
        'product_name', v_prod.name,
        'component', v_line ->> 'component',
        'required', (v_line ->> 'required')::numeric,
        'consumption_unit', v_line ->> 'unit',
        'product_unit', v_prod.unit,
        'unit_price', COALESCE(v_prod.unit_price, 0),
        'subtotal', 0,
        'conversion_warning', 'unit_mismatch');
      CONTINUE;
    END IF;
    v_subtotal := COALESCE(v_prod.unit_price, 0) * v_required_in_product_unit;
    v_material := v_material + v_subtotal;
    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id', v_line ->> 'product_id',
      'product_name', v_prod.name,
      'component', v_line ->> 'component',
      'required', (v_line ->> 'required')::numeric,
      'required_in_product_unit', v_required_in_product_unit,
      'consumption_unit', v_line ->> 'unit',
      'product_unit', v_prod.unit,
      'unit_price', COALESCE(v_prod.unit_price, 0),
      'subtotal', v_subtotal);
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
      'subtotal', (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty);
  END LOOP;

  v_overhead := v_overhead_per_pair * v_qty;
  v_packaging := v_packaging_per_pair * v_qty;
  v_total := v_material + v_labor + v_overhead + v_packaging;
  v_revenue := v_unit_price * v_qty;
  v_margin := v_revenue - v_total;
  v_margin_pct := CASE WHEN v_revenue > 0 THEN v_margin / v_revenue ELSE 0 END;

  v_out := jsonb_build_object(
    'sale_order_item_id', v_item.id,
    'reference_id', v_ref,
    'color', v_color,
    'quantity', v_qty,
    'material_cost', v_material, 'labor_cost', v_labor,
    'overhead_cost', v_overhead, 'packaging_cost', v_packaging,
    'total_cost', v_total, 'revenue', v_revenue,
    'margin', v_margin, 'margin_pct', v_margin_pct,
    'breakdown', jsonb_build_object(
      'materials', v_breakdown_materials,
      'labor', v_breakdown_labor,
      'overhead_per_pair', v_overhead_per_pair,
      'packaging_per_pair', v_packaging_per_pair,
      'used_grade', v_grade IS NOT NULL AND v_grade <> '{}'::jsonb));

  IF p_persist THEN
    INSERT INTO public.order_costs (
      sale_order_id, sale_order_item_id, reference_id, color, quantity,
      material_cost, labor_cost, overhead_cost, packaging_cost, total_cost,
      revenue, margin, margin_pct, breakdown
    ) VALUES (
      v_sale_order_id, v_item.id, v_ref, COALESCE(v_color,''), v_qty,
      v_material, v_labor, v_overhead, v_packaging, v_total,
      v_revenue, v_margin, v_margin_pct, v_out -> 'breakdown')
    ON CONFLICT (sale_order_id, sale_order_item_id) DO UPDATE SET
      material_cost = EXCLUDED.material_cost,
      labor_cost = EXCLUDED.labor_cost,
      overhead_cost = EXCLUDED.overhead_cost,
      packaging_cost = EXCLUDED.packaging_cost,
      total_cost = EXCLUDED.total_cost,
      revenue = EXCLUDED.revenue,
      margin = EXCLUDED.margin,
      margin_pct = EXCLUDED.margin_pct,
      breakdown = EXCLUDED.breakdown,
      calculated_at = now();
  END IF;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_cost_item(uuid, boolean) TO authenticated;

-- =============================================================================
-- Wrapper: se item_id dado → 1 item; se NULL → loopa por TODOS, retorna agregado
-- =============================================================================
CREATE OR REPLACE FUNCTION public.calculate_order_cost(
  p_sale_order_id uuid,
  p_sale_order_item_id uuid DEFAULT NULL,
  p_persist boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item_id uuid;
  v_item_result jsonb;
  v_items_out jsonb := '[]'::jsonb;
  v_total_material numeric := 0;
  v_total_labor numeric := 0;
  v_total_overhead numeric := 0;
  v_total_packaging numeric := 0;
  v_total_cost numeric := 0;
  v_total_revenue numeric := 0;
  v_total_margin numeric := 0;
  v_total_qty numeric := 0;
BEGIN
  -- Se item_id dado: delega direto pra função per-item e retorna o resultado
  IF p_sale_order_item_id IS NOT NULL THEN
    RETURN public.calculate_order_cost_item(p_sale_order_item_id, p_persist);
  END IF;

  -- Senão: loopa TODOS os itens do PV
  FOR v_item_id IN
    SELECT id FROM public.sale_order_items
     WHERE sale_order_id = p_sale_order_id
     ORDER BY created_at NULLS LAST, id
  LOOP
    v_item_result := public.calculate_order_cost_item(v_item_id, p_persist);
    IF v_item_result IS NULL THEN CONTINUE; END IF;

    v_items_out := v_items_out || v_item_result;
    v_total_material  := v_total_material  + COALESCE((v_item_result ->> 'material_cost')::numeric, 0);
    v_total_labor     := v_total_labor     + COALESCE((v_item_result ->> 'labor_cost')::numeric, 0);
    v_total_overhead  := v_total_overhead  + COALESCE((v_item_result ->> 'overhead_cost')::numeric, 0);
    v_total_packaging := v_total_packaging + COALESCE((v_item_result ->> 'packaging_cost')::numeric, 0);
    v_total_cost      := v_total_cost      + COALESCE((v_item_result ->> 'total_cost')::numeric, 0);
    v_total_revenue   := v_total_revenue   + COALESCE((v_item_result ->> 'revenue')::numeric, 0);
    v_total_margin    := v_total_margin    + COALESCE((v_item_result ->> 'margin')::numeric, 0);
    v_total_qty       := v_total_qty       + COALESCE((v_item_result ->> 'quantity')::numeric, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'items', v_items_out,
    'item_count', jsonb_array_length(v_items_out),
    'total_quantity', v_total_qty,
    'material_cost', v_total_material,
    'labor_cost', v_total_labor,
    'overhead_cost', v_total_overhead,
    'packaging_cost', v_total_packaging,
    'total_cost', v_total_cost,
    'revenue', v_total_revenue,
    'margin', v_total_margin,
    'margin_pct', CASE WHEN v_total_revenue > 0 THEN v_total_margin / v_total_revenue ELSE 0 END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_cost(uuid, uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.calculate_order_cost(uuid, uuid, boolean) IS
  'Custo de PV. Se p_sale_order_item_id dado, retorna custo de 1 item. '
  'Se NULL, loopa todos os items e retorna agregado + array items[]. '
  'Bug B1 corrigido em 27/jun: antes pegava 1 item arbitrário com LIMIT 1.';

-- =============================================================================
-- Backfill: marca todos PVs ativos como dirty pro cron reprocessar com a
-- versão corrigida (multi-item).
-- =============================================================================
UPDATE public.sale_orders
   SET costs_dirty_at = now()
 WHERE status NOT IN ('Cancelado', 'cancelled', 'Cancelada');

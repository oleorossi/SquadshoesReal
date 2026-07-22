-- =============================================================================
-- F6-3 + F6-5 (auditoria de motores, Onda B / P7 — custeio)
-- =============================================================================
--
-- F6-3 — Fonte ÚNICA de overhead
--   A policy viva tem overhead_rate_per_pair = 0 e o overhead real vive em
--   overhead_monthly_total (24.000) / monthly_production_target (20.000) =
--   R$ 1,20/par — a cadeia que o simulador de preço (PricingCalculatorPanel /
--   PricingByTechnicalSheetPanel) usa. O motor SQL lia SÓ overhead_rate_per_pair
--   e persistia overhead_cost = 0 em TODOS os order_costs (CMV/DRE subestimados,
--   margem superestimada), enquanto o simulador embutia 1,20/par.
--   Fix: o fallback de policy passa a ser
--     COALESCE(NULLIF(overhead_rate_per_pair, 0),
--              overhead_monthly_total / NULLIF(monthly_production_target, 0),
--              0)
--   — mesma cadeia do simulador (rate direto; se 0/nulo, deriva do mensal/meta).
--   A precedência ficha (technical_sheets.custom_overhead) > policy é mantida.
--   `calculate_order_cost` (nível pedido) é agregador puro sobre
--   `calculate_order_cost_item` — corrigir o item cobre os dois.
--
-- F6-5 — Linhas de Tira convertem unidade antes de precificar
--   O ramo de tiras (order_strap_needs) multiplicava unit_price × required_m
--   DIRETO, assumindo products.unit = 'm'. Hoje 100% das tiras estão em 'm'
--   (impacto zero), mas uma tira nova em 'cm' custaria 100× menor em silêncio.
--   Fix: aplica convert_to_product_unit(required_m, 'm', products.unit) com o
--   MESMO tratamento de NULL/warning (`unit_mismatch`, subtotal 0) do loop
--   principal de materiais — hardening da mig 20260524150000 estendido ao ramo.
--
-- Sem reparo de dados: snapshots já persistidos em order_costs permanecem
-- congelados (design); custeios futuros/recalculados saem corretos.
-- Idempotente (CREATE OR REPLACE sobre a definição viva, diff mínimo).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calculate_order_cost_item(p_sale_order_item_id uuid, p_persist boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_warnings text[] := ARRAY[]::text[];
  v_has_active_policy boolean;
  v_sheet_overhead numeric;
  v_grade_sum numeric := 0;
  v_qty_multiplier numeric := 1;
  v_scaled_required numeric;
  v_scaled_subtotal numeric;
  v_conv4 record;
  v_dm2_norm numeric;
  v_snap_qty numeric;
  v_cons_source text := 'computed';
  v_strap record;
  v_strap_colors jsonb;
  v_pending_sectors text[] := ARRAY[]::text[];
  v_labor_status text := 'ok';
  v_ops_count integer := 0;
  v_ps text;
BEGIN
  SELECT i.id, i.sale_order_id, i.reference_id, i.color, i.quantity, i.unit_price,
         CASE WHEN i.grade IS NOT NULL AND i.grade::text <> 'null' THEN i.grade ELSE NULL END AS grade,
         i.material_variant_id, i.strap_colors
    INTO v_item
    FROM public.sale_order_items i
   WHERE i.id = p_sale_order_item_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_sale_order_id := v_item.sale_order_id;
  v_ref := v_item.reference_id; v_color := v_item.color;
  v_qty := v_item.quantity; v_unit_price := COALESCE(v_item.unit_price, 0);
  v_grade := v_item.grade;
  v_strap_colors := v_item.strap_colors;

  IF v_grade IS NOT NULL AND v_grade::text <> '{}' THEN
    SELECT COALESCE(SUM((value)::numeric), 0) INTO v_grade_sum
      FROM jsonb_each_text(v_grade) WHERE key !~ '^_';
    IF v_grade_sum > 0 AND v_qty > 0 THEN
      v_qty_multiplier := v_qty / v_grade_sum;
    END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.cost_policies WHERE active = true)
    INTO v_has_active_policy;

  SELECT COALESCE(custom_overhead, 0) INTO v_sheet_overhead
    FROM public.technical_sheets WHERE id = v_ref;
  v_overhead_per_pair := v_sheet_overhead;
  IF v_overhead_per_pair IS NULL OR v_overhead_per_pair = 0 THEN
    -- F6-3: fonte ÚNICA de overhead — mesma cadeia do simulador de preço:
    -- rate_per_pair direto e, quando 0/nulo, overhead_monthly_total ÷ meta mensal.
    SELECT COALESCE(
             NULLIF(overhead_rate_per_pair, 0),
             overhead_monthly_total / NULLIF(monthly_production_target, 0),
             0)
      INTO v_overhead_per_pair
      FROM public.cost_policies WHERE active = true LIMIT 1;
  END IF;
  v_overhead_per_pair := COALESCE(v_overhead_per_pair, 0);

  SELECT COALESCE(packaging_cost_per_pair, 0) INTO v_packaging_per_pair
    FROM public.cost_policies WHERE active = true LIMIT 1;
  v_packaging_per_pair := COALESCE(v_packaging_per_pair, 0);

  IF NOT v_has_active_policy AND COALESCE(v_sheet_overhead, 0) = 0 THEN
    v_warnings := array_append(v_warnings, 'no_active_cost_policy');
  END IF;

  SELECT consumption_snapshot, quantity INTO v_cons, v_snap_qty
    FROM public.technical_sheet_snapshots
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
  ELSE
    v_cons_source := 'snapshot';
    v_qty_multiplier := CASE WHEN COALESCE(v_snap_qty, 0) > 0
                             THEN v_qty / v_snap_qty
                             ELSE 1 END;
  END IF;

  v_cons := public.filter_caixa_by_packaging_mode(
    v_cons, (SELECT packaging_mode FROM public.sale_orders WHERE id = v_sale_order_id));

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_cons) AS value LOOP
    SELECT unit_price, name, unit INTO v_prod FROM public.products WHERE id = (v_line ->> 'product_id')::uuid;
    v_required_in_product_unit := public.convert_to_product_unit(
      (v_line ->> 'required')::numeric,
      v_line ->> 'unit',
      COALESCE(v_prod.unit, ''));
    IF v_required_in_product_unit IS NULL THEN
      v_dm2_norm := public.convert_to_product_unit((v_line ->> 'required')::numeric, v_line ->> 'unit', 'dm²');
      IF v_dm2_norm IS NOT NULL THEN
        SELECT * INTO v_conv4 FROM public.get_material_conversion_info((v_line ->> 'product_id')::uuid);
        IF v_conv4.dm2_per_unit IS NOT NULL AND v_conv4.dm2_per_unit > 0 THEN
          v_required_in_product_unit := v_dm2_norm / v_conv4.dm2_per_unit;
        END IF;
      END IF;
    END IF;
    IF v_required_in_product_unit IS NULL THEN
      v_warnings := array_append(v_warnings, 'unit_mismatch:' || COALESCE(v_prod.name, '?'));
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
    v_scaled_required := v_required_in_product_unit * v_qty_multiplier;
    v_scaled_subtotal := COALESCE(v_prod.unit_price, 0) * v_scaled_required;
    v_material := v_material + v_scaled_subtotal;
    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id', v_line ->> 'product_id',
      'product_name', v_prod.name,
      'component', v_line ->> 'component',
      'required', v_scaled_required,
      'required_per_grade', v_required_in_product_unit,
      'qty_multiplier', v_qty_multiplier,
      'consumption_unit', v_line ->> 'unit',
      'product_unit', v_prod.unit,
      'unit_price', COALESCE(v_prod.unit_price, 0),
      'subtotal', v_scaled_subtotal);
  END LOOP;

  FOR v_strap IN
    SELECT sn.product_id, sn.required_m
      FROM public.order_strap_needs(v_strap_colors, v_qty, v_grade) sn
     WHERE sn.product_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_cons) c
          WHERE (c ->> 'product_id') IS NOT NULL
            AND (c ->> 'product_id')::uuid = sn.product_id)
  LOOP
    SELECT unit_price, name, unit INTO v_prod FROM public.products WHERE id = v_strap.product_id;
    -- F6-5: order_strap_needs devolve METROS; converter pra unidade do produto
    -- antes de multiplicar pelo unit_price (R$ por unidade de ESTOQUE), com o
    -- mesmo tratamento de NULL/warning do loop principal. Tira em 'm' (100% do
    -- cadastro vivo) passa reto (conversão identidade).
    v_required_in_product_unit := public.convert_to_product_unit(
      v_strap.required_m, 'm', COALESCE(v_prod.unit, ''));
    IF v_required_in_product_unit IS NULL THEN
      v_warnings := array_append(v_warnings, 'unit_mismatch:' || COALESCE(v_prod.name, '?'));
      v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
        'product_id', v_strap.product_id,
        'product_name', v_prod.name,
        'component', 'Tira',
        'required', v_strap.required_m,
        'consumption_unit', 'm',
        'product_unit', v_prod.unit,
        'unit_price', COALESCE(v_prod.unit_price, 0),
        'subtotal', 0,
        'conversion_warning', 'unit_mismatch');
      CONTINUE;
    END IF;
    v_subtotal := COALESCE(v_prod.unit_price, 0) * v_required_in_product_unit;
    v_material := v_material + v_subtotal;
    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id', v_strap.product_id,
      'product_name', v_prod.name,
      'component', 'Tira',
      'required', v_required_in_product_unit,
      'consumption_unit', 'm',
      'product_unit', v_prod.unit,
      'unit_price', COALESCE(v_prod.unit_price, 0),
      'subtotal', v_subtotal);
  END LOOP;

  FOR v_strap IN
    SELECT DISTINCT sn.color AS color
      FROM public.order_strap_needs(v_strap_colors, v_qty, v_grade) sn
     WHERE sn.product_id IS NULL AND sn.required_m > 0
  LOOP
    v_warnings := array_append(v_warnings, 'strap_color_not_registered:' || COALESCE(v_strap.color, '?'));
  END LOOP;

  FOR v_op IN
    SELECT operation_name, cost_per_hour, standard_time_minutes
      FROM public.bom_operations
     WHERE sheet_id = v_ref AND active IS NOT FALSE
       AND standard_time_minutes IS NOT NULL AND cost_per_hour IS NOT NULL
  LOOP
    v_labor := v_labor + (v_op.standard_time_minutes / 60.0) * v_op.cost_per_hour * v_qty;
    v_breakdown_labor := v_breakdown_labor || jsonb_build_object(
      'operation', v_op.operation_name,
      'hour_cost', v_op.cost_per_hour,
      'minutes_per_unit', v_op.standard_time_minutes,
      'subtotal', (v_op.standard_time_minutes / 60.0) * v_op.cost_per_hour * v_qty);
  END LOOP;

  SELECT count(*) INTO v_ops_count FROM public.bom_operations WHERE sheet_id = v_ref;

  SELECT COALESCE(array_agg(DISTINCT stage), ARRAY[]::text[]) INTO v_pending_sectors
    FROM public.bom_operations
   WHERE sheet_id = v_ref
     AND (time_source = 'pendente'
          OR (active IS NOT FALSE
              AND (COALESCE(standard_time_minutes, 0) = 0 OR COALESCE(cost_per_hour, 0) = 0)));

  IF v_ops_count = 0 THEN
    v_labor_status := 'sem_operacoes';
    v_warnings := array_append(v_warnings, 'sem_operacoes_mo');
  ELSIF v_labor = 0 THEN
    v_labor_status := 'sem_tempo';
  ELSIF COALESCE(array_length(v_pending_sectors, 1), 0) > 0 THEN
    v_labor_status := 'tempo_pendente';
  END IF;

  FOREACH v_ps IN ARRAY v_pending_sectors LOOP
    v_warnings := array_append(v_warnings, 'tempo_pendente:' || v_ps);
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
    'grade_sum', v_grade_sum,
    'qty_multiplier', v_qty_multiplier,
    'material_cost', v_material, 'labor_cost', v_labor,
    'overhead_cost', v_overhead, 'packaging_cost', v_packaging,
    'total_cost', v_total, 'revenue', v_revenue,
    'margin', v_margin, 'margin_pct', v_margin_pct,
    'warnings', to_jsonb(v_warnings),
    'breakdown', jsonb_build_object(
      'materials', v_breakdown_materials,
      'labor', v_breakdown_labor,
      'labor_status', v_labor_status,
      'labor_pending_sectors', to_jsonb(v_pending_sectors),
      'overhead_per_pair', v_overhead_per_pair,
      'packaging_per_pair', v_packaging_per_pair,
      'qty_multiplier', v_qty_multiplier,
      'consumption_source', v_cons_source,
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
$function$;

COMMENT ON FUNCTION public.calculate_order_cost_item(uuid, boolean) IS
  'Custeio por item do PV. Overhead: ficha (custom_overhead) > policy (rate_per_pair; se 0/nulo, overhead_monthly_total/monthly_production_target) — F6-3. Tiras convertem m→unidade do produto antes do preço (F6-5).';

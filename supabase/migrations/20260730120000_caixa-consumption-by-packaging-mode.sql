-- Embalagem no CUSTEIO/MRP: contar só a caixa do packaging_mode do pedido.
--
-- Bug: uma ficha lista VÁRIAS caixas no BOM (sheet_materials) como alternativas
-- — "CAIXA COLMEIA 11" (0,083/par) e "CAIXA INDIVIDUAL 11" (1/par), ambas no
-- grupo "EMBALAGEM". As funções de consumo (calculate_order_consumption*) emitem
-- as duas, então o custeio (calculate_order_cost_item → order_costs) e a projeção
-- de demanda (fn_projected_demand) somavam colmeia + individual, inflando custo de
-- material / subestimando margem e super-dimensionando a compra de caixas.
--
-- O frontend (orderConsumption.ts / SummaryConsumptionPanel / MaterialConsumptionDialog)
-- já foi corrigido pra mostrar só a caixa do modo. Aqui espelhamos no servidor.
--
-- Estratégia (baixo risco): um helper PURO filtra um jsonb de consumo pela caixa
-- do modo, sem tocar nas funções grandes de consumo. Só filtra quando há
-- ALTERNATIVAS reais (≥2 tipos de caixa na ficha) E a caixa do modo existe — caso
-- contrário é no-op (degrada com elegância). Aplicado em:
--   • calculate_order_cost_item  (custeio → order_costs)
--   • fn_projected_demand        (MRP / projeção de demanda de compra)
--
-- ⚠ NÃO toca hybrid_debit_stock_for_order (débito físico de estoque) nem
-- freeze_technical_sheet (snapshot) — débito é sensível em produção e o custeio já
-- filtra na LEITURA mesmo lendo snapshot. Esses ficam como follow-up.

-- ── Helpers ────────────────────────────────────────────────────────────────

-- Tipo de caixa coletiva pelo NOME do produto (espelha caixaCollectiveTypeFromName).
CREATE OR REPLACE FUNCTION public.caixa_collective_type(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_name IS NULL THEN NULL
    WHEN lower(p_name) LIKE '%colmeia%' OR lower(p_name) LIKE '%colméia%' THEN 'colmeia'
    WHEN lower(p_name) LIKE '%master%'  THEN 'master'
    WHEN lower(p_name) LIKE '%fitilho%' THEN 'fitilho'
    WHEN lower(p_name) LIKE '%individual%' THEN 'individual'
    ELSE NULL
  END;
$$;

-- Modo de embalagem (sale_orders.packaging_mode) → tipo de caixa coletiva
-- (espelha collectiveTypeForMode: amarrado/individual → individual).
CREATE OR REPLACE FUNCTION public.packaging_mode_collective_type(p_mode text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_mode = 'colmeia' THEN 'colmeia'
    WHEN p_mode = 'individual_master' THEN 'master'
    WHEN p_mode = 'individual_fitilho' THEN 'fitilho'
    ELSE 'individual'
  END;
$$;

-- Filtra um jsonb de consumo (lista de linhas com product_id) mantendo só a caixa
-- do modo do pedido. No-op quando: sem modo, sem alternativas (≤1 tipo), ou o modo
-- não tem caixa cadastrada na ficha. Espelha shouldShowCaixaForMode do frontend.
CREATE OR REPLACE FUNCTION public.filter_caixa_by_packaging_mode(p_cons jsonb, p_packaging_mode text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_target text;
  v_types  text[];
  v_result jsonb;
BEGIN
  IF p_packaging_mode IS NULL OR p_cons IS NULL OR jsonb_typeof(p_cons) <> 'array' THEN
    RETURN p_cons;
  END IF;

  v_target := public.packaging_mode_collective_type(p_packaging_mode);

  -- tipos de caixa presentes no consumo (por nome do produto)
  SELECT array_agg(DISTINCT t) INTO v_types
  FROM (
    SELECT public.caixa_collective_type(pr.name) AS t
    FROM jsonb_array_elements(p_cons) AS line
    JOIN public.products pr ON pr.id = (line->>'product_id')::uuid
  ) s
  WHERE t IS NOT NULL;

  -- só filtra quando há ALTERNATIVAS (≥2 tipos) E a caixa do modo existe
  IF v_types IS NULL OR array_length(v_types, 1) < 2 OR NOT (v_target = ANY(v_types)) THEN
    RETURN p_cons;
  END IF;

  -- mantém tudo, EXCETO caixas de tipo reconhecível ≠ alvo
  SELECT COALESCE(jsonb_agg(line), '[]'::jsonb) INTO v_result
  FROM jsonb_array_elements(p_cons) AS line
  LEFT JOIN public.products pr ON pr.id = (line->>'product_id')::uuid
  WHERE public.caixa_collective_type(pr.name) IS NULL
     OR public.caixa_collective_type(pr.name) = v_target;

  RETURN v_result;
END;
$$;

-- ── fn_projected_demand: filtra a caixa por modo (MRP) ───────────────────────
CREATE OR REPLACE FUNCTION public.fn_projected_demand()
 RETURNS TABLE(product_id uuid, product_name text, total_required numeric, earliest_deadline date, orders_count integer, order_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH items_with_cons AS (
    SELECT so.id AS sale_order_id, so.delivery_deadline, soi.id AS sale_order_item_id,
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption(
          soi.reference_id, soi.quantity, COALESCE(soi.color, ''),
          (SELECT key::integer FROM jsonb_each_text(soi.grade) WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
        ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE so.status NOT IN ('Cancelado','Entregue','Finalizado','Finalizado s/ NF','Faturado','Expedido','Concluído')
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT sale_order_id, delivery_deadline,
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name') AS product_name,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit') AS unit
    FROM items_with_cons, jsonb_array_elements(cons) AS line
  )
  SELECT
    e.product_id,
    MAX(e.product_name) AS product_name,
    COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL), 0)
      / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(e.product_id) conv LIMIT 1), 1), 1)
    + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL), 0) AS total_required,
    MIN(e.delivery_deadline) AS earliest_deadline,
    COUNT(DISTINCT e.sale_order_id)::integer AS orders_count,
    array_agg(DISTINCT e.sale_order_id) AS order_ids
  FROM exploded e
  WHERE e.product_id IS NOT NULL
  GROUP BY e.product_id;
END;
$function$;

-- ── calculate_order_cost_item: filtra a caixa por modo (CUSTEIO) ─────────────
-- Idêntica à função viva, com UMA linha adicionada: filtra v_cons pela caixa do
-- packaging_mode do pedido logo após obtê-lo (vale pra consumo computado E snapshot).
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
    SELECT COALESCE(overhead_rate_per_pair, 0) INTO v_overhead_per_pair
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
    -- FIX C2: snapshot é congelado com a grade ESCALADA — o 'required' já
    -- cobre v_snap_qty pares. Multiplicar por qty/grade_sum (grade base)
    -- inflava o custo por `fichas` de novo.
    v_cons_source := 'snapshot';
    v_qty_multiplier := CASE WHEN COALESCE(v_snap_qty, 0) > 0
                             THEN v_qty / v_snap_qty
                             ELSE 1 END;
  END IF;

  -- Embalagem: a ficha pode listar várias caixas (colmeia+individual) no BOM;
  -- conta SÓ a do packaging_mode do pedido (espelha orderConsumption.ts no front).
  -- Vale pra consumo computado E snapshot (corrige custo mesmo de snapshot antigo).
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

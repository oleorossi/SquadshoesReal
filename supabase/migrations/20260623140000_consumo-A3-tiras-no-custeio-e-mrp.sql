-- Auditoria de consumo — A3: TIRAS no custeio + MRP.
-- Aplicado via MCP em 2026-06-23 (ssvxfoybzmjlypnipqzn).
--
-- PROBLEMA: as tiras artesanais moram em `sale_order_items.strap_colors` (não em
-- sheet_materials). Os motores de CUSTEIO (calculate_order_cost_item) e MRP
-- (get_wave_material_needs / compute_materials_per_pv) só liam o consumo genérico
-- (calculate_order_consumption*), que NÃO conhece tiras → o custo do material das
-- tiras vinha ZERADO (margem inflada) e o MRP não comprava tira (ruptura silenciosa).
-- O modal de consumo já mostrava as tiras (motor TS), então custeio/MRP divergiam.
--
-- ARQUITETURA (por que NÃO acoplei no calculate_order_consumption*):
-- `hybrid_debit_stock_for_order` ITERA as linhas de calculate_order_consumption* e
-- debita/reserva cada uma. As tiras JÁ são debitadas à parte por `debit_strap_stock`.
-- Logo, adicionar "Tira" às linhas de consumo causaria DÉBITO EM DOBRO. Por isso o
-- consumo genérico fica intocado e as tiras entram SÓ no custeio + MRP, via um helper
-- read-only.
--
-- HELPER `order_strap_needs(strap_colors, qty, grade)`: gêmeo read-only de
-- `debit_strap_stock` — MESMA matemática (por par, fichas=ceil(qty/grade_total),
-- cm→m ÷100) e MESMA resolução de produto (grupo + cor com unaccent, fallback cor
-- vazia). Retorna product_id NULL quando a cor não está cadastrada no grupo (mesmo
-- ponto cego do débito, que daria RAISE). Verificado contra o modal no PV-00144
-- (OFF WHITE qty 780, grade soma 12 → 65 fichas → 1591,2 m; idêntico ao modal).
--
-- CUSTEIO: soma o custo das tiras direto em material_cost (required_m × unit_price),
-- com guard anti-dupla-contagem (pula tira que também esteja no BOM) e aviso
-- `strap_color_not_registered:<cor>` quando a cor não casa produto (custo subestimado).
-- MRP: CTE `strap_exploded` (unit='m', entra no ramo não-dm² da agregação) unida ao
-- consumo genérico; estoque/shortage saem do net (quantity − reserved_stock).
-- M1 (caixa única por packaging_mode) já estava aplicado nas 3 funções — mantido.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper read-only (espelha debit_strap_stock sem escrever)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.order_strap_needs(
  p_strap_colors jsonb,
  p_order_quantity numeric,
  p_order_grade jsonb DEFAULT NULL
)
RETURNS TABLE(product_id uuid, product_name text, color text, group_id uuid, required_m numeric, resolved boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_color_norm text;
  v_pid uuid;
  v_pname text;
  v_per_size jsonb;
  v_consumption numeric;
  v_size text;
  v_pairs numeric;
  v_cm_per_pair numeric;
  v_total_cm numeric;
  v_grade_total numeric;
  v_fichas numeric;
  v_required numeric;
BEGIN
  IF p_strap_colors IS NULL OR jsonb_typeof(p_strap_colors) <> 'array'
     OR jsonb_array_length(p_strap_colors) = 0 THEN
    RETURN;
  END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(p_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';
    BEGIN v_group_id := (v_strap ->> 'group_id')::uuid; EXCEPTION WHEN OTHERS THEN v_group_id := NULL; END;
    IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN CONTINUE; END IF;
    v_color_norm := lower(trim(unaccent(v_color)));

    v_per_size := v_strap -> 'consumption_per_size';
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 1);
    IF v_consumption <= 0 THEN v_consumption := 1; END IF;

    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0; v_grade_total := 0;
      FOR v_size, v_pairs IN SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;
      IF v_grade_total > 0 THEN
        v_fichas := GREATEST(1, ceil(p_order_quantity / v_grade_total));
      ELSE
        v_fichas := 1;
      END IF;
      v_required := (v_total_cm * v_fichas) / 100;
    ELSE
      v_required := (v_consumption * p_order_quantity) / 100;
    END IF;

    IF v_required <= 0 THEN CONTINUE; END IF;

    -- resolução de produto: grupo + cor (unaccent), fallback grupo + cor vazia
    SELECT p.id, p.name INTO v_pid, v_pname
      FROM public.products p
     WHERE p.active = true AND p.group_id = v_group_id
       AND lower(trim(unaccent(p.color))) = v_color_norm
     LIMIT 1;
    IF v_pid IS NULL THEN
      SELECT p.id, p.name INTO v_pid, v_pname
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_group_id
         AND (p.color IS NULL OR trim(p.color) = '')
       LIMIT 1;
    END IF;

    product_id := v_pid;
    product_name := v_pname;
    color := v_color;
    group_id := v_group_id;
    required_m := v_required;
    resolved := (v_pid IS NOT NULL);
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Custeio: soma tiras em material_cost (+ aviso de cor não cadastrada)
-- ─────────────────────────────────────────────────────────────────────────────
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
    v_cons_source := 'snapshot';
    v_qty_multiplier := CASE WHEN COALESCE(v_snap_qty, 0) > 0
                             THEN v_qty / v_snap_qty
                             ELSE 1 END;
  END IF;

  -- Embalagem: conta SÓ a caixa do packaging_mode do pedido (espelha o front).
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

  -- Tiras: consumo em metros via strap_colors do item. NÃO passam pelo snapshot/
  -- consumo genérico (debitadas à parte por debit_strap_stock) — então invisíveis ao
  -- custeio até esta soma. required_m já é o TOTAL p/ a qty (fichas=ceil(qty/grade)).
  -- Guard: pula se a tira também já apareceu no BOM (evita contagem dupla).
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
    v_subtotal := COALESCE(v_prod.unit_price, 0) * v_strap.required_m;
    v_material := v_material + v_subtotal;
    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id', v_strap.product_id,
      'product_name', v_prod.name,
      'component', 'Tira',
      'required', v_strap.required_m,
      'consumption_unit', 'm',
      'product_unit', v_prod.unit,
      'unit_price', COALESCE(v_prod.unit_price, 0),
      'subtotal', v_subtotal);
  END LOOP;

  -- Tira com cor não cadastrada no grupo → não dá pra precificar (custo subestimado). Avisa.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. MRP por onda: tiras via strap_exploded (unit='m')
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
 RETURNS TABLE(product_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, supplier_lead_time_days integer, is_artisanal boolean, artisanal_recipe_id uuid, artisanal_recipe_name text, base_product_id uuid, base_product_name text, base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric, os_send_date date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_palmilha_start_date INTO v_corte_start
    FROM public.compute_wave_timeline(p_sale_order_ids) t LIMIT 1;

  RETURN QUERY
  WITH
  items_with_cons AS (
    SELECT COALESCE(public.filter_caixa_by_packaging_mode(
      public.calculate_order_consumption(
        soi.reference_id, soi.quantity, COALESCE(soi.color, ''),
        (SELECT key::integer FROM jsonb_each_text(soi.grade)
          WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
      ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT (line ->> 'product_id')::uuid AS product_id,
           COALESCE(line ->> 'color', '') AS effective_color,
           (line ->> 'required')::numeric AS required,
           (line ->> 'unit') AS unit
    FROM items_with_cons, jsonb_array_elements(cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  strap_exploded AS (
    -- Tiras: invisíveis ao calculate_order_consumption (moram em strap_colors).
    -- unit='m' garante que entram no ramo NÃO-dm² do needed (sem dividir por dm2_per_unit).
    SELECT sn.product_id,
           COALESCE(sn.color, '') AS effective_color,
           sn.required_m AS required,
           'm'::text AS unit
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    CROSS JOIN LATERAL public.order_strap_needs(soi.strap_colors, soi.quantity::numeric, soi.grade) sn
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND sn.product_id IS NOT NULL
  ),
  all_exploded AS (
    SELECT * FROM exploded
    UNION ALL
    SELECT * FROM strap_exploded
  ),
  needed AS (
    SELECT product_id, effective_color,
      COALESCE(SUM(required) FILTER (WHERE unit IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(product_id) conv LIMIT 1), 1), 1)
      + COALESCE(SUM(required) FILTER (WHERE unit IS NOT NULL), 0) AS needed_qty
    FROM all_exploded
    GROUP BY product_id, effective_color
  ),
  enriched AS (
    SELECT n.product_id, p.name AS product_name, p.group_id AS group_id, COALESCE(p.unit,'un') AS unit,
           n.effective_color AS color, n.needed_qty,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS stock_qty,
           GREATEST(0, n.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))) AS shortage,
           p.supplier_id, sup.name AS supplier_name,
           COALESCE(p.supplier_lead_time_days, 10)::int AS supplier_lead_time_days,
           COALESCE(p.is_artisanal, false) AS is_artisanal
      FROM needed n
      JOIN public.products p ON p.id = n.product_id
      LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
     WHERE n.needed_qty > 0
  )
  SELECT e.product_id, e.product_name, e.unit, e.color, e.needed_qty, e.stock_qty,
         e.shortage, e.supplier_id, e.supplier_name, e.supplier_lead_time_days,
         e.is_artisanal,
         ar.id AS artisanal_recipe_id, ar.name AS artisanal_recipe_name,
         bp.id AS base_product_id, ar.base_product_name,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0
              THEN ROUND(e.needed_qty / ar.yield_per_meter, 3) ELSE NULL END AS base_needed_qty,
         bp.quantity AS base_stock_qty,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL
              THEN GREATEST(0, ROUND(e.needed_qty / NULLIF(ar.yield_per_meter, 0), 3) - bp.quantity)
              ELSE NULL END AS base_shortage,
         CASE WHEN e.is_artisanal AND v_corte_start IS NOT NULL
              THEN (v_corte_start - 7)::date ELSE NULL END AS os_send_date
    FROM enriched e
    LEFT JOIN public.product_groups epg ON epg.id = e.group_id
    LEFT JOIN public.artisanal_recipes ar
           ON e.is_artisanal = true AND ar.active = true
          AND epg.id IS NOT NULL
          AND lower(trim(unaccent(ar.artisanal_product_name))) = lower(trim(unaccent(epg.name)))
    LEFT JOIN public.product_groups bpg
           ON ar.id IS NOT NULL
          AND lower(trim(unaccent(bpg.name))) = lower(trim(unaccent(ar.base_product_name)))
    LEFT JOIN LATERAL (
      SELECT bp2.id, bp2.quantity
        FROM public.products bp2
       WHERE ar.id IS NOT NULL AND bp2.active = true
         AND (bp2.group_id = bpg.id
              OR lower(trim(unaccent(bp2.name))) = lower(trim(unaccent(ar.base_product_name))))
         AND (e.color = ''
              OR lower(unaccent(COALESCE(bp2.color,''))) = lower(unaccent(e.color)))
       ORDER BY (bp2.group_id = bpg.id) DESC NULLS LAST, bp2.quantity DESC NULLS LAST
       LIMIT 1
    ) bp ON true
   ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. MRP por PV (Compras por Pedido): mesma adição de strap_exploded
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
 RETURNS TABLE(material_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, last_unit_price numeric, is_artisanal boolean)
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH items_with_cons AS (
    SELECT
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption(
          soi.reference_id, soi.quantity, COALESCE(soi.color, ''),
          (SELECT key::integer FROM jsonb_each_text(soi.grade)
            WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
        ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name')     AS product_name,
      COALESCE(line ->> 'color', '') AS color,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit')             AS unit
    FROM items_with_cons, jsonb_array_elements(cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  strap_exploded AS (
    -- Tiras: invisíveis ao calculate_order_consumption (moram em strap_colors).
    SELECT sn.product_id,
           sn.product_name,
           COALESCE(sn.color, '') AS color,
           sn.required_m AS required,
           'm'::text AS unit
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    CROSS JOIN LATERAL public.order_strap_needs(soi.strap_colors, soi.quantity::numeric, soi.grade) sn
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND sn.product_id IS NOT NULL
  ),
  all_exploded AS (
    SELECT * FROM exploded
    UNION ALL
    SELECT * FROM strap_exploded
  ),
  agg AS (
    SELECT
      e.product_id,
      e.color,
      MAX(e.product_name) AS product_name,
      COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit
                               FROM public.get_material_conversion_info(e.product_id) conv
                              LIMIT 1), 1), 1)
      + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL), 0) AS needed_qty
    FROM all_exploded e
    GROUP BY e.product_id, e.color
  )
  SELECT
    a.product_id                  AS material_id,
    COALESCE(p.name, a.product_name) AS product_name,
    COALESCE(p.unit, 'un')        AS unit,
    a.color,
    a.needed_qty,
    GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS stock_qty,
    GREATEST(0, a.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))) AS shortage,
    p.supplier_id,
    sup.name                      AS supplier_name,
    COALESCE(p.unit_price, 0)     AS last_unit_price,
    COALESCE(p.is_artisanal, false) AS is_artisanal
  FROM agg a
  LEFT JOIN public.products p   ON p.id = a.product_id
  LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  WHERE a.needed_qty > 0
  ORDER BY sup.name NULLS LAST, COALESCE(p.name, a.product_name);
$function$;

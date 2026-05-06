-- ---------------------------------------------------------------
-- Fix calculate_order_consumption_by_grade:
--   • Use technical sheet per-size values as first priority
--     (upper/lining/insole_consumption_per_size JSONB fields)
--     falling back to sole_technical_specs then scalar average.
--   • Apply technical_sheet_palmilha_colors mapping when
--     insole_has_lining = false (palmilha comes ready-colored).
--   • Skip forração debit when insole_has_lining = false.
--
-- Fix calculate_order_consumption (single-size):
--   • Same insole_has_lining / palmilha color mapping fixes.
-- ---------------------------------------------------------------

-- ================================================================
-- 1. calculate_order_consumption_by_grade  (graded orders)
-- ================================================================
DROP FUNCTION IF EXISTS public.calculate_order_consumption_by_grade(
  p_reference_id uuid,
  p_grade        jsonb,
  p_color        text
) CASCADE;
CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(
  p_reference_id uuid,
  p_grade        jsonb,
  p_color        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sheet              RECORD;
  v_sole_product_id    uuid;
  v_sole_color         text;
  v_total_qty          numeric := 0;
  v_size               integer;
  v_pairs              numeric;
  v_spec               RECORD;
  v_upper              numeric;
  v_lining             numeric;
  v_insole             numeric;
  v_resolved           RECORD;
  v_row                RECORD;
  v_item               jsonb;
  v_consumption        numeric;
  v_required           numeric;
  v_group_name         text;
  v_covered_categories text[]   := ARRAY[]::text[];
  v_covered_product_ids uuid[]  := ARRAY[]::uuid[];
  v_row_cat_norm       text;
  v_acc_upper          jsonb    := '{}'::jsonb;
  v_acc_lining         jsonb    := '{}'::jsonb;
  v_acc_insole         jsonb    := '{}'::jsonb;
  v_acc_std            jsonb    := '{}'::jsonb;
  v_result             jsonb    := '[]'::jsonb;
  v_upper_pid          uuid;
  v_lining_pid         uuid;
  v_insole_pid         uuid;
  v_std_item           RECORD;
  v_key                text;
  v_acc_required       numeric;
  v_acc_avail          numeric;
  v_acc_name           text;
  v_palmilha_color     text;   -- resolved insole color (may differ from p_color)
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' THEN
    RAISE EXCEPTION 'Grade inválida (precisa ser JSON object {size: pairs})';
  END IF;

  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  SELECT COALESCE(SUM((value)::numeric), 0) INTO v_total_qty
  FROM jsonb_each_text(p_grade)
  WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0;

  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Grade vazia (sem pares)';
  END IF;

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  -- ── Resolve products once ──────────────────────────────────────
  -- Cabedal
  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    v_upper_pid := v_resolved.product_id;
  END IF;

  -- Forração: skip entirely when insole_has_lining = false
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND COALESCE(v_sheet.insole_has_lining, true) = true THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    v_lining_pid := v_resolved.product_id;
  END IF;

  -- Palmilha: when insole_has_lining = false, resolve color via mapping table
  v_palmilha_color := p_color;
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '' THEN
    IF COALESCE(v_sheet.insole_has_lining, true) = false THEN
      SELECT palmilha_color INTO v_palmilha_color
      FROM technical_sheet_palmilha_colors
      WHERE sheet_id = p_reference_id
        AND (cabedal_color = p_color OR cabedal_color = '__DEFAULT__')
      ORDER BY (cabedal_color = p_color) DESC
      LIMIT 1;
      v_palmilha_color := COALESCE(v_palmilha_color, p_color);
    END IF;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, v_palmilha_color, 0, false);
    v_insole_pid := v_resolved.product_id;
  END IF;

  -- ── Per-size accumulation loop ─────────────────────────────────
  FOR v_size, v_pairs IN
    SELECT key::integer, value::numeric
      FROM jsonb_each_text(p_grade)
     WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0
  LOOP
    -- Priority 1: technical sheet per-size JSONB
    v_upper  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_size::text))::numeric, 0), 0);
    v_lining := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_insole := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_size::text))::numeric, 0), 0);

    -- Priority 2: sole_technical_specs (only if sole_drives_consumption and value still missing)
    IF (v_upper IS NULL OR v_lining IS NULL OR v_insole IS NULL)
       AND COALESCE(v_sheet.sole_drives_consumption, false)
       AND v_sole_product_id IS NOT NULL THEN
      SELECT * INTO v_spec FROM sole_technical_specs
       WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF v_upper  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN v_upper  := v_spec.upper_consumption_dm2;  END IF;
        IF v_lining IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining := v_spec.lining_consumption_dm2; END IF;
        IF v_insole IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole := v_spec.insole_consumption_dm2; END IF;
      END IF;
    END IF;

    -- Priority 3: sheet scalar average (final fallback)
    v_upper  := COALESCE(v_upper,  v_sheet.upper_consumption,  0);
    v_lining := COALESCE(v_lining, v_sheet.lining_consumption, 0);
    v_insole := COALESCE(v_insole, v_sheet.insole_consumption, 0);

    IF v_upper_pid  IS NOT NULL AND v_upper  > 0 THEN
      v_acc_upper := jsonb_set(v_acc_upper, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_upper->>'required')::numeric, 0) + v_upper * v_pairs));
    END IF;
    IF v_lining_pid IS NOT NULL AND v_lining > 0 THEN
      v_acc_lining := jsonb_set(v_acc_lining, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_lining->>'required')::numeric, 0) + v_lining * v_pairs));
    END IF;
    IF v_insole_pid IS NOT NULL AND v_insole > 0 THEN
      v_acc_insole := jsonb_set(v_acc_insole, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_insole->>'required')::numeric, 0) + v_insole * v_pairs));
    END IF;

    -- Standard sole items (per-size)
    IF v_sole_product_id IS NOT NULL THEN
      FOR v_std_item IN
        SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit
          FROM sole_standard_items_consumption ssic
         WHERE ssic.sole_product_id = v_sole_product_id
           AND ssic.size = v_size AND ssic.consumption > 0
      LOOP
        v_key := v_std_item.pid::text;
        v_acc_required := COALESCE((v_acc_std #>> ARRAY[v_key,'required'])::numeric, 0)
                         + v_std_item.cons * v_pairs;
        v_acc_std := jsonb_set(v_acc_std, ARRAY[v_key],
          jsonb_build_object('required', v_acc_required, 'unit', v_std_item.unit));
      END LOOP;
    END IF;
  END LOOP;

  -- ── Emit results ───────────────────────────────────────────────

  -- Solado
  IF v_sole_product_id IS NOT NULL THEN
    SELECT name, quantity INTO v_acc_name, v_acc_avail FROM products WHERE id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_acc_name,
      'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_total_qty,
      'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_total_qty,
      'debit_mode', 'hard', 'source', 'primary_sole');
    v_covered_categories  := array_append(v_covered_categories,  'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  -- Cabedal
  IF v_upper_pid IS NOT NULL AND COALESCE((v_acc_upper->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    v_required := (v_acc_upper->>'required')::numeric;
    v_result := v_result || jsonb_build_object(
      'component', 'Cabedal', 'product_id', v_upper_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by);
    v_covered_categories  := array_append(v_covered_categories,  'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

  -- Forro (only when insole_has_lining = true)
  IF v_lining_pid IS NOT NULL AND COALESCE((v_acc_lining->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    v_required := (v_acc_lining->>'required')::numeric;
    v_result := v_result || jsonb_build_object(
      'component', 'Forro', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by);
    v_covered_categories  := array_append(v_covered_categories,  'forro');
    v_covered_categories  := array_append(v_covered_categories,  'forração');
    v_covered_categories  := array_append(v_covered_categories,  'forracao');
    v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
  END IF;

  -- Palmilha (uses resolved color)
  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, v_palmilha_color, 0, false);
    v_required := (v_acc_insole->>'required')::numeric;
    v_result := v_result || jsonb_build_object(
      'component', 'Palmilha', 'product_id', v_insole_pid, 'product_name', v_resolved.product_name,
      'color', v_palmilha_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by);
    v_covered_categories  := array_append(v_covered_categories,  'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  -- Standard sole items
  FOR v_key IN SELECT jsonb_object_keys(v_acc_std) LOOP
    v_acc_required := (v_acc_std #>> ARRAY[v_key,'required'])::numeric;
    SELECT name, quantity, category INTO v_acc_name, v_acc_avail, v_row_cat_norm
      FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'component', 'Item padrão (solado)', 'product_id', v_key::uuid, 'product_name', v_acc_name,
        'color', '', 'consumption_per_unit', ROUND(v_acc_required / NULLIF(v_total_qty, 0), 4),
        'required', v_acc_required, 'available', v_acc_avail,
        'stock_ok', v_acc_avail >= v_acc_required,
        'debit_mode', CASE WHEN LOWER(COALESCE(v_row_cat_norm,'')) IN
          ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
        'source', 'sole_standard_per_size',
        'unit', (v_acc_std #>> ARRAY[v_key,'unit']));
      v_covered_product_ids := array_append(v_covered_product_ids, v_key::uuid);
    END IF;
  END LOOP;

  -- BOM legado (sheet_materials)
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color
      FROM sheet_materials sm
      JOIN products p ON p.id = sm.product_id
     WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories)    THEN CONTINUE; END IF;
    v_required := v_row.quantity_per_unit * v_total_qty;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color, 'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
        ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category);
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  -- Forros alternativos (lining_accessories) — skipped when insole_has_lining = false
  IF COALESCE(v_sheet.insole_has_lining, true) = true
     AND v_sheet.lining_accessories IS NOT NULL
     AND jsonb_typeof(v_sheet.lining_accessories) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sheet.lining_accessories) AS value LOOP
      v_group_name  := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
      v_required := v_consumption * v_total_qty;
      SELECT * INTO v_resolved FROM resolve_material_product(v_group_name, p_color, v_required, false);
      IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_covered_product_ids)) THEN
        v_result := v_result || jsonb_build_object(
          'component', 'Forro (alternativa)', 'product_id', v_resolved.product_id,
          'product_name', v_resolved.product_name, 'color', p_color,
          'consumption_per_unit', v_consumption, 'required', v_required,
          'available', v_resolved.available_qty,
          'stock_ok', v_resolved.available_qty >= v_required,
          'debit_mode', 'soft', 'source', 'lining_accessory', 'matched_by', v_resolved.matched_by);
        v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
      END IF;
    END LOOP;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_consumption_by_grade(uuid, jsonb, text) TO authenticated;

-- ================================================================
-- 2. calculate_order_consumption  (single-size / average)
--    Add insole_has_lining guard + palmilha color mapping.
-- ================================================================
DROP FUNCTION IF EXISTS public.calculate_order_consumption(p_reference_id  uuid, p_order_quantity numeric, p_color         text, p_size          integer) CASCADE;
CREATE OR REPLACE FUNCTION public.calculate_order_consumption(
  p_reference_id  uuid,
  p_order_quantity numeric,
  p_color         text,
  p_size          integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sheet              RECORD;
  v_sole_product_id    uuid;
  v_sole_color         text;
  v_spec               RECORD;
  v_result             jsonb := '[]'::jsonb;
  v_row                RECORD;
  v_item               jsonb;
  v_pid                uuid;
  v_consumption        numeric;
  v_required           numeric;
  v_resolved           RECORD;
  v_group_name         text;
  v_effective_size     integer;
  v_lining_consumption numeric;
  v_insole_consumption numeric;
  v_upper_consumption  numeric;
  v_covered_categories  text[]  := ARRAY[]::text[];
  v_covered_product_ids uuid[]  := ARRAY[]::uuid[];
  v_row_cat_norm       text;
  v_conv               RECORD;
  v_is_fachetado       boolean;
  v_fachete_consumption numeric;
  v_palmilha_color     text;   -- resolved insole color
BEGIN
  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  v_effective_size := COALESCE(p_size, v_sheet.reference_size, 37);

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  -- Per-size consumption (sheet JSONB → sole_technical_specs → scalar)
  v_upper_consumption  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_effective_size::text))::numeric, 0), 0);
  v_lining_consumption := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);
  v_insole_consumption := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);

  IF (v_upper_consumption IS NULL OR v_lining_consumption IS NULL OR v_insole_consumption IS NULL)
     AND COALESCE(v_sheet.sole_drives_consumption, false) AND v_sole_product_id IS NOT NULL THEN
    SELECT * INTO v_spec FROM sole_technical_specs
    WHERE sole_id = v_sole_product_id AND size = v_effective_size;
    IF FOUND THEN
      IF v_upper_consumption  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN v_upper_consumption  := v_spec.upper_consumption_dm2;  END IF;
      IF v_lining_consumption IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining_consumption := v_spec.lining_consumption_dm2; END IF;
      IF v_insole_consumption IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole_consumption := v_spec.insole_consumption_dm2; END IF;
    END IF;
  END IF;

  v_upper_consumption  := COALESCE(v_upper_consumption,  v_sheet.upper_consumption,  0);
  v_lining_consumption := COALESCE(v_lining_consumption, v_sheet.lining_consumption, 0);
  v_insole_consumption := COALESCE(v_insole_consumption, v_sheet.insole_consumption, 0);

  -- Resolve palmilha color
  v_palmilha_color := p_color;
  IF COALESCE(v_sheet.insole_has_lining, true) = false AND v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '' THEN
    SELECT palmilha_color INTO v_palmilha_color
    FROM technical_sheet_palmilha_colors
    WHERE sheet_id = p_reference_id
      AND (cabedal_color = p_color OR cabedal_color = '__DEFAULT__')
    ORDER BY (cabedal_color = p_color) DESC
    LIMIT 1;
    v_palmilha_color := COALESCE(v_palmilha_color, p_color);
  END IF;

  -- Solado
  IF v_sole_product_id IS NOT NULL THEN
    v_required := p_order_quantity;
    SELECT p.name, p.quantity INTO v_row FROM products p WHERE p.id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_row.name,
      'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_required,
      'available', v_row.quantity, 'stock_ok', v_row.quantity >= v_required,
      'debit_mode', 'hard', 'source', 'primary_sole');
    v_covered_categories  := array_append(v_covered_categories,  'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);

    -- Fachete
    SELECT COALESCE(is_fachetado, false) INTO v_is_fachetado FROM products WHERE id = v_sole_product_id;
    IF v_is_fachetado AND v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> '' THEN
      SELECT fachete_lining_consumption_dm2 INTO v_fachete_consumption
      FROM sole_technical_specs WHERE sole_id = v_sole_product_id AND size = v_effective_size;
      IF COALESCE(v_fachete_consumption, 0) > 0 THEN
        v_required := v_fachete_consumption * p_order_quantity;
        SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, v_required, false);
        IF v_resolved.product_id IS NOT NULL THEN
          SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
          v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
          v_result := v_result || jsonb_build_object(
            'component', 'Fachete', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
            'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
            'required', v_required, 'available', v_resolved.available_qty,
            'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
            'source', 'sole_fachete', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
        END IF;
      END IF;
    END IF;
  END IF;

  -- Cabedal
  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> ''
     AND v_upper_consumption > 0 THEN
    v_required := v_upper_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Cabedal', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
        'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
      v_covered_categories  := array_append(v_covered_categories,  'cabedal');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Forração (skip when insole_has_lining = false)
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND v_lining_consumption > 0
     AND COALESCE(v_sheet.insole_has_lining, true) = true THEN
    v_required := v_lining_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Forro', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
        'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
      v_covered_categories  := array_append(v_covered_categories,  'forro');
      v_covered_categories  := array_append(v_covered_categories,  'forração');
      v_covered_categories  := array_append(v_covered_categories,  'forracao');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Palmilha (uses resolved palmilha_color)
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> ''
     AND v_insole_consumption > 0 THEN
    v_required := v_insole_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, v_palmilha_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Palmilha', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
        'color', v_palmilha_color, 'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
      v_covered_categories  := array_append(v_covered_categories,  'palmilha');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Componentes diretos
  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * p_order_quantity;
        IF v_required > 0 THEN
          SELECT name, quantity, category INTO v_row FROM products WHERE id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto', 'product_id', v_pid, 'product_name', v_row.name,
              'consumption_per_unit', (v_item ->> 'quantity')::numeric, 'required', v_required,
              'available', v_row.quantity, 'stock_ok', v_row.quantity >= v_required,
              'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
                ('acessório','embalagem','cola / químico','ferramentas','solado','componente','componentes') THEN 'hard'
                ELSE 'soft' END,
              'source', 'direct_components');
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- BOM legado (sheet_materials)
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color
      FROM sheet_materials sm
      JOIN products p ON p.id = sm.product_id
     WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories)    THEN CONTINUE; END IF;
    v_required := v_row.quantity_per_unit * p_order_quantity;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color, 'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
        ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
      'source', 'sheet_materials');
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_consumption(uuid, numeric, text, integer) TO authenticated;

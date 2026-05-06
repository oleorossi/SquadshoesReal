-- PASSO 1C — Grupos 5 a 8 (cole no SQL Editor e clique Run)

-- === 20260430130000_add-corte-a-faca.sql ===
-- Adds "corte a faca" flag to technical_sheets.
-- When true the cabedal of this model must be cut in the Corte sector
-- and will appear in a dedicated "Cabedal (Corte a Faca)" section in the
-- Corte grouped report, separated by reference + color with a full grade.
ALTER TABLE technical_sheets
  ADD COLUMN IF NOT EXISTS corte_a_faca boolean NOT NULL DEFAULT false;


-- === 20260501120000_fix-consumption-by-grade-per-size.sql ===
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


-- === 20260501130000_fix-conjugated-debit-strict.sql ===
-- Fix debit_sole_stock_by_grade: strict conjugated-key handling
--
-- Previous version (20260426140000) used the conjugated key ONLY when it already
-- existed in stock_grade (as a safety fallback). This was wrong for soles that
-- HAVE conjugations configured: their stock must be stored with conjugated keys
-- (e.g. "24/25"), so debiting with individual keys ("24", "25") would fail.
--
-- New behaviour:
--   1. If p_order_grade already contains conjugated keys ("24/25") → use as-is.
--   2. If conjugations are configured for the sole group:
--      a. Map each individual size to its conjugated key via get_sole_size_key().
--      b. Sizes not covered by any conjugation → use as individual key.
--   3. No conjugations configured → use all keys from p_order_grade unchanged.
--
-- This makes the debit function work correctly for:
--   • New orders stored with conjugated grades  (case 1)
--   • Old orders stored with individual grades  (cases 2/3 — backwards compat)

CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id     uuid,
  p_color        text,
  p_order_grade  jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id       uuid;
  v_sole_material       text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id   uuid;
  target_product_id    uuid;
  target_name          text;
  v_stock_grade        jsonb;
  v_size               text;
  v_size_qty           numeric;
  v_available          numeric;
  v_new_grade          jsonb;
  v_total_debited      numeric := 0;
  v_prev_total         numeric;
  v_product_group_id   uuid;
  v_effective_grade    jsonb;
  v_conj_key           text;
  v_existing_qty       numeric;
  v_has_conjugations   boolean;
BEGIN
  -- ── Resolve sole info from technical sheet ───────────────────────────────────
  SELECT ts.sole_group_id, ts.sole_material
    INTO v_sole_group_id, v_sole_material
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;

  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN
    RETURN;
  END IF;

  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN;
  END IF;

  -- ── Resolve target sole product (same priority chain as before) ──────────────
  SELECT tsc.sole_product_id, tsc.sole_group_id
    INTO v_mapped_sole_product_id, v_mapped_sole_group_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sheet_id = p_reference_id
     AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, '')))
   LIMIT 1;

  target_product_id := NULL;

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
     WHERE p.active = true AND p.id = v_mapped_sole_product_id
     LIMIT 1;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_sole_group_id
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_sole_group_id
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true AND pg.name = v_sole_material
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true AND pg.name = v_sole_material
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN RETURN; END IF;

  IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

  SELECT p.group_id INTO v_product_group_id
    FROM public.products p WHERE p.id = target_product_id;

  -- ── Check whether conjugations are configured for this sole group ─────────────
  SELECT EXISTS (
    SELECT 1 FROM sole_size_conjugations WHERE sole_group_id = v_product_group_id
  ) INTO v_has_conjugations;

  -- ── Build effective debit grade ───────────────────────────────────────────────
  -- Rules:
  --   • If the key already contains '/' → already a conjugated key, use as-is
  --   • Else if conjugations are configured → resolve via get_sole_size_key()
  --     - If a conjugated key is found → use it (accumulate quantities)
  --     - If not found → the size is non-conjugated within the range, use as-is
  --   • No conjugations configured → use key unchanged (legacy individual format)
  v_effective_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
      FROM jsonb_each_text(p_order_grade)
     WHERE value::numeric > 0
  LOOP
    IF v_size LIKE '%/%' THEN
      -- Already a conjugated key ("24/25") — pass through
      v_conj_key := v_size;

    ELSIF v_has_conjugations AND v_product_group_id IS NOT NULL THEN
      -- Sole has conjugations; map individual size → conjugated key
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
      -- Size not covered by any conjugation → keep as individual key
      IF v_conj_key IS NULL THEN v_conj_key := v_size; END IF;

    ELSE
      v_conj_key := v_size;
    END IF;

    v_existing_qty := COALESCE((v_effective_grade ->> v_conj_key)::numeric, 0);
    v_effective_grade := jsonb_set(
      v_effective_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty)
    );
  END LOOP;

  -- ── Compute previous total for stock_movements ────────────────────────────────
  v_prev_total := 0;
  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade) LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  -- ── Validate stock availability ───────────────────────────────────────────────
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponível %, necessário %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  -- ── Debit stock ───────────────────────────────────────────────────────────────
  v_new_grade := v_stock_grade;
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
       SET stock_grade = v_new_grade,
           quantity    = GREATEST(0, quantity - v_total_debited),
           updated_at  = now()
     WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Débito Solado por grade (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.debit_sole_stock_by_grade(uuid, uuid, text, jsonb) TO authenticated;


-- === 20260502100000_fix-rls-missing-policies.sql ===
-- ---------------------------------------------------------------
-- Fix RLS gaps:
--   1. 19 tables had RLS enabled but policies never created or
--      were dropped without replacement. This migration adds
--      idempotent policies (DROP IF EXISTS + CREATE) for all of
--      them using the project-standard is_approved_user() pattern.
--   2. 5 tables had policies defined but RLS never enabled.
-- ---------------------------------------------------------------

-- ================================================================
-- PART 1 — Tables with RLS enabled but missing policies
-- ================================================================

-- ── artisanal_recipes ───────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view artisanal_recipes"   ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can insert artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can update artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can delete artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Authenticated users can view artisanal recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can view artisanal_recipes"
  ON public.artisanal_recipes FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert artisanal_recipes"
  ON public.artisanal_recipes FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update artisanal_recipes"
  ON public.artisanal_recipes FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete artisanal_recipes"
  ON public.artisanal_recipes FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── default_lead_times ──────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view default_lead_times"   ON public.default_lead_times;
DROP POLICY IF EXISTS "Approved users can insert default_lead_times" ON public.default_lead_times;
DROP POLICY IF EXISTS "Approved users can update default_lead_times" ON public.default_lead_times;
DROP POLICY IF EXISTS "Approved users can delete default_lead_times" ON public.default_lead_times;
CREATE POLICY "Approved users can view default_lead_times"
  ON public.default_lead_times FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert default_lead_times"
  ON public.default_lead_times FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update default_lead_times"
  ON public.default_lead_times FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete default_lead_times"
  ON public.default_lead_times FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── employee_skills ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view employee_skills"   ON public.employee_skills;
DROP POLICY IF EXISTS "Approved users can insert employee_skills" ON public.employee_skills;
DROP POLICY IF EXISTS "Approved users can update employee_skills" ON public.employee_skills;
DROP POLICY IF EXISTS "Approved users can delete employee_skills" ON public.employee_skills;
CREATE POLICY "Approved users can view employee_skills"
  ON public.employee_skills FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert employee_skills"
  ON public.employee_skills FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update employee_skills"
  ON public.employee_skills FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete employee_skills"
  ON public.employee_skills FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── equipment_downtime ──────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view equipment_downtime"   ON public.equipment_downtime;
DROP POLICY IF EXISTS "Approved users can insert equipment_downtime" ON public.equipment_downtime;
DROP POLICY IF EXISTS "Approved users can update equipment_downtime" ON public.equipment_downtime;
DROP POLICY IF EXISTS "Approved users can delete equipment_downtime" ON public.equipment_downtime;
CREATE POLICY "Approved users can view equipment_downtime"
  ON public.equipment_downtime FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert equipment_downtime"
  ON public.equipment_downtime FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update equipment_downtime"
  ON public.equipment_downtime FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete equipment_downtime"
  ON public.equipment_downtime FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── inventory_transactions ──────────────────────────────────────
DROP POLICY IF EXISTS "Allow full access for authenticated users to inventory transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can view inventory_transactions"   ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can insert inventory_transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can update inventory_transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can delete inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "Approved users can view inventory_transactions"
  ON public.inventory_transactions FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert inventory_transactions"
  ON public.inventory_transactions FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update inventory_transactions"
  ON public.inventory_transactions FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete inventory_transactions"
  ON public.inventory_transactions FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── material_audit_log (read-only for approved users) ───────────
DROP POLICY IF EXISTS "Approved users can view material_audit_log"   ON public.material_audit_log;
DROP POLICY IF EXISTS "Approved users can insert material_audit_log" ON public.material_audit_log;
DROP POLICY IF EXISTS "Approved users can update material_audit_log" ON public.material_audit_log;
DROP POLICY IF EXISTS "Approved users can delete material_audit_log" ON public.material_audit_log;
CREATE POLICY "Approved users can view material_audit_log"
  ON public.material_audit_log FOR SELECT TO authenticated USING (public.is_approved_user());
-- Insert allowed for SECURITY DEFINER functions (triggers/RPCs write to this table)
CREATE POLICY "Approved users can insert material_audit_log"
  ON public.material_audit_log FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());

-- ── product_technical_sheets ────────────────────────────────────
DROP POLICY IF EXISTS "Allow full access for authenticated users to technical sheets" ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can view product_technical_sheets"   ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can insert product_technical_sheets" ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can update product_technical_sheets" ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can delete product_technical_sheets" ON public.product_technical_sheets;
CREATE POLICY "Approved users can view product_technical_sheets"
  ON public.product_technical_sheets FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert product_technical_sheets"
  ON public.product_technical_sheets FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update product_technical_sheets"
  ON public.product_technical_sheets FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete product_technical_sheets"
  ON public.product_technical_sheets FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── production_equipment ────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view production_equipment"   ON public.production_equipment;
DROP POLICY IF EXISTS "Approved users can insert production_equipment" ON public.production_equipment;
DROP POLICY IF EXISTS "Approved users can update production_equipment" ON public.production_equipment;
DROP POLICY IF EXISTS "Approved users can delete production_equipment" ON public.production_equipment;
CREATE POLICY "Approved users can view production_equipment"
  ON public.production_equipment FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert production_equipment"
  ON public.production_equipment FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update production_equipment"
  ON public.production_equipment FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete production_equipment"
  ON public.production_equipment FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── quality_checklists ──────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view quality_checklists"   ON public.quality_checklists;
DROP POLICY IF EXISTS "Approved users can insert quality_checklists" ON public.quality_checklists;
DROP POLICY IF EXISTS "Approved users can update quality_checklists" ON public.quality_checklists;
DROP POLICY IF EXISTS "Approved users can delete quality_checklists" ON public.quality_checklists;
CREATE POLICY "Approved users can view quality_checklists"
  ON public.quality_checklists FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert quality_checklists"
  ON public.quality_checklists FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update quality_checklists"
  ON public.quality_checklists FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete quality_checklists"
  ON public.quality_checklists FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── quality_inspections ─────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view quality_inspections"   ON public.quality_inspections;
DROP POLICY IF EXISTS "Approved users can insert quality_inspections" ON public.quality_inspections;
DROP POLICY IF EXISTS "Approved users can update quality_inspections" ON public.quality_inspections;
DROP POLICY IF EXISTS "Approved users can delete quality_inspections" ON public.quality_inspections;
CREATE POLICY "Approved users can view quality_inspections"
  ON public.quality_inspections FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert quality_inspections"
  ON public.quality_inspections FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update quality_inspections"
  ON public.quality_inspections FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete quality_inspections"
  ON public.quality_inspections FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sales_targets ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view sales_targets"   ON public.sales_targets;
DROP POLICY IF EXISTS "Approved users can insert sales_targets" ON public.sales_targets;
DROP POLICY IF EXISTS "Approved users can update sales_targets" ON public.sales_targets;
DROP POLICY IF EXISTS "Approved users can delete sales_targets" ON public.sales_targets;
CREATE POLICY "Approved users can view sales_targets"
  ON public.sales_targets FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sales_targets"
  ON public.sales_targets FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sales_targets"
  ON public.sales_targets FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sales_targets"
  ON public.sales_targets FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sheet_catalog_models ────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can manage catalog models"   ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can view sheet_catalog_models"   ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can insert sheet_catalog_models" ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can update sheet_catalog_models" ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can delete sheet_catalog_models" ON public.sheet_catalog_models;
CREATE POLICY "Approved users can view sheet_catalog_models"
  ON public.sheet_catalog_models FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sheet_catalog_models"
  ON public.sheet_catalog_models FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sheet_catalog_models"
  ON public.sheet_catalog_models FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sheet_catalog_models"
  ON public.sheet_catalog_models FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sheet_material_grading ──────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view sheet_material_grading"   ON public.sheet_material_grading;
DROP POLICY IF EXISTS "Approved users can insert sheet_material_grading" ON public.sheet_material_grading;
DROP POLICY IF EXISTS "Approved users can update sheet_material_grading" ON public.sheet_material_grading;
DROP POLICY IF EXISTS "Approved users can delete sheet_material_grading" ON public.sheet_material_grading;
CREATE POLICY "Approved users can view sheet_material_grading"
  ON public.sheet_material_grading FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sheet_material_grading"
  ON public.sheet_material_grading FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sheet_material_grading"
  ON public.sheet_material_grading FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sheet_material_grading"
  ON public.sheet_material_grading FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sole_silk_registrations ─────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view sole_silk_registrations"   ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Approved users can insert sole_silk_registrations" ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Approved users can update sole_silk_registrations" ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Approved users can delete sole_silk_registrations" ON public.sole_silk_registrations;
CREATE POLICY "Approved users can view sole_silk_registrations"
  ON public.sole_silk_registrations FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sole_silk_registrations"
  ON public.sole_silk_registrations FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sole_silk_registrations"
  ON public.sole_silk_registrations FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sole_silk_registrations"
  ON public.sole_silk_registrations FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sole_size_conjugations ──────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view sole_size_conjugations"   ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Approved users can insert sole_size_conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Approved users can update sole_size_conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Approved users can delete sole_size_conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Approved users can view sole_size_conjugations"
  ON public.sole_size_conjugations FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sole_size_conjugations"
  ON public.sole_size_conjugations FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sole_size_conjugations"
  ON public.sole_size_conjugations FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sole_size_conjugations"
  ON public.sole_size_conjugations FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sole_standard_items_consumption ────────────────────────────
DROP POLICY IF EXISTS "Approved users can view sole_standard_items_consumption"   ON public.sole_standard_items_consumption;
DROP POLICY IF EXISTS "Approved users can insert sole_standard_items_consumption" ON public.sole_standard_items_consumption;
DROP POLICY IF EXISTS "Approved users can update sole_standard_items_consumption" ON public.sole_standard_items_consumption;
DROP POLICY IF EXISTS "Approved users can delete sole_standard_items_consumption" ON public.sole_standard_items_consumption;
CREATE POLICY "Approved users can view sole_standard_items_consumption"
  ON public.sole_standard_items_consumption FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sole_standard_items_consumption"
  ON public.sole_standard_items_consumption FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sole_standard_items_consumption"
  ON public.sole_standard_items_consumption FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sole_standard_items_consumption"
  ON public.sole_standard_items_consumption FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── technical_sheet_insole_colors ───────────────────────────────
DROP POLICY IF EXISTS "Approved users can view technical_sheet_insole_colors"   ON public.technical_sheet_insole_colors;
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
DROP POLICY IF EXISTS "Approved users can update technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
CREATE POLICY "Approved users can view technical_sheet_insole_colors"
  ON public.technical_sheet_insole_colors FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert technical_sheet_insole_colors"
  ON public.technical_sheet_insole_colors FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update technical_sheet_insole_colors"
  ON public.technical_sheet_insole_colors FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete technical_sheet_insole_colors"
  ON public.technical_sheet_insole_colors FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── technical_sheet_overhead_history ────────────────────────────
DROP POLICY IF EXISTS "Users can view history of sheets they can access" ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can view technical_sheet_overhead_history"   ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can update technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
CREATE POLICY "Approved users can view technical_sheet_overhead_history"
  ON public.technical_sheet_overhead_history FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert technical_sheet_overhead_history"
  ON public.technical_sheet_overhead_history FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());

-- ── technical_sheet_palmilha_colors (CRITICAL — used in consumption RPCs) ──
DROP POLICY IF EXISTS "allow_all_palmilha_colors"                              ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can view technical_sheet_palmilha_colors"   ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can update technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
CREATE POLICY "Approved users can view technical_sheet_palmilha_colors"
  ON public.technical_sheet_palmilha_colors FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert technical_sheet_palmilha_colors"
  ON public.technical_sheet_palmilha_colors FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update technical_sheet_palmilha_colors"
  ON public.technical_sheet_palmilha_colors FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete technical_sheet_palmilha_colors"
  ON public.technical_sheet_palmilha_colors FOR DELETE TO authenticated USING (public.is_approved_user());

-- ================================================================
-- PART 2 — Tables with policies but RLS not enabled
-- ================================================================

ALTER TABLE public.baus               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.box_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_companies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_company_rates  ENABLE ROW LEVEL SECURITY;

-- Ensure these tables have policies (drop old + recreate idempotently)
DROP POLICY IF EXISTS "Approved users can view baus"   ON public.baus;
DROP POLICY IF EXISTS "Approved users can insert baus" ON public.baus;
DROP POLICY IF EXISTS "Approved users can update baus" ON public.baus;
DROP POLICY IF EXISTS "Approved users can delete baus" ON public.baus;
CREATE POLICY "Approved users can view baus"   ON public.baus FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert baus" ON public.baus FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update baus" ON public.baus FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete baus" ON public.baus FOR DELETE TO authenticated USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can view box_types"   ON public.box_types;
DROP POLICY IF EXISTS "Approved users can insert box_types" ON public.box_types;
DROP POLICY IF EXISTS "Approved users can update box_types" ON public.box_types;
DROP POLICY IF EXISTS "Approved users can delete box_types" ON public.box_types;
CREATE POLICY "Approved users can view box_types"   ON public.box_types FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert box_types" ON public.box_types FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update box_types" ON public.box_types FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete box_types" ON public.box_types FOR DELETE TO authenticated USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can view item_types"   ON public.item_types;
DROP POLICY IF EXISTS "Approved users can insert item_types" ON public.item_types;
DROP POLICY IF EXISTS "Approved users can update item_types" ON public.item_types;
DROP POLICY IF EXISTS "Approved users can delete item_types" ON public.item_types;
CREATE POLICY "Approved users can view item_types"   ON public.item_types FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert item_types" ON public.item_types FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update item_types" ON public.item_types FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete item_types" ON public.item_types FOR DELETE TO authenticated USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can view transport_companies"   ON public.transport_companies;
DROP POLICY IF EXISTS "Approved users can insert transport_companies" ON public.transport_companies;
DROP POLICY IF EXISTS "Approved users can update transport_companies" ON public.transport_companies;
DROP POLICY IF EXISTS "Approved users can delete transport_companies" ON public.transport_companies;
CREATE POLICY "Approved users can view transport_companies"   ON public.transport_companies FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert transport_companies" ON public.transport_companies FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update transport_companies" ON public.transport_companies FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete transport_companies" ON public.transport_companies FOR DELETE TO authenticated USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can view transport_company_rates"   ON public.transport_company_rates;
DROP POLICY IF EXISTS "Approved users can insert transport_company_rates" ON public.transport_company_rates;
DROP POLICY IF EXISTS "Approved users can update transport_company_rates" ON public.transport_company_rates;
DROP POLICY IF EXISTS "Approved users can delete transport_company_rates" ON public.transport_company_rates;
CREATE POLICY "Approved users can view transport_company_rates"   ON public.transport_company_rates FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert transport_company_rates" ON public.transport_company_rates FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update transport_company_rates" ON public.transport_company_rates FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete transport_company_rates" ON public.transport_company_rates FOR DELETE TO authenticated USING (public.is_approved_user());


-- === 20260502130000_construction-model-restructure.sql ===
-- Construction model restructure: 3 clear production models
-- Model 1: Corte Cabedal (sole + insole ready-made from outside, consumed in units)
-- Model 2: Corte Cabedal + Palmilha Forrada (standard with lining)
-- Model 3: Tiras (no cabedal cut, goes through Mesa sector)

-- 1. mesa_daily_capacity: daily pair capacity at the Mesa sector (Model 3 / tiras)
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS mesa_daily_capacity integer NOT NULL DEFAULT 0;

-- 2. insole_ready_made: sole + insole arrive ready-made (Model 1)
--    Consumed in units by size, not dm². Only cabedal needs consumption tracking.
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_ready_made boolean NOT NULL DEFAULT false;

-- 3. insole_included: mark a sole product group as "comes with insole included"
--    When a sole with insole_included=true is used, the sheet defaults to Model 1.
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS insole_included boolean NOT NULL DEFAULT false;


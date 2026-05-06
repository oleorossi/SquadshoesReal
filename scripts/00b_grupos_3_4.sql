-- PASSO 1B — Grupos 3 e 4 (cole no SQL Editor e clique Run)

-- === 20260426120000_consumption-per-size-as-primary-source.sql ===
-- Make technical_sheets.*_consumption_per_size the primary source for all consumption calculations.
-- Priority: sheet per-size → sole_technical_specs (if sole_drives_consumption) → scalar fallback.

CREATE OR REPLACE FUNCTION public.calculate_order_consumption(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_size integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet RECORD;
  v_sole_product_id uuid;
  v_sole_color text;
  v_spec RECORD;
  v_result jsonb := '[]'::jsonb;
  v_row RECORD;
  v_item jsonb;
  v_pid uuid;
  v_consumption numeric;
  v_required numeric;
  v_resolved RECORD;
  v_group_name text;
  v_effective_size integer;
  v_lining_consumption numeric;
  v_insole_consumption numeric;
  v_upper_consumption numeric;
  v_covered_categories text[] := ARRAY[]::text[];
  v_covered_product_ids uuid[] := ARRAY[]::uuid[];
  v_row_cat_norm text;
  v_conv RECORD;
BEGIN
  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  v_effective_size := COALESCE(p_size, v_sheet.reference_size, 37);

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  -- 1. Read per-size consumption from the sheet (primary source)
  v_upper_consumption  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_effective_size::text))::numeric, 0), 0);
  v_lining_consumption := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);
  v_insole_consumption := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);

  -- 2. Fallback: sole_technical_specs (when sole_drives_consumption and sheet has no per-size)
  IF (v_upper_consumption IS NULL OR v_lining_consumption IS NULL OR v_insole_consumption IS NULL)
     AND v_sheet.sole_drives_consumption AND v_sole_product_id IS NOT NULL THEN
    SELECT * INTO v_spec FROM sole_technical_specs
    WHERE sole_id = v_sole_product_id AND size = v_effective_size;
    IF FOUND THEN
      IF v_upper_consumption  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN v_upper_consumption  := v_spec.upper_consumption_dm2;  END IF;
      IF v_lining_consumption IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining_consumption := v_spec.lining_consumption_dm2; END IF;
      IF v_insole_consumption IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole_consumption := v_spec.insole_consumption_dm2; END IF;
    END IF;
  END IF;

  -- 3. Final fallback: scalar average from sheet
  v_upper_consumption  := COALESCE(v_upper_consumption,  v_sheet.upper_consumption,  0);
  v_lining_consumption := COALESCE(v_lining_consumption, v_sheet.lining_consumption, 0);
  v_insole_consumption := COALESCE(v_insole_consumption, v_sheet.insole_consumption, 0);

  -- Solado
  IF v_sole_product_id IS NOT NULL THEN
    v_required := p_order_quantity;
    SELECT p.name, p.quantity INTO v_row FROM products p WHERE p.id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado',
      'product_id', v_sole_product_id,
      'product_name', v_row.name,
      'color', v_sole_color,
      'consumption_per_unit', 1,
      'required', v_required,
      'available', v_row.quantity,
      'stock_ok', v_row.quantity >= v_required,
      'debit_mode', 'hard',
      'source', 'primary_sole'
    );
    v_covered_categories := array_append(v_covered_categories, 'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
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
        'component', 'Cabedal',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by,
        'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'cabedal');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Forração
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND v_lining_consumption > 0 THEN
    v_required := v_lining_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Forro',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by,
        'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'forro');
      v_covered_categories := array_append(v_covered_categories, 'forração');
      v_covered_categories := array_append(v_covered_categories, 'forracao');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Palmilha
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> ''
     AND v_insole_consumption > 0 THEN
    v_required := v_insole_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Palmilha',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by,
        'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'palmilha');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Direct Components from technical_sheets.direct_components (JSONB array)
  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * p_order_quantity;
        IF v_required > 0 THEN
          SELECT name, quantity, category INTO v_row FROM products WHERE id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto',
              'product_id', v_pid,
              'product_name', v_row.name,
              'consumption_per_unit', (v_item ->> 'quantity')::numeric,
              'required', v_required,
              'available', v_row.quantity,
              'stock_ok', v_row.quantity >= v_required,
              'debit_mode', CASE
                WHEN LOWER(COALESCE(v_row.category, '')) IN
                  ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
                ELSE 'soft'
              END,
              'source', 'direct_components'
            );
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- BOM legacy
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color, p.group_id
    FROM sheet_materials sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories) THEN CONTINUE; END IF;

    v_required := v_row.quantity_per_unit * p_order_quantity;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM',
      'product_id', v_row.product_id,
      'product_name', v_row.name,
      'color', v_row.product_color,
      'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required,
      'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE
        WHEN LOWER(COALESCE(v_row.category, '')) IN
          ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
        ELSE 'soft'
      END,
      'source', 'sheet_materials',
      'category', v_row.category
    );
  END LOOP;

  RETURN v_result;
END;
$function$;

-- Grade-based version: reads technical_sheets.*_consumption_per_size per size (primary),
-- falls back to sole_technical_specs, then to sheet scalar.
CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(
  p_reference_id uuid,
  p_grade jsonb,
  p_color text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet RECORD;
  v_sole_product_id uuid;
  v_sole_color text;
  v_total_qty numeric := 0;
  v_size integer;
  v_pairs numeric;
  v_spec RECORD;
  v_upper numeric;
  v_lining numeric;
  v_insole numeric;
  v_resolved RECORD;
  v_row RECORD;
  v_item jsonb;
  v_pid uuid;
  v_consumption numeric;
  v_required numeric;
  v_group_name text;
  v_covered_categories text[] := ARRAY[]::text[];
  v_covered_product_ids uuid[] := ARRAY[]::uuid[];
  v_row_cat_norm text;
  v_acc_upper jsonb := '{}'::jsonb;
  v_acc_lining jsonb := '{}'::jsonb;
  v_acc_insole jsonb := '{}'::jsonb;
  v_acc_std jsonb := '{}'::jsonb;
  v_result jsonb := '[]'::jsonb;
  v_upper_pid uuid;
  v_lining_pid uuid;
  v_insole_pid uuid;
  v_std_item RECORD;
  v_key text;
  v_acc_required numeric;
  v_acc_avail numeric;
  v_acc_name text;
  v_conv RECORD;
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

  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    v_upper_pid := v_resolved.product_id;
  END IF;
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    v_lining_pid := v_resolved.product_id;
  END IF;
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, 0, false);
    v_insole_pid := v_resolved.product_id;
  END IF;

  FOR v_size, v_pairs IN
    SELECT key::integer, value::numeric
      FROM jsonb_each_text(p_grade)
     WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0
  LOOP
    -- 1. Per-size from ficha técnica (primary source)
    v_upper  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_size::text))::numeric, 0), 0);
    v_lining := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_insole := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_size::text))::numeric, 0), 0);

    -- 2. Fallback: sole_technical_specs for any missing value
    IF (v_upper IS NULL OR v_lining IS NULL OR v_insole IS NULL)
       AND v_sheet.sole_drives_consumption AND v_sole_product_id IS NOT NULL THEN
      SELECT * INTO v_spec FROM sole_technical_specs
       WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF v_upper  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN v_upper  := v_spec.upper_consumption_dm2;  END IF;
        IF v_lining IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining := v_spec.lining_consumption_dm2; END IF;
        IF v_insole IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole := v_spec.insole_consumption_dm2; END IF;
      END IF;
    END IF;

    -- 3. Last fallback: scalar from sheet
    v_upper  := COALESCE(v_upper,  v_sheet.upper_consumption,  0);
    v_lining := COALESCE(v_lining, v_sheet.lining_consumption, 0);
    v_insole := COALESCE(v_insole, v_sheet.insole_consumption, 0);

    IF v_upper_pid IS NOT NULL AND v_upper > 0 THEN
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

    -- Standard items per sole (unchanged)
    IF v_sole_product_id IS NOT NULL THEN
      FOR v_std_item IN
        SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit
          FROM sole_standard_items_consumption ssic
         WHERE ssic.sole_product_id = v_sole_product_id AND ssic.size = v_size AND ssic.consumption > 0
      LOOP
        v_key := v_std_item.pid::text;
        v_acc_required := COALESCE((v_acc_std #>> ARRAY[v_key,'required'])::numeric, 0) + v_std_item.cons * v_pairs;
        v_acc_std := jsonb_set(v_acc_std, ARRAY[v_key], jsonb_build_object('required', v_acc_required, 'unit', v_std_item.unit));
      END LOOP;
    END IF;
  END LOOP;

  -- Solado
  IF v_sole_product_id IS NOT NULL THEN
    SELECT name, quantity INTO v_acc_name, v_acc_avail FROM products WHERE id = v_sole_product_id;
    v_result := v_result || jsonb_build_object('component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_acc_name, 'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_total_qty, 'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_total_qty, 'debit_mode', 'hard', 'source', 'primary_sole');
    v_covered_categories := array_append(v_covered_categories, 'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  -- Cabedal
  IF v_upper_pid IS NOT NULL AND COALESCE((v_acc_upper->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_upper_pid);
    v_required := ((v_acc_upper->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Cabedal', 'product_id', v_upper_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

  -- Forro
  IF v_lining_pid IS NOT NULL AND COALESCE((v_acc_lining->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_lining_pid);
    v_required := ((v_acc_lining->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Forro', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'forro');
    v_covered_categories := array_append(v_covered_categories, 'forração');
    v_covered_categories := array_append(v_covered_categories, 'forracao');
    v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
  END IF;

  -- Palmilha
  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_insole_pid);
    v_required := ((v_acc_insole->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Palmilha', 'product_id', v_insole_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  -- Items padrão (solado) acumulados
  FOR v_key IN SELECT jsonb_object_keys(v_acc_std) LOOP
    v_acc_required := (v_acc_std #>> ARRAY[v_key,'required'])::numeric;
    SELECT name, quantity, category INTO v_acc_name, v_acc_avail, v_row_cat_norm
      FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('component', 'Item padrão (solado)', 'product_id', v_key::uuid, 'product_name', v_acc_name, 'color', '', 'consumption_per_unit', ROUND(v_acc_required / NULLIF(v_total_qty, 0), 4), 'required', v_acc_required, 'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_acc_required, 'debit_mode', CASE WHEN LOWER(COALESCE(v_row_cat_norm, '')) IN ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard' ELSE 'soft' END, 'source', 'sole_standard_per_size', 'unit', (v_acc_std #>> ARRAY[v_key,'unit']));
      v_covered_product_ids := array_append(v_covered_product_ids, v_key::uuid);
    END IF;
  END LOOP;

  -- Direct Components
  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * v_total_qty;
        IF v_required > 0 THEN
          SELECT name, quantity, category INTO v_row FROM products WHERE id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto',
              'product_id', v_pid,
              'product_name', v_row.name,
              'consumption_per_unit', (v_item ->> 'quantity')::numeric,
              'required', v_required,
              'available', v_row.quantity,
              'stock_ok', v_row.quantity >= v_required,
              'debit_mode', CASE
                WHEN LOWER(COALESCE(v_row.category, '')) IN
                  ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
                ELSE 'soft'
              END,
              'source', 'direct_components'
            );
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- BOM Legado
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color
      FROM sheet_materials sm
      JOIN products p ON p.id = sm.product_id
     WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories) THEN CONTINUE; END IF;

    v_required := v_row.quantity_per_unit * v_total_qty;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM',
      'product_id', v_row.product_id,
      'product_name', v_row.name,
      'color', v_row.product_color,
      'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required,
      'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE
        WHEN LOWER(COALESCE(v_row.category, '')) IN
          ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
        ELSE 'soft' END,
      'source', 'sheet_materials',
      'category', v_row.category
    );
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  RETURN v_result;
END;
$function$;


-- === 20260426130000_sole-size-conjugations.sql ===
-- New table to store conjugation config per sole group
CREATE TABLE IF NOT EXISTS public.sole_size_conjugations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sole_group_id uuid NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
  size_key text NOT NULL,          -- display key: "23/24", "25/26", "35"
  sizes integer[] NOT NULL,        -- e.g. [23,24] or [35]
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(sole_group_id, size_key)
);

-- Helper: for a sole group + shoe size, return the conjugated key (or NULL if not configured)
CREATE OR REPLACE FUNCTION public.get_sole_size_key(p_sole_group_id uuid, p_shoe_size integer)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT size_key
  FROM sole_size_conjugations
  WHERE sole_group_id = p_sole_group_id
    AND p_shoe_size = ANY(sizes)
  LIMIT 1;
$$;

-- Helper: return group_id for a given product_id
CREATE OR REPLACE FUNCTION public.get_sole_group_id_for_product(p_product_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT group_id FROM public.products WHERE id = p_product_id LIMIT 1;
$$;

-- Updated debit_sole_stock_by_grade with conjugation support
CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id uuid,
  p_color text,
  p_order_grade jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id uuid;
  v_sole_material text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id uuid;
  target_product_id uuid;
  target_name text;
  v_stock_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_new_grade jsonb;
  v_total_debited numeric := 0;
  v_prev_total numeric;
  v_product_group_id uuid;
  v_conj_grade jsonb;
  v_conj_key text;
  v_existing_qty numeric;
BEGIN
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
    WHERE p.active = true
      AND p.id = v_mapped_sole_product_id
    LIMIT 1;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_mapped_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_mapped_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_sole_group_id
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
      WHERE p.active = true
        AND pg.name = v_sole_material
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true
        AND pg.name = v_sole_material
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN
    RETURN;
  END IF;

  IF v_stock_grade IS NULL THEN
    v_stock_grade := '{}'::jsonb;
  END IF;

  -- Get the group_id for the resolved target product
  SELECT p.group_id INTO v_product_group_id
  FROM public.products p
  WHERE p.id = target_product_id;

  -- Build conjugated grade from p_order_grade
  -- For each size in p_order_grade, check if it maps to a conjugated key
  v_conj_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(p_order_grade)
    WHERE value::numeric > 0
  LOOP
    IF v_product_group_id IS NOT NULL THEN
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
    ELSE
      v_conj_key := NULL;
    END IF;

    -- Use conjugated key if available, else original size string
    IF v_conj_key IS NULL THEN
      v_conj_key := v_size;
    END IF;

    -- Accumulate quantities under the conjugated key
    v_existing_qty := COALESCE((v_conj_grade ->> v_conj_key)::numeric, 0);
    v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
  END LOOP;

  v_new_grade := v_stock_grade;
  v_prev_total := 0;

  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade)
  LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  -- Validate stock availability using conjugated grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponivel %, necessario %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  -- Debit stock using conjugated grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
    SET stock_grade = v_new_grade,
        quantity = GREATEST(0, quantity - v_total_debited),
        updated_at = now()
    WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id,
      movement_type,
      quantity,
      previous_stock,
      new_stock,
      description,
      order_id
    )
    VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Debito Solado por grade (' || target_name || ')' || CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor do produto: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;


-- === 20260426140000_fix-conjugation-debit-legacy-fallback.sql ===
-- Fix: debit_sole_stock_by_grade with conjugation only applies conjugated key
-- when that key actually exists in stock_grade. If stock was recorded with individual
-- keys ("23", "24") before conjugation was configured, fall back to individual keys.
-- This makes conjugation backwards-compatible with existing stock data.

CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id uuid,
  p_color text,
  p_order_grade jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id uuid;
  v_sole_material text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id uuid;
  target_product_id uuid;
  target_name text;
  v_stock_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_new_grade jsonb;
  v_total_debited numeric := 0;
  v_prev_total numeric;
  v_product_group_id uuid;
  v_conj_grade jsonb;
  v_conj_key text;
  v_existing_qty numeric;
BEGIN
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

  IF v_stock_grade IS NULL THEN
    v_stock_grade := '{}'::jsonb;
  END IF;

  SELECT p.group_id INTO v_product_group_id FROM public.products p WHERE p.id = target_product_id;

  -- Build effective debit grade:
  -- For each order size, look up its conjugated key.
  -- Use the conjugated key ONLY if it already exists in stock_grade (new stock format).
  -- Otherwise fall back to the individual size key (legacy stock format).
  -- This makes conjugation backwards-compatible with existing per-size stock data.
  v_conj_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(p_order_grade)
    WHERE value::numeric > 0
  LOOP
    v_conj_key := NULL;

    IF v_product_group_id IS NOT NULL THEN
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
    END IF;

    -- Only use conjugated key if it actually exists in stock_grade
    IF v_conj_key IS NOT NULL AND (v_stock_grade ->> v_conj_key) IS NOT NULL THEN
      v_existing_qty := COALESCE((v_conj_grade ->> v_conj_key)::numeric, 0);
      v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
    ELSE
      -- Fallback: use original size string (legacy individual keys or no conjugation)
      v_existing_qty := COALESCE((v_conj_grade ->> v_size)::numeric, 0);
      v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_size], to_jsonb(v_existing_qty + v_size_qty));
    END IF;
  END LOOP;

  v_new_grade := v_stock_grade;
  v_prev_total := 0;

  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade) LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  -- Validate stock availability using effective grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponivel %, necessario %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  -- Debit stock using effective grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
    SET stock_grade = v_new_grade,
        quantity = GREATEST(0, quantity - v_total_debited),
        updated_at = now()
    WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Debito Solado por grade (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor do produto: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;


-- === 20260427240000_mesa-sector-planning.sql ===
-- Integrate the Mesa sector into the production planning cascade.
--
-- Mesa applies only to models with has_straps = true.
-- lead_time_mesa_dias is derived from handling_time_minutes (min/pair):
--   dias = CEIL(handling_time_minutes * quantity / 480)
--   where 480 = 8 h × 60 min (one working day).
--
-- Position in cascade (before Acabamento, after Montagem):
--   entrega → acabamento → MESA → montagem → costura → corte → buffer → compra

-- ── 1. Recreate view with Mesa ────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.purchase_projection_timeline AS
WITH lt AS (
  SELECT
    o.id               AS order_id,
    o.order_number     AS pedido_ref,
    o.sale_order_id,
    so.delivery_deadline AS data_entrega_cliente,
    o.quantity         AS op_quantity,
    o.status           AS order_status,
    o.reference_id,
    ts.name            AS referencia_nome,
    ts.id              AS sheet_id,
    ts.shoe_category   AS sheet_category,

    -- Corte: dynamic capacity or fixed days
    CASE
      WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                      dlt.cutting_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
    END AS lead_time_corte_dias,

    -- Costura
    CASE
      WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                      dlt.sewing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3)
    END AS lead_time_costura_dias,

    -- Montagem
    CASE
      WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                      dlt.assembly_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
    END AS lead_time_montagem_dias,

    -- Mesa (tiras): CEIL(min_par × qty / 480). Zero when not applicable.
    CASE
      WHEN ts.has_straps = true AND COALESCE(ts.handling_time_minutes, 0) > 0
        THEN GREATEST(1, CEIL(ts.handling_time_minutes::numeric
                              * o.quantity::numeric / 480.0)::integer)
      ELSE 0
    END AS lead_time_mesa_dias,

    -- Acabamento
    CASE
      WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                      dlt.finishing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
    END AS lead_time_acabamento_dias,

    COALESCE(ts.lead_time_buffer_material_dias,
             dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias

  FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE o.status <> ALL (ARRAY['Pronto', 'FINALIZADO', 'Cancelado'])
    AND so.delivery_deadline IS NOT NULL
)
SELECT
  lt.order_id,
  lt.pedido_ref,
  lt.sale_order_id,
  lt.data_entrega_cliente,
  lt.op_quantity,
  lt.order_status,
  lt.reference_id,
  lt.referencia_nome,
  lt.lead_time_corte_dias,
  lt.lead_time_costura_dias,
  lt.lead_time_montagem_dias,
  lt.lead_time_mesa_dias,
  lt.lead_time_acabamento_dias,
  lt.lead_time_buffer_material_dias,

  -- Cascade: entrega → acabamento → mesa → montagem → costura → corte
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    AS data_inicio_acabamento,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias
    AS data_inicio_mesa,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    AS data_inicio_montagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias
    AS data_inicio_costura,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
    AS data_inicio_corte,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
    - lt.lead_time_buffer_material_dias
    AS data_chegada_material,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
    - lt.lead_time_buffer_material_dias
    - COALESCE(m.supplier_lead_time_days, 7)
    AS data_limite_compra,

  -- Material columns (unchanged)
  m.id              AS material_id,
  m.name            AS material,
  m.group_id        AS material_group_id,
  pg.name           AS grupo_material,
  m.unit            AS unidade,
  m.quantity        AS estoque_atual,
  m.min_stock,
  m.supplier_lead_time_days,
  m.supplier_id,
  sup.name          AS supplier_name,
  COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric
    AS quantidade_necessaria

FROM lt
  JOIN public.sheet_materials sm ON sm.sheet_id = lt.sheet_id
  JOIN public.products m ON m.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = m.group_id
  LEFT JOIN public.suppliers sup ON sup.id = m.supplier_id;

-- ── 2. Update planned_start trigger to include Mesa ───────────────────────────
CREATE OR REPLACE FUNCTION public.compute_order_planned_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery   date;
  v_corte      int;
  v_costura    int;
  v_montagem   int;
  v_mesa       int;
  v_acabamento int;
BEGIN
  IF NEW.sale_order_id IS NULL OR NEW.reference_id IS NULL OR NEW.quantity IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT so.delivery_deadline INTO v_delivery
  FROM public.sale_orders so WHERE so.id = NEW.sale_order_id;
  IF v_delivery IS NULL THEN RETURN NEW; END IF;

  SELECT
    -- Corte
    CASE WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                       dlt.cutting_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2) END,
    -- Costura
    CASE WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                       dlt.sewing_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3) END,
    -- Montagem
    CASE WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                       dlt.assembly_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2) END,
    -- Mesa
    CASE WHEN ts.has_straps = true AND COALESCE(ts.handling_time_minutes, 0) > 0
         THEN GREATEST(1, CEIL(ts.handling_time_minutes::numeric
                               * NEW.quantity::numeric / 480.0)::int)
         ELSE 0 END,
    -- Acabamento
    CASE WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                       dlt.finishing_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1) END
  INTO v_corte, v_costura, v_montagem, v_mesa, v_acabamento
  FROM public.technical_sheets ts
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE ts.id = NEW.reference_id;

  IF v_corte IS NULL THEN RETURN NEW; END IF;

  NEW.planned_start := v_delivery
    - v_acabamento - v_mesa - v_montagem - v_costura - v_corte;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_order_planned_dates ON public.orders;
CREATE TRIGGER trg_compute_order_planned_dates
BEFORE INSERT OR UPDATE OF quantity, sale_order_id, reference_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.compute_order_planned_dates();


-- === 20260428150000_block-rascunho-wave-assignment.sql ===
-- Prevent "Rascunho" (draft) sale orders from being assigned to a production wave.
-- A PV in Rascunho status has not been approved yet and should not enter production.

CREATE OR REPLACE FUNCTION trg_fn_block_rascunho_wave_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_order_number TEXT;
BEGIN
  SELECT status, order_number
    INTO v_status, v_order_number
    FROM sale_orders
   WHERE id = NEW.sale_order_id;

  IF v_status = 'Rascunho' THEN
    RAISE EXCEPTION
      'O pedido % (%) está em Rascunho e não pode ser atribuído a uma onda de produção. Aprove o pedido antes de incluí-lo.',
      COALESCE(v_order_number, NEW.sale_order_id::text),
      v_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_rascunho_wave_assignment ON production_wave_item_sources;

CREATE TRIGGER trg_block_rascunho_wave_assignment
  BEFORE INSERT ON production_wave_item_sources
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_block_rascunho_wave_assignment();


-- === 20260428160000_fix-oc-00127-dedup.sql ===
-- Fix OC-2026-00127: remove duplicate purchase_order_items caused by the
-- generateAutoPurchaseOrders bug (items were appended without dedup check).
-- Keeps the entry with the highest quantity per product_id, recalculates total_value.

DO $$
DECLARE
  v_po_id uuid;
  v_total  numeric;
BEGIN
  SELECT id INTO v_po_id
    FROM purchase_orders
   WHERE order_number = 'OC-2026-00127';

  IF v_po_id IS NULL THEN
    RAISE NOTICE 'OC-2026-00127 não encontrada — nada a fazer.';
    RETURN;
  END IF;

  -- Remove duplicates: for each product_id keep the row with the highest quantity
  -- (= the most recent / largest deficit). Ties broken by latest created_at.
  DELETE FROM purchase_order_items
   WHERE purchase_order_id = v_po_id
     AND id NOT IN (
           SELECT DISTINCT ON (product_id) id
             FROM purchase_order_items
            WHERE purchase_order_id = v_po_id
            ORDER BY product_id, quantity DESC, created_at DESC
         );

  -- Recalculate total_value from the remaining (deduplicated) items
  SELECT COALESCE(SUM(quantity * unit_price), 0)
    INTO v_total
    FROM purchase_order_items
   WHERE purchase_order_id = v_po_id;

  UPDATE purchase_orders
     SET total_value = v_total
   WHERE id = v_po_id;

  RAISE NOTICE 'OC-2026-00127 corrigida — duplicatas removidas, total atualizado para R$ %', v_total;
END;
$$;


-- === 20260428170000_fix-artisanal-stock-inconsistencies.sql ===
-- Detect and fix artisanal service orders where the artisanal output was added to
-- stock but the base material was NOT debited (bug: old code showed warning and
-- continued instead of stopping when base product was not found).
--
-- For each inconsistency found:
--   • If base product exists with sufficient stock → debit it now and log movement.
--   • If not found or insufficient stock → RAISE NOTICE for manual review.

DO $$
DECLARE
  rec             record;
  v_base_prod_id  uuid;
  v_base_qty      numeric;
  v_base_needed   numeric;
  v_new_qty       numeric;
  v_fixed         int := 0;
  v_needs_review  int := 0;
BEGIN
  FOR rec IN
    SELECT
      so.id                                                          AS os_id,
      so.order_number                                                AS os_number,
      so.artisanal_output_meters                                     AS output_meters,
      COALESCE(so.artisanal_base_color, so.artisanal_output_color, '') AS base_color,
      ar.base_product_name,
      ar.yield_per_meter,
      so.artisanal_output_meters / NULLIF(ar.yield_per_meter, 0)    AS base_needed
    FROM service_orders so
    JOIN artisanal_recipes ar ON ar.id = so.artisanal_recipe_id
    WHERE so.status             = 'Concluído'
      AND so.artisanal_stock_entry_done = true
      AND so.artisanal_recipe_id IS NOT NULL
      AND so.artisanal_output_meters > 0
      -- Output 'in' movement exists for this OS
      AND EXISTS (
            SELECT 1 FROM stock_movements sm
             WHERE sm.movement_type = 'in'
               AND sm.description   ILIKE '%' || so.order_number || '%'
               AND sm.description   ILIKE '%artesanal%'
          )
      -- Base 'out' movement is MISSING for this OS
      AND NOT EXISTS (
            SELECT 1 FROM stock_movements sm
             WHERE sm.movement_type = 'out'
               AND sm.description   ILIKE '%' || so.order_number || '%'
               AND (sm.description  ILIKE '%artesanal%' OR sm.description ILIKE '%Consumo artesanal%')
          )
  LOOP
    v_base_needed := rec.base_needed;

    -- Try to find the base product by name + color
    SELECT p.id, p.quantity
      INTO v_base_prod_id, v_base_qty
      FROM products p
     WHERE (lower(p.name) = lower(rec.base_product_name)
            OR lower(p.name) LIKE lower(rec.base_product_name) || ':%'
            OR lower(p.name) LIKE lower(rec.base_product_name) || ' -%')
       AND (rec.base_color = ''
            OR lower(COALESCE(p.color, '')) = lower(rec.base_color))
     ORDER BY p.updated_at DESC
     LIMIT 1;

    IF v_base_prod_id IS NULL THEN
      RAISE NOTICE '[REVISAR] OS % — base "%" (%) não encontrada no estoque. Débito de %.2fm pendente.',
        rec.os_number, rec.base_product_name, rec.base_color, v_base_needed;
      v_needs_review := v_needs_review + 1;
      CONTINUE;
    END IF;

    IF v_base_qty < v_base_needed THEN
      RAISE NOTICE '[REVISAR] OS % — base "%" (%) com estoque insuficiente: disponível %, necessário %. Débito pendente.',
        rec.os_number, rec.base_product_name, rec.base_color, v_base_qty, v_base_needed;
      v_needs_review := v_needs_review + 1;
      CONTINUE;
    END IF;

    -- Debit base material
    v_new_qty := v_base_qty - v_base_needed;

    UPDATE products
       SET quantity   = v_new_qty,
           updated_at = now()
     WHERE id = v_base_prod_id;

    INSERT INTO stock_movements
      (product_id, movement_type, quantity, previous_stock, new_stock, description)
    VALUES
      (v_base_prod_id, 'out', v_base_needed, v_base_qty, v_new_qty,
       'Débito retroativo MP artesanal — ' || rec.os_number || ' (correção automática)');

    RAISE NOTICE '[CORRIGIDO] OS % — debitado %.2fm de "%" (%). Estoque: % → %.',
      rec.os_number, v_base_needed, rec.base_product_name, rec.base_color, v_base_qty, v_new_qty;

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=== Resumo: % OS(s) corrigida(s), % OS(s) aguardam revisão manual. ===', v_fixed, v_needs_review;
END;
$$;


-- === 20260428180000_nfe-companies-multicompany.sql ===
-- Multi-company NF-e support
-- Creates 'companies' table for multiple CNPJs and links nfe_emitidas to a company.

CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj text NOT NULL,
  inscricao_estadual text NOT NULL DEFAULT '',
  razao_social text NOT NULL,
  nome_fantasia text NOT NULL DEFAULT '',
  logradouro text NOT NULL DEFAULT '',
  numero text NOT NULL DEFAULT '',
  complemento text NOT NULL DEFAULT '',
  bairro text NOT NULL DEFAULT '',
  cidade text NOT NULL DEFAULT '',
  uf text NOT NULL DEFAULT '',
  cep text NOT NULL DEFAULT '',
  codigo_municipio text NOT NULL DEFAULT '',
  regime_tributario text NOT NULL DEFAULT '1',
  serie_nfe integer NOT NULL DEFAULT 1,
  ambiente text NOT NULL DEFAULT 'homologacao',
  certificate_path text DEFAULT '',
  natureza_operacao text NOT NULL DEFAULT 'Venda de Mercadoria',
  cfop text NOT NULL DEFAULT '5102',
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can manage companies" ON public.companies
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add company link to nfe_emitidas (nullable for backwards compat with fiscal_config flow)
ALTER TABLE public.nfe_emitidas
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cnpj_emitente text DEFAULT '';

-- Add cancel support fields
ALTER TABLE public.nfe_emitidas
  ADD COLUMN IF NOT EXISTS justificativa_cancelamento text DEFAULT '',
  ADD COLUMN IF NOT EXISTS data_cancelamento timestamptz;

-- Trigger to keep updated_at fresh on companies
CREATE OR REPLACE FUNCTION public.set_companies_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_companies_updated_at();


-- === 20260428190000_wave-material-intelligence.sql ===
-- Wave Material Intelligence
-- Adds timeline back-calculation and material shortage detection to production waves.
--
-- New columns on production_waves:
--   earliest_deadline, corte_start_date, costura_start_date,
--   purchase_deadline, material_ready_date
--
-- New RPC functions:
--   compute_wave_timeline(sale_order_ids[])   → returns stage dates
--   get_wave_material_needs(sale_order_ids[]) → returns material shortages + artisanal info
--   update_wave_timeline(wave_id)             → computes & persists timeline for an existing wave

-- ── 1. Timeline columns ────────────────────────────────────────────────────────
ALTER TABLE public.production_waves
  ADD COLUMN IF NOT EXISTS earliest_deadline   date,
  ADD COLUMN IF NOT EXISTS corte_start_date    date,
  ADD COLUMN IF NOT EXISTS costura_start_date  date,
  ADD COLUMN IF NOT EXISTS purchase_deadline   date,
  ADD COLUMN IF NOT EXISTS material_ready_date date;

-- ── 2. compute_wave_timeline ───────────────────────────────────────────────────
-- Back-calculates stage start dates from the earliest delivery_deadline among the
-- given sale orders. Uses MAX lead-time values from technical_sheets (conservative).
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline    date,
  corte_start_date     date,
  costura_start_date   date,
  montagem_start_date  date,
  acabamento_start_date date,
  material_ready_date  date,
  purchase_deadline    date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int;
  v_lead_costura  int;
  v_lead_montagem int;
  v_lead_acab     int;
  v_lead_buffer   int;
  v_lead_supplier int;
  v_deadline      date;
BEGIN
  -- Earliest delivery deadline from sale orders
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN
    RETURN; -- no deadlines → no timeline
  END IF;

  -- Worst-case (MAX) lead times from technical sheets in these orders
  SELECT
    COALESCE(MAX(ts.lead_time_corte_dias),           2),
    COALESCE(MAX(ts.lead_time_costura_dias),         3),
    COALESCE(MAX(ts.lead_time_montagem_dias),        2),
    COALESCE(MAX(ts.lead_time_acabamento_dias),      1),
    COALESCE(MAX(ts.lead_time_buffer_material_dias), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- Max supplier lead time across all materials needed
  SELECT COALESCE(MAX(COALESCE(p.supplier_lead_time_days, 7)), 7)
    INTO v_lead_supplier
    FROM sale_order_items soi
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    JOIN products p ON p.id = sm.product_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  RETURN QUERY SELECT
    v_deadline AS earliest_deadline,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte)::date        AS corte_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura)::date                        AS costura_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem)::date         AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                  AS acabamento_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer)::date                         AS material_ready_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer - v_lead_supplier)::date        AS purchase_deadline;
END;
$$;

-- ── 3. get_wave_material_needs ─────────────────────────────────────────────────
-- Returns one row per (material, color) combination needed by the given sale orders.
-- For artisanal materials: also returns base-material requirements and OS send date.
CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
RETURNS TABLE (
  product_id              uuid,
  product_name            text,
  unit                    text,
  color                   text,
  needed_qty              numeric,
  stock_qty               numeric,
  shortage                numeric,
  supplier_id             uuid,
  supplier_name           text,
  supplier_lead_time_days int,
  is_artisanal            boolean,
  artisanal_recipe_id     uuid,
  artisanal_recipe_name   text,
  base_product_id         uuid,
  base_product_name       text,
  base_needed_qty         numeric,
  base_stock_qty          numeric,
  base_shortage           numeric,
  os_send_date            date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_corte_start date;
BEGIN
  -- Compute corte start date for OS timing calculation (OS must arrive before corte)
  SELECT t.corte_start_date INTO v_corte_start
    FROM compute_wave_timeline(p_sale_order_ids) t
   LIMIT 1;

  RETURN QUERY
  WITH
  -- ── Aggregate material needs from sale order items ────────────────────────
  needed AS (
    SELECT
      sm.product_id,
      -- Use sheet_material color if set, otherwise use sale_order_item color
      COALESCE(NULLIF(sm.color, ''), soi.color, '') AS effective_color,
      SUM(sm.quantity_per_unit * soi.quantity)       AS needed_qty
    FROM sale_order_items soi
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    GROUP BY sm.product_id, COALESCE(NULLIF(sm.color, ''), soi.color, '')
  ),
  -- ── Enrich with product + supplier info ───────────────────────────────────
  enriched AS (
    SELECT
      n.product_id,
      p.name                                              AS product_name,
      COALESCE(p.unit, 'un')                              AS unit,
      n.effective_color                                   AS color,
      n.needed_qty,
      p.quantity                                          AS stock_qty,
      GREATEST(0, n.needed_qty - p.quantity)              AS shortage,
      p.supplier_id,
      sup.name                                            AS supplier_name,
      COALESCE(p.supplier_lead_time_days, 7)::int         AS supplier_lead_time_days,
      COALESCE(p.is_artisanal, false)                     AS is_artisanal
    FROM needed n
    JOIN products p ON p.id = n.product_id
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
  )
  SELECT
    e.product_id,
    e.product_name,
    e.unit,
    e.color,
    e.needed_qty,
    e.stock_qty,
    e.shortage,
    e.supplier_id,
    e.supplier_name,
    e.supplier_lead_time_days,
    e.is_artisanal,
    -- Artisanal recipe (matched by artisanal_product_name like product name)
    ar.id                                                 AS artisanal_recipe_id,
    ar.name                                               AS artisanal_recipe_name,
    -- Base product: find by base_product_name + color match
    bp.id                                                 AS base_product_id,
    ar.base_product_name,
    CASE
      WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0
      THEN ROUND(e.needed_qty / ar.yield_per_meter, 3)
      ELSE NULL
    END                                                   AS base_needed_qty,
    bp.quantity                                           AS base_stock_qty,
    CASE
      WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL
      THEN GREATEST(0, ROUND(e.needed_qty / NULLIF(ar.yield_per_meter, 0), 3) - bp.quantity)
      ELSE NULL
    END                                                   AS base_shortage,
    -- OS must be sent at least 7 working days before corte
    CASE
      WHEN e.is_artisanal AND v_corte_start IS NOT NULL
      THEN (v_corte_start - 7)::date
      ELSE NULL
    END                                                   AS os_send_date
  FROM enriched e
  LEFT JOIN artisanal_recipes ar
         ON e.is_artisanal = true
        AND ar.active = true
        AND (
              lower(e.product_name) LIKE '%' || lower(ar.artisanal_product_name) || '%'
           OR lower(ar.artisanal_product_name) LIKE '%' || lower(e.product_name) || '%'
            )
  LEFT JOIN products bp
         ON ar.id IS NOT NULL
        AND (
              lower(bp.name) = lower(ar.base_product_name)
           OR lower(bp.name) LIKE lower(ar.base_product_name) || ':%'
           OR lower(bp.name) LIKE lower(ar.base_product_name) || ' -%'
            )
        AND (
              e.color = ''
           OR lower(COALESCE(bp.color, '')) = lower(e.color)
           OR bp.color IS NULL
           OR bp.color = ''
            )
  ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$$;

-- ── 4. update_wave_timeline ────────────────────────────────────────────────────
-- Computes and persists timeline columns for an already-created wave.
-- Called by the application after wave creation.
CREATE OR REPLACE FUNCTION public.update_wave_timeline(p_wave_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_order_ids uuid[];
  v_tl        record;
BEGIN
  SELECT array_agg(DISTINCT wis.sale_order_id)
    INTO v_order_ids
    FROM production_wave_item_sources wis
    JOIN production_wave_items wi ON wi.id = wis.wave_item_id
   WHERE wi.wave_id = p_wave_id
     AND wis.sale_order_id IS NOT NULL;

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_tl
    FROM compute_wave_timeline(v_order_ids)
   LIMIT 1;

  UPDATE public.production_waves
     SET earliest_deadline   = v_tl.earliest_deadline,
         corte_start_date    = v_tl.corte_start_date,
         costura_start_date  = v_tl.costura_start_date,
         purchase_deadline   = v_tl.purchase_deadline,
         material_ready_date = v_tl.material_ready_date,
         updated_at          = now()
   WHERE id = p_wave_id;
END;
$$;


-- === 20260430120000_import-time-records-safe-rpc.sql ===
-- RPC that inserts time records using ON CONFLICT DO NOTHING at the DB level.
-- This is the only 100% reliable way to skip already-imported days without
-- triggering the unique constraint, regardless of how many rows exist in the DB.
CREATE OR REPLACE FUNCTION import_time_records_safe(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec        jsonb;
  ins_count  integer := 0;
  skp_count  integer := 0;
BEGIN
  FOR rec IN SELECT value FROM jsonb_array_elements(records)
  LOOP
    INSERT INTO time_records (
      employee_name,
      employee_external_id,
      department,
      record_date,
      punches,
      import_batch
    ) VALUES (
      rec->>'employee_name',
      rec->>'employee_external_id',
      rec->>'department',
      (rec->>'record_date')::date,
      ARRAY(SELECT jsonb_array_elements_text(rec->'punches')),
      rec->>'import_batch'
    )
    ON CONFLICT (employee_name, record_date) DO NOTHING;

    IF FOUND THEN
      ins_count := ins_count + 1;
    ELSE
      skp_count := skp_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', ins_count, 'skipped', skp_count);
END;
$$;

-- Grant to authenticated role so the Supabase client can call it
GRANT EXECUTE ON FUNCTION import_time_records_safe(jsonb) TO authenticated;


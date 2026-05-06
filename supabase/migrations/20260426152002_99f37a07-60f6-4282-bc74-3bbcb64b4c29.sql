-- ----------------------------------------------------------------
-- 20260426120000_consumption-per-size-as-primary-source.sql
-- ----------------------------------------------------------------
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

  v_upper_consumption  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_effective_size::text))::numeric, 0), 0);
  v_lining_consumption := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);
  v_insole_consumption := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);

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

  v_upper_consumption  := COALESCE(v_upper_consumption,  v_sheet.upper_consumption,  0);
  v_lining_consumption := COALESCE(v_lining_consumption, v_sheet.lining_consumption, 0);
  v_insole_consumption := COALESCE(v_insole_consumption, v_sheet.insole_consumption, 0);

  IF v_sole_product_id IS NOT NULL THEN
    v_required := p_order_quantity;
    SELECT p.name, p.quantity INTO v_row FROM products p WHERE p.id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_row.name,
      'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_required,
      'available', v_row.quantity, 'stock_ok', v_row.quantity >= v_required,
      'debit_mode', 'hard', 'source', 'primary_sole'
    );
    v_covered_categories := array_append(v_covered_categories, 'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

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
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'cabedal');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND v_lining_consumption > 0 THEN
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
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'forro');
      v_covered_categories := array_append(v_covered_categories, 'forração');
      v_covered_categories := array_append(v_covered_categories, 'forracao');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> ''
     AND v_insole_consumption > 0 THEN
    v_required := v_insole_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Palmilha', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
        'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'palmilha');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

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
              'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category, '')) IN
                ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
                ELSE 'soft' END,
              'source', 'direct_components'
            );
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

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
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color, 'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category, '')) IN
        ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
        ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category
    );
  END LOOP;

  RETURN v_result;
END;
$function$;

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
    v_upper  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_size::text))::numeric, 0), 0);
    v_lining := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_insole := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_size::text))::numeric, 0), 0);

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

  IF v_sole_product_id IS NOT NULL THEN
    SELECT name, quantity INTO v_acc_name, v_acc_avail FROM products WHERE id = v_sole_product_id;
    v_result := v_result || jsonb_build_object('component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_acc_name, 'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_total_qty, 'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_total_qty, 'debit_mode', 'hard', 'source', 'primary_sole');
    v_covered_categories := array_append(v_covered_categories, 'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  IF v_upper_pid IS NOT NULL AND COALESCE((v_acc_upper->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_upper_pid);
    v_required := ((v_acc_upper->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Cabedal', 'product_id', v_upper_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

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

  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_insole_pid);
    v_required := ((v_acc_insole->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Palmilha', 'product_id', v_insole_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_acc_std) LOOP
    v_acc_required := (v_acc_std #>> ARRAY[v_key,'required'])::numeric;
    SELECT name, quantity, category INTO v_acc_name, v_acc_avail, v_row_cat_norm
      FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('component', 'Item padrão (solado)', 'product_id', v_key::uuid, 'product_name', v_acc_name, 'color', '', 'consumption_per_unit', ROUND(v_acc_required / NULLIF(v_total_qty, 0), 4), 'required', v_acc_required, 'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_acc_required, 'debit_mode', CASE WHEN LOWER(COALESCE(v_row_cat_norm, '')) IN ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard' ELSE 'soft' END, 'source', 'sole_standard_per_size', 'unit', (v_acc_std #>> ARRAY[v_key,'unit']));
      v_covered_product_ids := array_append(v_covered_product_ids, v_key::uuid);
    END IF;
  END LOOP;

  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * v_total_qty;
        IF v_required > 0 THEN
          SELECT name, quantity, category INTO v_row FROM products WHERE id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto', 'product_id', v_pid, 'product_name', v_row.name,
              'consumption_per_unit', (v_item ->> 'quantity')::numeric, 'required', v_required,
              'available', v_row.quantity, 'stock_ok', v_row.quantity >= v_required,
              'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category, '')) IN
                ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
                ELSE 'soft' END,
              'source', 'direct_components'
            );
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

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
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color, 'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category, '')) IN
        ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
        ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category
    );
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  RETURN v_result;
END;
$function$;

-- ----------------------------------------------------------------
-- 20260426130000_sole-size-conjugations.sql
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sole_size_conjugations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sole_group_id uuid NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
  size_key text NOT NULL,
  sizes integer[] NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(sole_group_id, size_key)
);

ALTER TABLE public.sole_size_conjugations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view sole size conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Authenticated users can view sole size conjugations"
  ON public.sole_size_conjugations FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage sole size conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Authenticated users can manage sole size conjugations"
  ON public.sole_size_conjugations FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

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

CREATE OR REPLACE FUNCTION public.get_sole_group_id_for_product(p_product_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT group_id FROM public.products WHERE id = p_product_id LIMIT 1;
$$;

-- ----------------------------------------------------------------
-- 20260426140000_fix-conjugation-debit-legacy-fallback.sql
-- ----------------------------------------------------------------
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

    IF v_conj_key IS NOT NULL AND (v_stock_grade ->> v_conj_key) IS NOT NULL THEN
      v_existing_qty := COALESCE((v_conj_grade ->> v_conj_key)::numeric, 0);
      v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
    ELSE
      v_existing_qty := COALESCE((v_conj_grade ->> v_size)::numeric, 0);
      v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_size], to_jsonb(v_existing_qty + v_size_qty));
    END IF;
  END LOOP;

  v_new_grade := v_stock_grade;
  v_prev_total := 0;
  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade) LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

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
      target_product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
      'Debito Solado por grade (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor do produto: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;
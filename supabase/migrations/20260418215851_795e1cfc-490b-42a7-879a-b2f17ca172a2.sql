DROP FUNCTION IF EXISTS public.calculate_order_consumption(p_reference_id uuid, p_order_quantity numeric, p_color text, p_size integer) CASCADE;
CREATE OR REPLACE FUNCTION public.calculate_order_consumption(p_reference_id uuid, p_order_quantity numeric, p_color text, p_size integer DEFAULT NULL::integer)
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
BEGIN
  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  v_effective_size := COALESCE(p_size, v_sheet.reference_size, 37);

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  v_upper_consumption  := COALESCE(v_sheet.upper_consumption, 0);
  v_lining_consumption := COALESCE(v_sheet.lining_consumption, 0);
  v_insole_consumption := COALESCE(v_sheet.insole_consumption, 0);

  IF v_sheet.sole_drives_consumption AND v_sole_product_id IS NOT NULL THEN
    SELECT * INTO v_spec FROM sole_technical_specs
    WHERE sole_id = v_sole_product_id AND size = v_effective_size;

    IF FOUND THEN
      IF v_spec.upper_consumption_dm2 IS NOT NULL AND v_spec.upper_consumption_dm2 > 0 THEN
        v_upper_consumption := v_spec.upper_consumption_dm2;
      END IF;
      IF v_spec.lining_consumption_dm2 IS NOT NULL AND v_spec.lining_consumption_dm2 > 0 THEN
        v_lining_consumption := v_spec.lining_consumption_dm2;
      END IF;
      IF v_spec.insole_consumption_dm2 IS NOT NULL AND v_spec.insole_consumption_dm2 > 0 THEN
        v_insole_consumption := v_spec.insole_consumption_dm2;
      END IF;
    END IF;
  END IF;

  -- Solado (always primary)
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

  -- Cabedal (modern spec) — mark category covered to skip legacy duplicates
  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> ''
     AND v_upper_consumption > 0 THEN
    v_required := v_upper_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'component', 'Cabedal',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', v_upper_consumption,
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', CASE WHEN v_sheet.sole_drives_consumption THEN 'sole_spec' ELSE 'sheet' END,
        'matched_by', v_resolved.matched_by
      );
      v_covered_categories := array_append(v_covered_categories, 'cabedal');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Forração (modern spec)
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND v_lining_consumption > 0 THEN
    v_required := v_lining_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'component', 'Forro',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', v_lining_consumption,
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', CASE WHEN v_sheet.sole_drives_consumption THEN 'sole_spec' ELSE 'sheet' END,
        'matched_by', v_resolved.matched_by
      );
      v_covered_categories := array_append(v_covered_categories, 'forro');
      v_covered_categories := array_append(v_covered_categories, 'forração');
      v_covered_categories := array_append(v_covered_categories, 'forracao');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Forros alternativos (lining_accessories)
  IF v_sheet.lining_accessories IS NOT NULL AND jsonb_typeof(v_sheet.lining_accessories) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sheet.lining_accessories) AS value LOOP
      v_group_name  := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
      v_required := v_consumption * p_order_quantity;
      SELECT * INTO v_resolved FROM resolve_material_product(v_group_name, p_color, v_required, false);
      IF v_resolved.product_id IS NOT NULL THEN
        v_result := v_result || jsonb_build_object(
          'component', 'Forro (alternativa)',
          'product_id', v_resolved.product_id,
          'product_name', v_resolved.product_name,
          'color', p_color,
          'consumption_per_unit', v_consumption,
          'required', v_required,
          'available', v_resolved.available_qty,
          'stock_ok', v_resolved.available_qty >= v_required,
          'debit_mode', 'soft',
          'source', 'lining_accessory',
          'matched_by', v_resolved.matched_by
        );
        v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
      END IF;
    END LOOP;
  END IF;

  -- Palmilha (modern spec)
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> ''
     AND v_insole_consumption > 0 THEN
    v_required := v_insole_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'component', 'Palmilha',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', v_insole_consumption,
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', CASE WHEN v_sheet.sole_drives_consumption THEN 'sole_spec' ELSE 'sheet' END,
        'matched_by', v_resolved.matched_by
      );
      v_covered_categories := array_append(v_covered_categories, 'palmilha');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- BOM legado (sheet_materials) — DE-DUPLICATE: skip if category or product already covered above
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color, p.group_id
    FROM sheet_materials sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));

    -- Skip if this product was already added by modern specs
    IF v_row.product_id = ANY(v_covered_product_ids) THEN
      CONTINUE;
    END IF;

    -- Skip if its category is already handled by Especificações
    IF v_row_cat_norm = ANY(v_covered_categories) THEN
      CONTINUE;
    END IF;

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
          ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado') THEN 'hard'
        ELSE 'soft'
      END,
      'source', 'sheet_materials',
      'category', v_row.category
    );
  END LOOP;

  -- Componentes diretos (direct_components)
  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sheet.direct_components) AS value LOOP
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, (v_item ->> 'quantity')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;
      v_required := v_consumption * p_order_quantity;

      DECLARE v_pid uuid := NULL;
      BEGIN
        BEGIN
          v_pid := COALESCE((v_item ->> 'product_id')::uuid, (v_item ->> 'id')::uuid);
        EXCEPTION WHEN OTHERS THEN v_pid := NULL; END;

        IF v_pid IS NOT NULL THEN
          -- Skip if already covered
          IF v_pid = ANY(v_covered_product_ids) THEN
            CONTINUE;
          END IF;

          SELECT p.id, p.name, p.quantity, p.color
            INTO v_row
            FROM products p WHERE p.id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', COALESCE(v_item ->> 'component', 'Componente direto'),
              'product_id', v_pid,
              'product_name', v_row.name,
              'color', v_row.color,
              'consumption_per_unit', v_consumption,
              'required', v_required,
              'available', v_row.quantity,
              'stock_ok', v_row.quantity >= v_required,
              'debit_mode', 'soft',
              'source', 'direct_component'
            );
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END;
    END LOOP;
  END IF;

  RETURN v_result;
END;
$function$;
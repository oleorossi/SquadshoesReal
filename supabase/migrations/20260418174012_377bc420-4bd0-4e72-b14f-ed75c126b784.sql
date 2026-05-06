CREATE OR REPLACE FUNCTION public.resolve_sole_color(
  p_sheet_id uuid,
  p_product_color text
) RETURNS TABLE (
  sole_product_id uuid,
  sole_color text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_primary_sole_id uuid;
BEGIN
  RETURN QUERY
  SELECT p.id, p.color
  FROM technical_sheet_sole_colors tsc
  JOIN products p ON p.group_id = tsc.sole_group_id AND p.active = true
  WHERE tsc.sheet_id = p_sheet_id
    AND LOWER(tsc.product_color) = LOWER(p_product_color)
  ORDER BY p.quantity DESC
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  SELECT ts.primary_sole_id INTO v_primary_sole_id
  FROM technical_sheets ts WHERE ts.id = p_sheet_id;

  IF v_primary_sole_id IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.color
    FROM products p WHERE p.id = v_primary_sole_id AND p.active = true;
    IF FOUND THEN RETURN; END IF;
  END IF;

  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_order_consumption(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_size integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  END IF;

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
    END IF;
  END IF;

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
    END IF;
  END IF;

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
      END IF;
    END LOOP;
  END IF;

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
    END IF;
  END IF;

  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color, p.group_id
    FROM sheet_materials sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
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
          SELECT p.id, p.name, p.quantity, p.color
            INTO v_resolved.product_id, v_resolved.product_name, v_resolved.available_qty, v_sole_color
          FROM products p WHERE p.id = v_pid AND p.active = true;
        ELSE
          v_group_name := v_item ->> 'material';
          IF v_group_name IS NULL OR v_group_name = '' THEN CONTINUE; END IF;
          SELECT * INTO v_resolved FROM resolve_material_product(v_group_name, p_color, v_required, false);
        END IF;

        IF v_resolved.product_id IS NOT NULL THEN
          v_result := v_result || jsonb_build_object(
            'component', 'Componente direto',
            'product_id', v_resolved.product_id,
            'product_name', v_resolved.product_name,
            'consumption_per_unit', v_consumption,
            'required', v_required,
            'available', v_resolved.available_qty,
            'stock_ok', v_resolved.available_qty >= v_required,
            'debit_mode', 'hard',
            'source', 'direct_components'
          );
        END IF;
      END;
    END LOOP;
  END IF;

  IF v_sheet.components_accessories IS NOT NULL AND jsonb_typeof(v_sheet.components_accessories) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sheet.components_accessories) AS value LOOP
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, (v_item ->> 'quantity')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;
      v_required := v_consumption * p_order_quantity;

      DECLARE v_pid uuid := NULL;
      BEGIN
        BEGIN
          v_pid := COALESCE((v_item ->> 'product_id')::uuid, (v_item ->> 'id')::uuid);
        EXCEPTION WHEN OTHERS THEN v_pid := NULL; END;

        IF v_pid IS NOT NULL THEN
          SELECT p.id, p.name, p.quantity
            INTO v_resolved.product_id, v_resolved.product_name, v_resolved.available_qty
          FROM products p WHERE p.id = v_pid AND p.active = true;
        ELSE
          v_group_name := v_item ->> 'material';
          IF v_group_name IS NULL OR v_group_name = '' THEN CONTINUE; END IF;
          SELECT * INTO v_resolved FROM resolve_material_product(v_group_name, p_color, v_required, false);
        END IF;

        IF v_resolved.product_id IS NOT NULL THEN
          v_result := v_result || jsonb_build_object(
            'component', 'Acessório',
            'product_id', v_resolved.product_id,
            'product_name', v_resolved.product_name,
            'consumption_per_unit', v_consumption,
            'required', v_required,
            'available', v_resolved.available_qty,
            'stock_ok', v_resolved.available_qty >= v_required,
            'debit_mode', 'hard',
            'source', 'components_accessories'
          );
        END IF;
      END;
    END LOOP;
  END IF;

  RETURN v_result;
END;
$$;
-- ============================================================
-- Per-size consumption engine (exatidão por numeração)
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(
  p_reference_id uuid,
  p_grade jsonb,
  p_color text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  v_consumption numeric;
  v_required numeric;
  v_group_name text;
  v_covered_categories text[] := ARRAY[]::text[];
  v_covered_product_ids uuid[] := ARRAY[]::uuid[];
  v_row_cat_norm text;
  -- per-product accumulators
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
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' THEN
    RAISE EXCEPTION 'Grade inválida (precisa ser JSON object {size: pairs})';
  END IF;

  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  -- total qty
  SELECT COALESCE(SUM((value)::numeric), 0) INTO v_total_qty
  FROM jsonb_each_text(p_grade)
  WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0;

  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Grade vazia (sem pares)';
  END IF;

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  -- Resolve material products once (Cabedal / Forro / Palmilha)
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

  -- ========== ITERAÇÃO POR NUMERAÇÃO ==========
  FOR v_size, v_pairs IN
    SELECT key::integer, value::numeric
      FROM jsonb_each_text(p_grade)
     WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0
  LOOP
    -- defaults from sheet
    v_upper  := COALESCE(v_sheet.upper_consumption, 0);
    v_lining := COALESCE(v_sheet.lining_consumption, 0);
    v_insole := COALESCE(v_sheet.insole_consumption, 0);

    -- per-size sole_technical_specs override
    IF v_sheet.sole_drives_consumption AND v_sole_product_id IS NOT NULL THEN
      SELECT * INTO v_spec FROM sole_technical_specs
       WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF COALESCE(v_spec.upper_consumption_dm2, 0) > 0 THEN
          v_upper := v_spec.upper_consumption_dm2;
        END IF;
        IF COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN
          v_lining := v_spec.lining_consumption_dm2;
        END IF;
        IF COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN
          v_insole := v_spec.insole_consumption_dm2;
        END IF;
      END IF;
    END IF;

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

    -- ===== STANDARD ITEMS DO SOLADO (per size) =====
    IF v_sole_product_id IS NOT NULL THEN
      FOR v_std_item IN
        SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit
          FROM sole_standard_items_consumption ssic
         WHERE ssic.sole_product_id = v_sole_product_id
           AND ssic.size = v_size
           AND ssic.consumption > 0
      LOOP
        v_key := v_std_item.pid::text;
        v_acc_required := COALESCE((v_acc_std #>> ARRAY[v_key,'required'])::numeric, 0)
                         + v_std_item.cons * v_pairs;
        v_acc_std := jsonb_set(
          v_acc_std,
          ARRAY[v_key],
          jsonb_build_object(
            'required', v_acc_required,
            'unit', v_std_item.unit
          )
        );
      END LOOP;
    END IF;
  END LOOP;

  -- ========== EMIT SOLADO ==========
  IF v_sole_product_id IS NOT NULL THEN
    SELECT name, quantity INTO v_acc_name, v_acc_avail FROM products WHERE id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado',
      'product_id', v_sole_product_id,
      'product_name', v_acc_name,
      'color', v_sole_color,
      'consumption_per_unit', 1,
      'required', v_total_qty,
      'available', v_acc_avail,
      'stock_ok', v_acc_avail >= v_total_qty,
      'debit_mode', 'hard',
      'source', 'primary_sole'
    );
    v_covered_categories := array_append(v_covered_categories, 'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  -- ========== EMIT CABEDAL ==========
  IF v_upper_pid IS NOT NULL AND COALESCE((v_acc_upper->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    v_required := (v_acc_upper->>'required')::numeric;
    v_result := v_result || jsonb_build_object(
      'component', 'Cabedal',
      'product_id', v_upper_pid,
      'product_name', v_resolved.product_name,
      'color', p_color,
      'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required,
      'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft',
      'source', 'per_size_sole_spec',
      'matched_by', v_resolved.matched_by
    );
    v_covered_categories := array_append(v_covered_categories, 'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

  -- ========== EMIT FORRO ==========
  IF v_lining_pid IS NOT NULL AND COALESCE((v_acc_lining->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    v_required := (v_acc_lining->>'required')::numeric;
    v_result := v_result || jsonb_build_object(
      'component', 'Forro',
      'product_id', v_lining_pid,
      'product_name', v_resolved.product_name,
      'color', p_color,
      'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required,
      'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft',
      'source', 'per_size_sole_spec',
      'matched_by', v_resolved.matched_by
    );
    v_covered_categories := array_append(v_covered_categories, 'forro');
    v_covered_categories := array_append(v_covered_categories, 'forração');
    v_covered_categories := array_append(v_covered_categories, 'forracao');
    v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
  END IF;

  -- ========== EMIT PALMILHA ==========
  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, 0, false);
    v_required := (v_acc_insole->>'required')::numeric;
    v_result := v_result || jsonb_build_object(
      'component', 'Palmilha',
      'product_id', v_insole_pid,
      'product_name', v_resolved.product_name,
      'color', p_color,
      'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required,
      'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft',
      'source', 'per_size_sole_spec',
      'matched_by', v_resolved.matched_by
    );
    v_covered_categories := array_append(v_covered_categories, 'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  -- ========== EMIT STANDARD ITEMS DO SOLADO ==========
  FOR v_key IN SELECT jsonb_object_keys(v_acc_std) LOOP
    v_acc_required := (v_acc_std #>> ARRAY[v_key,'required'])::numeric;
    SELECT name, quantity, category INTO v_acc_name, v_acc_avail, v_row_cat_norm
      FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'component', 'Item padrão (solado)',
        'product_id', v_key::uuid,
        'product_name', v_acc_name,
        'color', '',
        'consumption_per_unit', ROUND(v_acc_required / NULLIF(v_total_qty, 0), 4),
        'required', v_acc_required,
        'available', v_acc_avail,
        'stock_ok', v_acc_avail >= v_acc_required,
        'debit_mode', CASE
          WHEN LOWER(COALESCE(v_row_cat_norm, '')) IN
            ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado') THEN 'hard'
          ELSE 'soft' END,
        'source', 'sole_standard_per_size',
        'unit', (v_acc_std #>> ARRAY[v_key,'unit'])
      );
      v_covered_product_ids := array_append(v_covered_product_ids, v_key::uuid);
    END IF;
  END LOOP;

  -- ========== BOM LEGADO (sheet_materials) ==========
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
          ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado') THEN 'hard'
        ELSE 'soft' END,
      'source', 'sheet_materials',
      'category', v_row.category
    );
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  -- ========== Forros alternativos / direct_components ==========
  IF v_sheet.lining_accessories IS NOT NULL AND jsonb_typeof(v_sheet.lining_accessories) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sheet.lining_accessories) AS value LOOP
      v_group_name  := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
      v_required := v_consumption * v_total_qty;
      SELECT * INTO v_resolved FROM resolve_material_product(v_group_name, p_color, v_required, false);
      IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_covered_product_ids)) THEN
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

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_consumption_by_grade(uuid, jsonb, text) TO authenticated;

-- ============================================================
-- freeze_technical_sheet com suporte à grade
-- ============================================================
CREATE OR REPLACE FUNCTION public.freeze_technical_sheet(
  p_reference_id uuid,
  p_sale_order_id uuid,
  p_sale_order_item_id uuid,
  p_color text,
  p_quantity numeric,
  p_size integer DEFAULT NULL,
  p_grade jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_snap_id uuid;
  v_sheet record;
  v_bom jsonb;
  v_consumption jsonb;
BEGIN
  SELECT id, name, version, primary_sole_id, sole_drives_consumption, reference_size
    INTO v_sheet
    FROM public.technical_sheets
   WHERE id = p_reference_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(sm)), '[]'::jsonb)
    INTO v_bom
    FROM public.sheet_materials sm
   WHERE sm.sheet_id = p_reference_id;

  -- Prefere cálculo por grade quando disponível
  IF p_grade IS NOT NULL AND jsonb_typeof(p_grade) = 'object' THEN
    v_consumption := public.calculate_order_consumption_by_grade(p_reference_id, p_grade, p_color);
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      INTO v_consumption
      FROM public.calculate_order_consumption(p_reference_id, p_quantity, p_color, p_size) c;
  END IF;

  INSERT INTO public.technical_sheet_snapshots (
    sheet_id, sale_order_id, sale_order_item_id,
    sheet_name, sheet_version, primary_sole_id, sole_drives_consumption,
    reference_size, bom_snapshot, consumption_snapshot,
    color, quantity, frozen_by
  ) VALUES (
    v_sheet.id, p_sale_order_id, p_sale_order_item_id,
    v_sheet.name, v_sheet.version, v_sheet.primary_sole_id, v_sheet.sole_drives_consumption,
    COALESCE(p_size, v_sheet.reference_size), v_bom, v_consumption,
    COALESCE(p_color, ''), p_quantity, auth.uid()
  )
  ON CONFLICT (sale_order_id, sale_order_item_id)
  DO UPDATE SET
    bom_snapshot = EXCLUDED.bom_snapshot,
    consumption_snapshot = EXCLUDED.consumption_snapshot,
    sheet_version = EXCLUDED.sheet_version,
    frozen_at = now(),
    frozen_by = auth.uid()
  RETURNING id INTO v_snap_id;

  RETURN v_snap_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.freeze_technical_sheet(uuid, uuid, uuid, text, numeric, integer, jsonb) TO authenticated;

-- ============================================================
-- hybrid_debit_stock_for_order: passa grade para freeze
-- ============================================================
CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_order_id uuid,
  p_order_grade jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_pid uuid;
  v_name text;
  v_required numeric;
  v_available numeric;
  v_mode text;
  v_result jsonb := '[]'::jsonb;
  v_size integer;
  v_snap_id uuid;
  v_soi_id uuid;
  v_sale_order_id uuid;
  v_product record;
BEGIN
  v_size := NULL;
  IF p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
    SELECT key::integer INTO v_size
      FROM jsonb_each_text(p_order_grade)
     WHERE key ~ '^[0-9]+$'
     ORDER BY value::numeric DESC
     LIMIT 1;
  END IF;

  SELECT sale_order_id INTO v_sale_order_id FROM public.orders WHERE id = p_order_id;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT id INTO v_soi_id
      FROM public.sale_order_items
     WHERE sale_order_id = v_sale_order_id
       AND reference_id = p_reference_id
       AND COALESCE(color,'') = COALESCE(p_color,'')
     LIMIT 1;
  END IF;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT consumption_snapshot, id INTO v_items, v_snap_id
      FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_sale_order_id
       AND (sale_order_item_id IS NOT DISTINCT FROM v_soi_id)
     LIMIT 1;
  END IF;

  IF v_items IS NULL THEN
    IF v_sale_order_id IS NOT NULL THEN
      v_snap_id := public.freeze_technical_sheet(
        p_reference_id, v_sale_order_id, v_soi_id, p_color, p_order_quantity, v_size, p_order_grade
      );
      SELECT consumption_snapshot INTO v_items
        FROM public.technical_sheet_snapshots WHERE id = v_snap_id;
    ELSE
      IF p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
        v_items := public.calculate_order_consumption_by_grade(p_reference_id, p_order_grade, p_color);
      ELSE
        SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
          INTO v_items
          FROM public.calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size) c;
      END IF;
    END IF;
  END IF;

  -- Phase 1: lock + fail-fast
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid := (v_item ->> 'product_id')::uuid;
    SELECT id, quantity, name INTO v_product
      FROM public.products WHERE id = v_pid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % do snapshot não encontrado', v_pid;
    END IF;
    v_required := (v_item ->> 'required')::numeric;
    IF v_product.quantity < v_required AND (v_item ->> 'debit_mode') = 'hard' THEN
      RAISE EXCEPTION
        'Estoque insuficiente para % "%": disponível %, necessário %',
        v_item ->> 'component', v_product.name, v_product.quantity, v_required;
    END IF;
  END LOOP;

  -- Phase 2: actual debit
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid := (v_item ->> 'product_id')::uuid;
    v_name := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_mode := v_item ->> 'debit_mode';

    SELECT quantity INTO v_available FROM public.products WHERE id = v_pid;

    IF v_mode = 'hard' THEN
      UPDATE public.products
         SET quantity = quantity - v_required, updated_at = now()
       WHERE id = v_pid;

      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES
        (v_pid, 'out', v_required, v_available, v_available - v_required,
         'Débito OP ' || COALESCE(v_name,'') ||
         CASE WHEN COALESCE(p_color,'') <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, v_required, 'consumed', 'hard');

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'debited'
      );
    ELSE
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft');

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'reserved'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('snapshot_id', v_snap_id, 'items', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb) TO authenticated;
-- =============================================================================
-- Add is_approved_user() guard to SECURITY DEFINER stock-debit RPCs
-- =============================================================================
-- Audit-31 finding [4]: the following RPCs were SECURITY DEFINER + GRANT TO
-- authenticated but had no is_approved_user() check, allowing any authenticated
-- user (including unapproved signups) to debit inventory:
--   hybrid_debit_stock_for_order, debit_sole_stock_by_grade, debit_strap_stock,
--   process_order_stock_out, convert_reservation_to_out, debit_packaging_for_order
--
-- Each function is reproduced verbatim from its latest migration with the guard
-- added as the first statement inside BEGIN.
-- =============================================================================


-- 1. hybrid_debit_stock_for_order  (latest: 20260419120147)
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
  v_source text;
  v_result jsonb := '[]'::jsonb;
  v_size integer;
  v_snap_id uuid;
  v_soi_id uuid;
  v_sale_order_id uuid;
  v_product record;
  v_sole_handled_by_grade boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- When grade is present, debit_sole_stock_by_grade will handle sole stock
  v_sole_handled_by_grade := (p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object');

  v_size := NULL;
  IF v_sole_handled_by_grade THEN
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
      IF v_sole_handled_by_grade THEN
        v_items := public.calculate_order_consumption_by_grade(p_reference_id, p_order_grade, p_color);
      ELSE
        SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
          INTO v_items
          FROM public.calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size) c;
      END IF;
    END IF;
  END IF;

  -- Phase 1: lock + fail-fast
  -- Skip sole stock check here when grade is present (debit_sole_stock_by_grade validates per-size)
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_source := v_item ->> 'source';

    -- When grade handles sole debit, skip sole validation here
    IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
      CONTINUE;
    END IF;

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
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_name   := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_mode   := v_item ->> 'debit_mode';
    v_source := v_item ->> 'source';

    SELECT quantity INTO v_available FROM public.products WHERE id = v_pid;

    -- Sole handled by debit_sole_stock_by_grade when grade is present:
    -- register reservation for traceability but skip the stock UPDATE
    IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft')
      ON CONFLICT DO NOTHING;

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'sole_deferred_to_grade'
      );
      CONTINUE;
    END IF;

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


-- 2. debit_sole_stock_by_grade  (latest: 20260507140000)
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
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

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

  IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

  SELECT p.group_id INTO v_product_group_id
    FROM public.products p WHERE p.id = target_product_id;

  SELECT EXISTS (
    SELECT 1 FROM sole_size_conjugations WHERE sole_group_id = v_product_group_id
  ) INTO v_has_conjugations;

  -- Build effective debit grade
  v_effective_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
      FROM jsonb_each_text(p_order_grade)
     WHERE value::numeric > 0
       AND left(key, 1) <> '_'
  LOOP
    IF v_size LIKE '%/%' THEN
      v_conj_key := v_size;
    ELSIF v_has_conjugations AND v_product_group_id IS NOT NULL THEN
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
      IF v_conj_key IS NULL THEN v_conj_key := v_size; END IF;
    ELSE
      v_conj_key := v_size;
    END IF;

    v_existing_qty := COALESCE((v_effective_grade ->> v_conj_key)::numeric, 0);
    v_effective_grade := jsonb_set(
      v_effective_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty)
    );
  END LOOP;

  -- Compute previous total — skip metadata keys to avoid inflating audit log
  v_prev_total := 0;
  FOR v_size IN
    SELECT k FROM jsonb_object_keys(v_stock_grade) AS k
     WHERE left(k, 1) <> '_'
  LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  -- Validate stock availability
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponível %, necessário %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  -- Debit stock
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


-- 3. debit_strap_stock  (latest: 20260427141032)
CREATE OR REPLACE FUNCTION public.debit_strap_stock(
  p_strap_colors jsonb,
  p_order_quantity integer,
  p_order_id uuid DEFAULT NULL::uuid,
  p_order_grade jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_product_id uuid;
  v_product_name text;
  v_product_color text;
  v_current_qty numeric;
  v_required numeric;
  v_consumption numeric;
  v_per_size jsonb;
  v_size text;
  v_pairs numeric;
  v_cm_per_pair numeric;
  v_total_cm numeric;
  v_grade_total numeric;
  v_fichas numeric;
  v_per_size_has_data boolean;
  v_wrong_name text;
  v_wrong_color text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF p_strap_colors IS NULL OR jsonb_typeof(p_strap_colors) != 'array' OR jsonb_array_length(p_strap_colors) = 0 THEN
    RETURN;
  END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(p_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';

    BEGIN
      v_group_id := (v_strap ->> 'group_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_group_id := NULL;
    END;

    IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN
      CONTINUE;
    END IF;

    v_per_size := v_strap -> 'consumption_per_size';
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 1);
    IF v_consumption <= 0 THEN v_consumption := 1; END IF;

    v_per_size_has_data := v_per_size IS NOT NULL
      AND jsonb_typeof(v_per_size) = 'object'
      AND v_per_size <> '{}'::jsonb;

    IF v_per_size_has_data
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0;
      v_grade_total := 0;

      FOR v_size, v_pairs IN
        SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE(NULLIF((v_per_size ->> v_size)::numeric, 0), v_consumption);
        v_total_cm    := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;

      IF v_grade_total > 0 THEN
        v_fichas := GREATEST(1, round(p_order_quantity::numeric / v_grade_total));
      ELSE
        v_fichas := 1;
      END IF;

      v_required := (v_total_cm * v_fichas) / 100;

    ELSIF v_per_size_has_data THEN
      v_required := (v_consumption / 100.0) * p_order_quantity;

    ELSE
      v_required := v_consumption * p_order_quantity;
    END IF;

    IF v_required <= 0 THEN CONTINUE; END IF;

    SELECT p.id, p.name, p.quantity, p.color
    INTO v_product_id, v_product_name, v_current_qty, v_product_color
    FROM public.products p
    WHERE p.active = true
      AND p.group_id = v_group_id
      AND lower(trim(p.color)) = lower(trim(v_color))
    LIMIT 1;

    IF v_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity, p.color
      INTO v_product_id, v_product_name, v_current_qty, v_product_color
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_group_id
        AND (p.color IS NULL OR trim(p.color) = '')
      LIMIT 1;
    END IF;

    IF v_product_id IS NULL THEN
      SELECT p.name, p.color INTO v_wrong_name, v_wrong_color
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_group_id
      LIMIT 1;
      IF v_wrong_name IS NOT NULL THEN
        RAISE EXCEPTION
          'Tira "%" cor "%" não encontrada no estoque. Produto disponível no grupo: "%" (cor "%"). Cadastre o material na cor correta.',
          COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_wrong_name, COALESCE(v_wrong_color, 'sem cor');
      ELSE
        RAISE EXCEPTION
          'Material da tira "%" (cor: %) não encontrado no estoque (grupo: %).',
          COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_group_id;
      END IF;
    END IF;

    IF v_current_qty < v_required THEN
      RAISE EXCEPTION
        'Estoque insuficiente para tira "%" (cor: %): disponível %.4f, necessário %.4f metros.',
        v_product_name, v_color, v_current_qty, v_required;
    END IF;

    UPDATE public.products
    SET quantity = quantity - v_required, updated_at = now()
    WHERE id = v_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_product_id, 'out', v_required,
      v_current_qty, v_current_qty - v_required,
      'Debito Tira (' || COALESCE(v_product_name, '') || ') Cor: ' || v_color
        || ' - ' || round(v_required::numeric, 4) || 'm x ' || p_order_quantity || ' pares',
      p_order_id
    );
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.debit_strap_stock(jsonb, integer, uuid, jsonb) TO authenticated;


-- 4. process_order_stock_out  (latest: 20260417165306)
CREATE OR REPLACE FUNCTION public.process_order_stock_out(
  p_order_id uuid,
  p_product_id uuid,
  p_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet_exists boolean;
  v_component RECORD;
  v_consumption_per_pair numeric;
  v_waste_pct numeric;
  v_total_to_debit numeric;
  v_prev_qty numeric;
  v_new_qty numeric;
  v_components_processed integer := 0;
  v_components_debited integer := 0;
  v_total_value numeric := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.technical_sheets WHERE id = p_product_id) INTO v_sheet_exists;
  IF NOT v_sheet_exists THEN
    RETURN jsonb_build_object('success', false, 'reason', 'technical_sheet_not_found');
  END IF;

  FOR v_component IN
    SELECT
      sm.product_id,
      sm.quantity_per_unit,
      cs.yield_per_size,
      COALESCE(cs.waste_pct, 0) AS waste_pct,
      p.quantity AS current_qty,
      p.unit_price
    FROM public.sheet_materials sm
    INNER JOIN public.component_sheets cs ON cs.product_id = sm.product_id
    INNER JOIN public.products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_product_id
      AND sm.product_id IS NOT NULL
  LOOP
    v_components_processed := v_components_processed + 1;

    v_consumption_per_pair := COALESCE(
      NULLIF((v_component.yield_per_size->>'unit')::numeric, 0),
      v_component.quantity_per_unit,
      0
    );

    IF v_consumption_per_pair <= 0 THEN
      CONTINUE;
    END IF;

    v_waste_pct := COALESCE(v_component.waste_pct, 0);
    v_total_to_debit := v_consumption_per_pair * p_quantity * (1 + v_waste_pct / 100.0);

    v_prev_qty := COALESCE(v_component.current_qty, 0);
    v_new_qty := v_prev_qty - v_total_to_debit;

    UPDATE public.products
    SET quantity = v_new_qty
    WHERE id = v_component.product_id;

    INSERT INTO public.stock_movements (
      product_id, order_id, movement_type, quantity,
      previous_stock, new_stock, description
    ) VALUES (
      v_component.product_id,
      p_order_id,
      'out',
      v_total_to_debit,
      v_prev_qty,
      v_new_qty,
      'Baixa automática de componente via OP (consumo por par + perda)'
    );

    v_components_debited := v_components_debited + 1;
    v_total_value := v_total_value + (v_total_to_debit * COALESCE(v_component.unit_price, 0));
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'components_processed', v_components_processed,
    'components_debited', v_components_debited,
    'total_value', v_total_value
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.process_order_stock_out(uuid, uuid, integer) TO authenticated;


-- 5. convert_reservation_to_out  (latest: 20260503140000)
CREATE OR REPLACE FUNCTION public.convert_reservation_to_out(
  p_order_id   uuid,
  p_product_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            RECORD;
  v_prev_qty   numeric;
  v_new_qty    numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  FOR r IN
    SELECT mr.product_id, mr.quantity_reserved AS quantity, mr.id,
           p.quantity AS current_qty
      FROM public.material_reservations mr
      JOIN public.products p ON p.id = mr.product_id
     WHERE mr.order_id   = p_order_id
       AND (p_product_id IS NULL OR mr.product_id = p_product_id)
       AND mr.status = 'reserved'
     FOR UPDATE OF mr
  LOOP
    v_prev_qty := r.current_qty;
    v_new_qty  := r.current_qty - r.quantity;

    UPDATE public.products
       SET quantity       = v_new_qty,
           reserved_stock = GREATEST(COALESCE(reserved_stock, 0) - r.quantity, 0)
     WHERE id = r.product_id;

    UPDATE public.material_reservations
       SET status     = 'converted',
           updated_at = now()
     WHERE id = r.id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity,
      previous_stock, new_stock,
      description, order_id
    ) VALUES (
      r.product_id, 'out', r.quantity,
      v_prev_qty, v_new_qty,
      'Conversão de reserva → débito (entrada em Corte) — OP ' || p_order_id::text,
      p_order_id
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_reservation_to_out(uuid, uuid) TO authenticated;


-- 6. debit_packaging_for_order  (latest: 20260517130000)
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id  uuid,
  p_order_id       uuid,
  p_reference_id   uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg          RECORD;
  boxes_needed integer;
  v_result     jsonb   := '[]'::jsonb;
  v_types_to_debit text[];
  v_box_stock  numeric;
  v_prod_stock numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode = 'individual_fitilho' THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  FOR cfg IN
    SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box, pc.product_id, pc.box_type_id,
           p.name AS product_name,
           bt.nome AS box_name
    FROM packaging_configs pc
    LEFT JOIN products  p  ON p.id  = pc.product_id  AND p.active  = true
    LEFT JOIN box_types bt ON bt.id = pc.box_type_id AND bt.active = true
    WHERE pc.sheet_id       = p_reference_id
      AND pc.active         = true
      AND pc.packaging_type = ANY(v_types_to_debit)
  LOOP
    boxes_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

    IF cfg.box_type_id IS NOT NULL THEN
      SELECT quantity INTO v_box_stock
        FROM public.box_types
       WHERE id = cfg.box_type_id
       FOR UPDATE;

      IF v_box_stock IS NULL OR v_box_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.box_name, cfg.nome), COALESCE(v_box_stock, 0), boxes_needed;
      END IF;

      UPDATE box_types
         SET quantity   = quantity - boxes_needed,
             updated_at = now()
       WHERE id = cfg.box_type_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.box_type_id, 'out', boxes_needed,
        v_box_stock, v_box_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.box_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'box_type_id',    cfg.box_type_id,
        'box_name',       COALESCE(cfg.box_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_box_types'
      );

    ELSIF cfg.product_id IS NOT NULL THEN
      SELECT quantity INTO v_prod_stock
        FROM public.products
       WHERE id = cfg.product_id
       FOR UPDATE;

      IF v_prod_stock IS NULL OR v_prod_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.product_name, cfg.nome), COALESCE(v_prod_stock, 0), boxes_needed;
      END IF;

      UPDATE products
         SET quantity   = quantity - boxes_needed,
             updated_at = now()
       WHERE id = cfg.product_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.product_id, 'out', boxes_needed,
        v_prod_stock, v_prod_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.product_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'product_id',     cfg.product_id,
        'product_name',   COALESCE(cfg.product_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_products'
      );

    ELSE
      v_result := v_result || jsonb_build_object(
        'packaging_type', cfg.packaging_type,
        'nome',           cfg.nome,
        'status',         'skipped',
        'reason',         'no_stock_linked'
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text) TO authenticated;

COMMENT ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text) IS
  'Debits packaging stock atomically — uses SELECT FOR UPDATE to prevent concurrent double-debits. Requires approved user.';

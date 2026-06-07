-- Fix #6 (auditoria 2026-06-06): debit_sole_stock_by_grade só aplicava a coligação
-- cabedal→cor-do-solado (sole_color_conjugations) quando v_is_palmilha_pronta. Para solado
-- tradicional/conjugado, usava p_color (cabedal) cru → se não havia produto nessa cor caía
-- no fallback arbitrário (ORDER BY updated_at), debitando a cor ERRADA (divergindo do
-- modal/custeio que já aplicam via resolve_sole_color PRIORIDADE 0). Fix: aplicar a
-- coligação SEMPRE nas Branches por grupo (mantendo o mapping explícito como prioridade).
CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(p_reference_id uuid, p_order_id uuid, p_color text, p_order_grade jsonb, p_force_soft boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id          uuid;
  v_sole_material          text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id   uuid;
  target_product_id        uuid;
  target_name              text;
  v_stock_grade            jsonb;
  v_size                   text;
  v_size_qty               numeric;
  v_available              numeric;
  v_new_grade              jsonb;
  v_total_debited          numeric := 0;
  v_prev_total             numeric;
  v_product_group_id       uuid;
  v_effective_grade        jsonb;
  v_conj_key               text;
  v_existing_qty           numeric;
  v_has_conjugations       boolean;
  v_is_palmilha_pronta     boolean := false;
  v_effective_color        text;
  v_palmilha_color         text;
  v_grade_total_units      numeric := 0;
  v_input_grade jsonb;
  v_order_qty numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuario nao aprovado';
  END IF;

  SELECT ts.sole_group_id, ts.sole_material
    INTO v_sole_group_id, v_sole_material
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;

  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN RETURN; END IF;
  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN RETURN; END IF;

  SELECT quantity INTO v_order_qty FROM public.orders WHERE id = p_order_id;
  v_input_grade := public.scale_grade_to_total(p_order_grade, COALESCE(v_order_qty, 0));

  SELECT tsc.sole_product_id, tsc.sole_group_id
    INTO v_mapped_sole_product_id, v_mapped_sole_group_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sheet_id = p_reference_id
     AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, '')))
   LIMIT 1;

  target_product_id := NULL;
  v_effective_color := COALESCE(p_color, '');

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
      FROM public.products p WHERE p.active = true AND p.id = v_mapped_sole_product_id
      LIMIT 1 FOR UPDATE;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.products WHERE group_id = v_mapped_sole_group_id AND sole_classification = 'palmilha_pronta' AND active = true)
      INTO v_is_palmilha_pronta;
    -- Coligação cabedal→cor-do-solado: aplica em TODA classificação (espelha
    -- resolve_sole_color PRIORIDADE 0), não só palmilha_pronta.
    SELECT palmilha_color INTO v_palmilha_color FROM public.sole_color_conjugations
      WHERE sole_group_id = v_mapped_sole_group_id AND UPPER(TRIM(cabedal_color)) = UPPER(TRIM(COALESCE(p_color, ''))) AND active = true LIMIT 1;
    IF v_palmilha_color IS NULL THEN
      SELECT palmilha_color INTO v_palmilha_color FROM public.sole_color_conjugations
        WHERE sole_group_id = v_mapped_sole_group_id AND is_default = true AND active = true LIMIT 1;
    END IF;
    IF v_palmilha_color IS NOT NULL THEN v_effective_color := v_palmilha_color; END IF;
    IF v_effective_color IS NOT NULL AND v_effective_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
        FROM public.products p WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(v_effective_color))
        LIMIT 1 FOR UPDATE;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
        FROM public.products p WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
        ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id LIMIT 1 FOR UPDATE;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    v_is_palmilha_pronta := false;
    SELECT EXISTS (SELECT 1 FROM public.products WHERE group_id = v_sole_group_id AND sole_classification = 'palmilha_pronta' AND active = true)
      INTO v_is_palmilha_pronta;
    -- Coligação cabedal→cor-do-solado: aplica em TODA classificação (não só pronta).
    v_palmilha_color := NULL;
    SELECT palmilha_color INTO v_palmilha_color FROM public.sole_color_conjugations
      WHERE sole_group_id = v_sole_group_id AND UPPER(TRIM(cabedal_color)) = UPPER(TRIM(COALESCE(p_color, ''))) AND active = true LIMIT 1;
    IF v_palmilha_color IS NULL THEN
      SELECT palmilha_color INTO v_palmilha_color FROM public.sole_color_conjugations
        WHERE sole_group_id = v_sole_group_id AND is_default = true AND active = true LIMIT 1;
    END IF;
    v_effective_color := COALESCE(NULLIF(v_palmilha_color, ''), p_color, '');
    IF v_effective_color IS NOT NULL AND v_effective_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
        FROM public.products p WHERE p.active = true AND p.group_id = v_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(v_effective_color))
        LIMIT 1 FOR UPDATE;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
        FROM public.products p WHERE p.active = true AND p.group_id = v_sole_group_id
        ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id LIMIT 1 FOR UPDATE;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
        FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_sole_material
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
        LIMIT 1 FOR UPDATE;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
        FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_sole_material
        ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id LIMIT 1 FOR UPDATE;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN RETURN; END IF;
  IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

  SELECT p.group_id INTO v_product_group_id FROM public.products p WHERE p.id = target_product_id;

  SELECT EXISTS (SELECT 1 FROM sole_size_conjugations WHERE sole_group_id = v_product_group_id)
    INTO v_has_conjugations;

  v_effective_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_input_grade)
    WHERE value::numeric > 0 AND left(key, 1) <> '_'
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
    v_effective_grade := jsonb_set(v_effective_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
    v_grade_total_units := v_grade_total_units + v_size_qty;
  END LOOP;

  IF p_force_soft THEN
    DELETE FROM public.material_reservations
     WHERE order_id = p_order_id AND status = 'reserved'
       AND (metadata ->> 'kind') IN ('sole_pending_grade', 'sole_grade');
    INSERT INTO public.material_reservations
      (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
    VALUES (p_order_id, target_product_id, v_grade_total_units, 0, 'reserved', 'soft',
      jsonb_build_object('kind', 'sole_grade', 'effective_grade', v_effective_grade,
        'color', p_color, 'effective_color', v_effective_color,
        'palmilha_color', v_palmilha_color, 'is_palmilha_pronta', v_is_palmilha_pronta,
        'target_name', target_name));
    RETURN;
  END IF;

  v_prev_total := 0;
  FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
  LOOP v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0); END LOOP;

  FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponivel %, necessario %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  v_new_grade := v_stock_grade;
  FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
       SET stock_grade = v_new_grade, quantity = GREATEST(0, quantity - v_total_debited), updated_at = now()
     WHERE id = target_product_id;

    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (target_product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
      'Debito Solado por grade (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cabedal: ' || p_color ELSE '' END ||
        CASE WHEN v_is_palmilha_pronta AND v_palmilha_color IS NOT NULL THEN ' -> Palmilha: ' || v_palmilha_color ELSE '' END,
      p_order_id);

    UPDATE public.material_reservations
       SET status = 'consumed', quantity_consumed = COALESCE(quantity_reserved, 0), updated_at = now()
     WHERE order_id = p_order_id AND product_id = target_product_id AND status = 'reserved';
  END IF;
END;
$function$;

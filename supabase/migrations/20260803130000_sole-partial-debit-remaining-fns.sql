-- ============================================================================
-- BAIXA PARCIAL DE SOLADO — funções restantes (continuação de 20260803120000)
-- ============================================================================
-- A 20260803120000 corrigiu convert_reservation_to_out + commit_picking_for_sale_order,
-- mas o mesmo "Estoque insuficiente para Solado ... tamanho" ainda travava em MAIS
-- DUAS funções que debitam solado por grade (descoberto quando o usuário repetiu o
-- erro — vinha de debit_sole_stock_by_grade, que usa "disponivel/necessario" SEM acento):
--   • debit_sole_stock_by_grade   — débito HARD direto (chamado por useOrders/useSaleOrders
--     junto do hybrid_debit_stock_for_order). Antes: pré-loop com RAISE.
--   • consume_all_reservations_for_order — picking/consumo por OP. Antes: pré-loop RAISE
--     no ramo sole_grade.
--
-- Mesma regra das outras duas (escopo SÓ solado; ramos linear/embalagem intocados):
-- debita LEAST(disponível, necessário) por tamanho; reserva consumida guarda SÓ o
-- grade debitado (simetria de estorno via restore_sole_grade_for_order); saldo vira
-- reserva pendente (partial_pending); reserved_stock recomputado por
-- sync_product_reserved_stock. Aplicado via MCP em ssvxfoybzmjlypnipqzn.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(p_reference_id uuid, p_order_id uuid, p_color text, p_order_grade jsonb, p_force_soft boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id uuid; v_sole_material text; v_mapped_sole_product_id uuid; v_mapped_sole_group_id uuid;
  target_product_id uuid; target_name text; v_stock_grade jsonb; v_size text; v_size_qty numeric;
  v_available numeric; v_new_grade jsonb; v_total_debited numeric := 0; v_prev_total numeric;
  v_product_group_id uuid; v_effective_grade jsonb; v_conj_key text; v_existing_qty numeric;
  v_has_conjugations boolean; v_is_palmilha_pronta boolean := false; v_effective_color text;
  v_palmilha_color text; v_grade_total_units numeric := 0; v_input_grade jsonb; v_order_qty numeric;
  -- baixa parcial:
  v_debit_size numeric; v_shortfall_total numeric := 0; v_debited_grade jsonb; v_shortfall_grade jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied: usuario nao aprovado'; END IF;

  SELECT ts.sole_group_id, ts.sole_material INTO v_sole_group_id, v_sole_material
    FROM public.technical_sheets ts WHERE ts.id = p_reference_id;
  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN RETURN; END IF;
  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN RETURN; END IF;

  SELECT quantity INTO v_order_qty FROM public.orders WHERE id = p_order_id;
  v_input_grade := public.scale_grade_to_total(p_order_grade, COALESCE(v_order_qty, 0));

  SELECT tsc.sole_product_id, tsc.sole_group_id INTO v_mapped_sole_product_id, v_mapped_sole_group_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sheet_id = p_reference_id AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, ''))) LIMIT 1;

  target_product_id := NULL; v_effective_color := COALESCE(p_color, '');

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
      FROM public.products p WHERE p.active = true AND p.id = v_mapped_sole_product_id LIMIT 1 FOR UPDATE;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.products WHERE group_id = v_mapped_sole_group_id AND sole_classification = 'palmilha_pronta' AND active = true) INTO v_is_palmilha_pronta;
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
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(v_effective_color)) LIMIT 1 FOR UPDATE;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
        FROM public.products p WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
        ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id LIMIT 1 FOR UPDATE;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    v_is_palmilha_pronta := false;
    SELECT EXISTS (SELECT 1 FROM public.products WHERE group_id = v_sole_group_id AND sole_classification = 'palmilha_pronta' AND active = true) INTO v_is_palmilha_pronta;
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
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(v_effective_color)) LIMIT 1 FOR UPDATE;
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
        WHERE p.active = true AND pg.name = v_sole_material AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color)) LIMIT 1 FOR UPDATE;
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
  SELECT EXISTS (SELECT 1 FROM sole_size_conjugations WHERE sole_group_id = v_product_group_id) INTO v_has_conjugations;

  v_effective_grade := '{}'::jsonb;
  FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_input_grade) WHERE value::numeric > 0 AND left(key, 1) <> '_'
  LOOP
    IF v_size LIKE '%/%' THEN v_conj_key := v_size;
    ELSIF v_has_conjugations AND v_product_group_id IS NOT NULL THEN
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
      IF v_conj_key IS NULL THEN v_conj_key := v_size; END IF;
    ELSE v_conj_key := v_size; END IF;
    v_existing_qty := COALESCE((v_effective_grade ->> v_conj_key)::numeric, 0);
    v_effective_grade := jsonb_set(v_effective_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
    v_grade_total_units := v_grade_total_units + v_size_qty;
  END LOOP;

  -- SOFT (reserva): inalterado.
  IF p_force_soft THEN
    DELETE FROM public.material_reservations
     WHERE order_id = p_order_id AND status = 'reserved' AND (metadata ->> 'kind') IN ('sole_pending_grade', 'sole_grade');
    INSERT INTO public.material_reservations
      (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
    VALUES (p_order_id, target_product_id, v_grade_total_units, 0, 'reserved', 'soft',
      jsonb_build_object('kind', 'sole_grade', 'effective_grade', v_effective_grade, 'color', p_color,
        'effective_color', v_effective_color, 'palmilha_color', v_palmilha_color,
        'is_palmilha_pronta', v_is_palmilha_pronta, 'target_name', target_name));
    RETURN;
  END IF;

  -- HARD: BAIXA PARCIAL por tamanho (não trava) + split do saldo.
  v_prev_total := 0;
  FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
  LOOP v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0); END LOOP;

  v_new_grade := v_stock_grade; v_total_debited := 0; v_shortfall_total := 0;
  v_debited_grade := '{}'::jsonb; v_shortfall_grade := '{}'::jsonb;
  FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_debit_size := LEAST(v_available, v_size_qty);
    IF v_debit_size > 0 THEN
      v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_debit_size));
      v_total_debited := v_total_debited + v_debit_size;
      v_debited_grade := jsonb_set(v_debited_grade, ARRAY[v_size], to_jsonb(v_debit_size));
    END IF;
    IF (v_size_qty - v_debit_size) > 0 THEN
      v_shortfall_total := v_shortfall_total + (v_size_qty - v_debit_size);
      v_shortfall_grade := jsonb_set(v_shortfall_grade, ARRAY[v_size], to_jsonb(v_size_qty - v_debit_size));
    END IF;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products SET stock_grade = v_new_grade, quantity = GREATEST(0, quantity - v_total_debited), updated_at = now()
     WHERE id = target_product_id;
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (target_product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
      'Debito Solado por grade' || CASE WHEN v_shortfall_total > 0 THEN ' (parcial)' ELSE '' END || ' (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cabedal: ' || p_color ELSE '' END ||
        CASE WHEN v_is_palmilha_pronta AND v_palmilha_color IS NOT NULL THEN ' -> Palmilha: ' || v_palmilha_color ELSE '' END,
      p_order_id);

    -- marca a reserva soft existente como consumed guardando SÓ o debitado.
    UPDATE public.material_reservations
       SET status = 'consumed', quantity_reserved = v_total_debited, quantity_consumed = v_total_debited,
           reservation_type = 'hard',
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{effective_grade}', v_debited_grade)
                      || CASE WHEN v_shortfall_total > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END,
           updated_at = now()
     WHERE order_id = p_order_id AND product_id = target_product_id AND status = 'reserved';

    -- não havia reserva soft → cria uma consumed (simetria do estorno).
    IF NOT FOUND THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, target_product_id, v_total_debited, v_total_debited, 'consumed', 'hard',
        jsonb_build_object('kind', 'sole_grade', 'effective_grade', v_debited_grade, 'color', p_color,
          'effective_color', v_effective_color, 'palmilha_color', v_palmilha_color,
          'is_palmilha_pronta', v_is_palmilha_pronta, 'target_name', target_name)
        || CASE WHEN v_shortfall_total > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END);
    END IF;

    -- saldo faltante → reserva PENDENTE (reconcilia via convert/picking quando chegar).
    IF v_shortfall_total > 0 THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata, notes)
      VALUES (p_order_id, target_product_id, v_shortfall_total, 0, 'reserved', 'soft',
        jsonb_build_object('kind', 'sole_grade', 'effective_grade', v_shortfall_grade, 'color', p_color,
          'effective_color', v_effective_color, 'palmilha_color', v_palmilha_color,
          'is_palmilha_pronta', v_is_palmilha_pronta, 'target_name', target_name, 'partial_pending', true),
        '⚠ Saldo de baixa parcial (solado em falta) — reconciliar ao repor estoque');
    END IF;

    PERFORM public.sync_product_reserved_stock(target_product_id);
  END IF;
END;
$function$;


CREATE OR REPLACE FUNCTION public.consume_all_reservations_for_order(p_order_id uuid, p_picked_by text DEFAULT ''::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_res RECORD; v_result jsonb := '[]'::jsonb; v_kind text; v_size text; v_size_qty numeric;
  v_available numeric; v_stock_grade jsonb; v_new_grade jsonb; v_total_debited numeric; v_prev_total numeric;
  v_prev_qty numeric; v_color text; v_palmilha_color text; v_is_palmilha_pronta boolean; v_target_name text;
  v_effective_grade jsonb; v_order RECORD; v_pkg_mode text; v_pkg_result jsonb;
  v_consumed_count integer := 0; v_skipped_count integer := 0;
  -- baixa parcial:
  v_debit_size numeric; v_shortfall_total numeric; v_debited_grade jsonb; v_shortfall_grade jsonb; v_synced uuid[] := '{}';
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied: usuário não aprovado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('consume_reservations:' || p_order_id::text));

  FOR v_res IN
    SELECT * FROM public.material_reservations
     WHERE order_id = p_order_id AND status = 'reserved'
     ORDER BY (CASE WHEN (metadata->>'kind') = 'sole_grade' THEN 0 ELSE 1 END), created_at, id
     FOR UPDATE
  LOOP
    v_kind := COALESCE(v_res.metadata ->> 'kind', 'component');

    IF v_kind = 'sole_grade' THEN
      v_color := v_res.metadata ->> 'color';
      v_palmilha_color := v_res.metadata ->> 'palmilha_color';
      v_is_palmilha_pronta := COALESCE((v_res.metadata ->> 'is_palmilha_pronta')::boolean, false);
      v_target_name := COALESCE(v_res.metadata ->> 'target_name', '');
      v_effective_grade := v_res.metadata -> 'effective_grade';

      IF v_effective_grade IS NULL OR jsonb_typeof(v_effective_grade) <> 'object' THEN
        v_skipped_count := v_skipped_count + 1;
        v_result := v_result || jsonb_build_object('reservation_id', v_res.id, 'kind', v_kind, 'status', 'skipped_no_grade');
        CONTINUE;
      END IF;

      SELECT stock_grade, quantity, name INTO v_stock_grade, v_prev_qty, v_target_name
        FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

      v_prev_total := 0;
      FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
      LOOP v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0); END LOOP;

      -- BAIXA PARCIAL por tamanho + split.
      v_new_grade := v_stock_grade; v_total_debited := 0; v_shortfall_total := 0;
      v_debited_grade := '{}'::jsonb; v_shortfall_grade := '{}'::jsonb;
      FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
      LOOP
        v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
        v_debit_size := LEAST(v_available, v_size_qty);
        IF v_debit_size > 0 THEN
          v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_debit_size));
          v_total_debited := v_total_debited + v_debit_size;
          v_debited_grade := jsonb_set(v_debited_grade, ARRAY[v_size], to_jsonb(v_debit_size));
        END IF;
        IF (v_size_qty - v_debit_size) > 0 THEN
          v_shortfall_total := v_shortfall_total + (v_size_qty - v_debit_size);
          v_shortfall_grade := jsonb_set(v_shortfall_grade, ARRAY[v_size], to_jsonb(v_size_qty - v_debit_size));
        END IF;
      END LOOP;

      IF v_total_debited <= 0 THEN
        v_skipped_count := v_skipped_count + 1;
        v_result := v_result || jsonb_build_object('reservation_id', v_res.id, 'kind', v_kind, 'status', 'skipped_no_stock');
        CONTINUE;
      END IF;

      UPDATE public.products SET stock_grade = v_new_grade, quantity = GREATEST(0, quantity - v_total_debited), updated_at = now()
       WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_res.product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
        'Picking Solado por grade' || CASE WHEN v_shortfall_total > 0 THEN ' (parcial)' ELSE '' END || ' (' || v_target_name || ')' ||
          CASE WHEN COALESCE(v_color, '') <> '' THEN ' Cabedal: ' || v_color ELSE '' END ||
          CASE WHEN v_is_palmilha_pronta AND v_palmilha_color IS NOT NULL THEN ' -> Palmilha: ' || v_palmilha_color ELSE '' END,
        p_order_id);

      UPDATE public.material_reservations
         SET status = 'consumed', quantity_reserved = v_total_debited, quantity_consumed = v_total_debited,
             consumed_at = now(), reservation_type = 'hard',
             reserved_by = COALESCE(NULLIF(reserved_by, ''), p_picked_by),
             metadata = jsonb_set(metadata, '{effective_grade}', v_debited_grade)
                        || CASE WHEN v_shortfall_total > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END,
             updated_at = now()
       WHERE id = v_res.id;

      IF v_shortfall_total > 0 THEN
        INSERT INTO public.material_reservations
          (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, metadata, notes)
        VALUES (v_res.order_id, v_res.product_id, v_shortfall_total, 0, 'reserved',
          COALESCE(v_res.reservation_type, 'soft'), COALESCE(v_res.source, 'onhand'),
          jsonb_set(v_res.metadata, '{effective_grade}', v_shortfall_grade) || jsonb_build_object('partial_pending', true, 'partial_of', v_res.id::text),
          '⚠ Saldo de baixa parcial (solado em falta) — reconciliar ao repor estoque');
      END IF;

      IF NOT (v_res.product_id = ANY(v_synced)) THEN v_synced := v_synced || v_res.product_id; END IF;
      v_consumed_count := v_consumed_count + 1;
      v_result := v_result || jsonb_build_object('reservation_id', v_res.id, 'kind', v_kind, 'product_id', v_res.product_id,
        'consumed', v_total_debited, 'shortfall', v_shortfall_total,
        'status', CASE WHEN v_shortfall_total > 0 THEN 'consumed_partial' ELSE 'consumed_grade' END);

    ELSIF v_kind = 'sole_pending_grade' THEN
      UPDATE public.material_reservations
         SET status = 'cancelled', updated_at = now(),
             notes = COALESCE(NULLIF(notes,''),'') || ' [auto-cancelled at consume: orphan sole_pending_grade]'
       WHERE id = v_res.id;
      v_skipped_count := v_skipped_count + 1;
      v_result := v_result || jsonb_build_object('reservation_id', v_res.id, 'kind', v_kind, 'status', 'cancelled_orphan');

    ELSE
      -- linear (strap/component): IDÊNTICO à produção (raise se faltar).
      SELECT quantity, name INTO v_prev_qty, v_target_name FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      IF v_prev_qty < v_res.quantity_reserved THEN
        RAISE EXCEPTION 'Estoque insuficiente para "%" (%): disponível %, necessário %',
          v_target_name, v_kind, v_prev_qty, v_res.quantity_reserved;
      END IF;
      UPDATE public.products SET quantity = quantity - v_res.quantity_reserved, updated_at = now() WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_res.product_id, 'out', v_res.quantity_reserved, v_prev_qty, v_prev_qty - v_res.quantity_reserved,
        CASE v_kind
          WHEN 'strap' THEN 'Picking Tira (' || COALESCE(v_target_name,'') || ') Cor: ' || COALESCE(v_res.metadata ->> 'color', '')
          ELSE 'Picking ' || COALESCE(v_res.metadata ->> 'component', 'Material') || ' (' || COALESCE(v_target_name,'') || ')'
        END, p_order_id);
      UPDATE public.material_reservations
         SET status = 'consumed', quantity_consumed = COALESCE(quantity_reserved, 0), consumed_at = now(),
             reservation_type = 'hard', reserved_by = COALESCE(NULLIF(reserved_by, ''), p_picked_by), updated_at = now()
       WHERE id = v_res.id;
      v_consumed_count := v_consumed_count + 1;
      v_result := v_result || jsonb_build_object('reservation_id', v_res.id, 'kind', v_kind,
        'product_id', v_res.product_id, 'consumed', v_res.quantity_reserved, 'status', 'consumed');
    END IF;
  END LOOP;

  PERFORM public.sync_product_reserved_stock(pid) FROM unnest(v_synced) AS pid;

  -- EMBALAGEM (deferida): inalterado.
  SELECT o.sale_order_id, o.reference_id, o.quantity INTO v_order FROM public.orders o WHERE o.id = p_order_id;
  IF v_order.sale_order_id IS NOT NULL AND v_order.reference_id IS NOT NULL THEN
    SELECT COALESCE(packaging_mode, 'individual_amarrado') INTO v_pkg_mode FROM public.sale_orders WHERE id = v_order.sale_order_id;
    IF NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE order_id = p_order_id AND movement_type = 'out' AND description LIKE 'Débito embalagem%') THEN
      BEGIN
        v_pkg_result := public.debit_packaging_for_order(v_order.sale_order_id, p_order_id, v_order.reference_id, v_order.quantity, v_pkg_mode, false);
      EXCEPTION WHEN OTHERS THEN v_pkg_result := jsonb_build_object('error', SQLERRM);
      END;
    ELSE v_pkg_result := jsonb_build_object('skipped', 'already_debited');
    END IF;
  END IF;

  RETURN jsonb_build_object('order_id', p_order_id, 'consumed_count', v_consumed_count,
    'skipped_count', v_skipped_count, 'reservations', v_result, 'packaging', v_pkg_result);
END;
$function$;

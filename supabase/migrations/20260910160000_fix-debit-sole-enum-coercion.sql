-- =============================================================================
-- Fix: debit_sole_stock_by_grade quebrava com 22P02 (coerção de enum)
-- Achado do E2E da refatoração try_reserve (2026-07-09, rollback-run):
--   COALESCE(p.sole_classification, '') força coerção do literal '' pro enum
--   sole_classification_enum → "invalid input value for enum" em TODA chamada
--   que resolve solado (a expressão entrou na 20260902140000; a coluna virou
--   enum na 20260620280000). Padrão seguro usado no resto do sistema: ::text.
-- Única mudança vs. versão viva: p.sole_classification::text no COALESCE.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(p_reference_id uuid, p_order_id uuid, p_color text, p_order_grade jsonb, p_force_soft boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  target_product_id uuid; target_name text; v_stock_grade jsonb; v_size text; v_size_qty numeric;
  v_available numeric; v_new_grade jsonb; v_total_debited numeric := 0; v_prev_total numeric;
  v_product_group_id uuid; v_effective_grade jsonb; v_conj_key text; v_existing_qty numeric;
  v_has_conjugations boolean; v_is_palmilha_pronta boolean := false; v_effective_color text;
  v_palmilha_color text; v_grade_total_units numeric := 0; v_input_grade jsonb; v_order_qty numeric;
  v_debit_size numeric; v_shortfall_total numeric := 0; v_debited_grade jsonb; v_shortfall_grade jsonb;
  v_resolved_product_id uuid; v_resolved_color text; v_res_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied: usuario nao aprovado'; END IF;
  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN RETURN; END IF;

  SELECT quantity INTO v_order_qty FROM public.orders WHERE id = p_order_id;
  v_input_grade := public.scale_grade_to_total(p_order_grade, COALESCE(v_order_qty, 0));

  -- ACHADO (a): resolução ÚNICA e canônica do produto-solado. Antes havia
  -- cascata própria (mapping antes da conjugação P0, match sem unaccent,
  -- LIMIT 1 sem ordenar e fallback "qualquer cor" por updated_at DESC) que
  -- reservava/debitava produto errado. resolve_sole_color aplica:
  -- P0 conjugação de cor → P1/P2 mapping explícito → P3 primary_sole_id,
  -- tudo accent-insensitive e desempatado por quantity DESC.
  -- Se não resolver, NÃO debita (nunca baixar cor/produto errado).
  SELECT rsc.sole_product_id, rsc.sole_color
    INTO v_resolved_product_id, v_resolved_color
    FROM public.resolve_sole_color(p_reference_id, p_color) rsc
   LIMIT 1;
  IF v_resolved_product_id IS NULL THEN RETURN; END IF;

  SELECT p.id, p.name, p.stock_grade, p.group_id,
         (COALESCE(p.sole_classification::text, '') = 'palmilha_pronta')
    INTO target_product_id, target_name, v_stock_grade, v_product_group_id, v_is_palmilha_pronta
    FROM public.products p
   WHERE p.id = v_resolved_product_id AND p.active = true
   FOR UPDATE;
  IF target_product_id IS NULL THEN RETURN; END IF;

  v_effective_color := COALESCE(NULLIF(v_resolved_color, ''), p_color, '');
  -- Palmilha pronta: a cor efetiva já vem resolvida pela conjugação (P0);
  -- guardamos pra manter a descrição "-> Palmilha: X" e o metadata.
  IF v_is_palmilha_pronta THEN v_palmilha_color := NULLIF(v_effective_color, ''); END IF;

  IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;
  SELECT EXISTS (SELECT 1 FROM public.sole_size_conjugations WHERE sole_group_id = v_product_group_id) INTO v_has_conjugations;
  v_effective_grade := '{}'::jsonb;
  FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_input_grade) WHERE value::numeric > 0 AND left(key, 1) <> '_'
  LOOP
    IF v_size LIKE '%/%' THEN v_conj_key := v_size;
    ELSIF v_has_conjugations AND v_product_group_id IS NOT NULL THEN
      SELECT public.get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
      IF v_conj_key IS NULL THEN v_conj_key := v_size; END IF;
    ELSE v_conj_key := v_size; END IF;
    v_existing_qty := COALESCE((v_effective_grade ->> v_conj_key)::numeric, 0);
    v_effective_grade := jsonb_set(v_effective_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
    v_grade_total_units := v_grade_total_units + v_size_qty;
  END LOOP;

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

    -- Consome UMA reserva alvo (preferindo sole_grade; senão a pendência
    -- sole_pending_grade). Antes o UPDATE era amplo (todas as reserved do
    -- produto) — se coexistissem sole_grade + pendência, ambas viravam
    -- consumed com o MESMO debitado e o estorno creditaria em dobro.
    -- O kind é normalizado pra 'sole_grade' pra manter a simetria do
    -- estorno (restore_sole_grade_for_order filtra kind='sole_grade').
    SELECT mr.id INTO v_res_id
      FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id AND mr.product_id = target_product_id AND mr.status = 'reserved'
       AND COALESCE(mr.metadata ->> 'kind', '') IN ('sole_grade', 'sole_pending_grade')
     ORDER BY (CASE WHEN mr.metadata ->> 'kind' = 'sole_grade' THEN 0 ELSE 1 END), mr.created_at, mr.id
     LIMIT 1
     FOR UPDATE;
    IF v_res_id IS NOT NULL THEN
      UPDATE public.material_reservations
         SET status = 'consumed', quantity_reserved = v_total_debited, quantity_consumed = v_total_debited, reservation_type = 'hard',
             metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{effective_grade}', v_debited_grade)
                        || jsonb_build_object('kind', 'sole_grade')
                        || CASE WHEN v_shortfall_total > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END,
             updated_at = now()
       WHERE id = v_res_id;
    ELSE
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, target_product_id, v_total_debited, v_total_debited, 'consumed', 'hard',
        jsonb_build_object('kind', 'sole_grade', 'effective_grade', v_debited_grade, 'color', p_color,
          'effective_color', v_effective_color, 'palmilha_color', v_palmilha_color,
          'is_palmilha_pronta', v_is_palmilha_pronta, 'target_name', target_name)
        || CASE WHEN v_shortfall_total > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END);
    END IF;

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
$function$
;

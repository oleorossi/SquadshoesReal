-- ============================================================================
-- 20260902140000_sole-resolution-unified.sql
-- Auditoria dos motores de consumo/débito (2026-07-01) — solado unificado
--
-- ACHADO (a) ALTA — debit_sole_stock_by_grade tinha resolução PRÓPRIA de
--   produto-solado com prioridade INVERTIDA vs resolve_sole_color: consultava
--   o mapping explícito (technical_sheet_sole_colors) ANTES das conjugações
--   P0 (sole_color_conjugations), match UPPER(TRIM) SEM unaccent, LIMIT 1 sem
--   ORDER BY, e fallback final ORDER BY updated_at DESC que pegava QUALQUER
--   cor do grupo. Efeito vivo: 72 pares (3 reservas × 24, PV-2026-00097)
--   reservados no produto INFANTIL CARAMELO errado (206eced8…, estoque 0) em
--   vez do canônico (bc72840a…, estoque 80).
--   FIX: a resolução interna vira UMA chamada a resolve_sole_color(sheet,
--   cor) — cascata canônica P0 conjugação → mapping explícito → grupo+cor,
--   accent-insensitive, sem fallback de cor aleatória. Se não resolver,
--   NÃO debita (mesma filosofia do hybrid_debit: nunca baixar cor errada).
--   O resto do débito (LEAST parcial por tamanho, numerações conjugadas,
--   reserva consumida só com o grade debitado + pendência do shortfall,
--   sync_product_reserved_stock) fica intacto.
--
-- ACHADO (b) BAIXA — scale_grade_to_total só escalava PARA CIMA (guard
--   "v_sum >= p_total ⇒ retorna o grade cru"). O lado TS
--   (scaleGradeWithLargestRemainder, src/lib/scaleGrade.ts) escala nos dois
--   sentidos. FIX: o guard passa a devolver o grade cru apenas quando
--   v_sum = p_total; o algoritmo de largest remainder já preserva
--   soma = round(p_total) em ambos os sentidos (Σfloor ≤ p_total sempre).
--
-- ACHADO (c) MÉDIA — convert_reservation_to_out CANCELAVA pendência
--   'sole_pending_grade' remanescente em silêncio ("orphan"), sem debitar
--   nem registrar shortfall. Caso vivo: OP-2026-01077 (1104 pares) e
--   OP-2026-01078 (780 pares) do PV-00144, finalizadas em 27/06/2026 com o
--   solado jamais debitado. (O achado citava "PV-00145 / 2.208 pares";
--   a evidência no banco aponta PV-00144 / 1.884 pares — o PV-00145 tem
--   OPs SEM nenhuma reserva, fenômeno do achado (a), reportado à parte.)
--   FIX: quando a pendência é o ÚNICO rastro do solado na OP (não existe
--   reserva sole_grade reserved/consumed/converted), tenta o débito
--   canônico by-grade (debit_sole_stock_by_grade hard) antes de encerrar;
--   o que não der pra baixar é anotado em orders.notes no mesmo padrão de
--   aviso do débito parcial ("⚠ … — reconciliar ao repor estoque").
--   Se já existe reserva sole_grade, a pendência continua sendo cancelada
--   como órfã redundante (comportamento atual, correto — evita duplo débito).
--
-- REPAIR (d) — no fim do arquivo, em blocos separados e idempotentes:
--   d1. move reservas VIVAS de solado que apontam pra produto divergente do
--       canônico (resolve_sole_color) pro produto certo + resync de
--       reserved_stock nos afetados (caso vivo: os 72 pares acima);
--   d2. re-anota o shortfall nas OPs cuja pendência de solado foi cancelada
--       em silêncio pelo convert antigo (marker
--       '[cancelled at convert: orphan sole_pending_grade]').
--
-- Base das edições: pg_get_functiondef do banco VIVO (ssvxfoybzmjlypnipqzn),
-- lido em 2026-07-02 — NÃO os arquivos de migration antigos (o banco divergiu).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (b) scale_grade_to_total — escala nos DOIS sentidos (largest remainder)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scale_grade_to_total(p_grade jsonb, p_total numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_sum numeric := 0; v_out jsonb := '{}'::jsonb; v_k text; v_v numeric;
  v_floor bigint; v_scaled_sum bigint := 0; v_diff integer; v_rec record;
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' OR p_total IS NULL OR p_total <= 0 THEN
    RETURN p_grade;
  END IF;
  SELECT COALESCE(SUM((value)::numeric), 0) INTO v_sum
    FROM jsonb_each_text(p_grade)
   WHERE left(key, 1) <> '_' AND value ~ '^[0-9.]+$';
  -- ACHADO (b): antes o guard era "v_sum >= p_total" — grade cuja soma
  -- EXCEDIA o total voltava crua (só escalava pra cima). Agora só o caso
  -- exato v_sum = p_total volta intacto; qualquer divergência escala nos
  -- dois sentidos, espelhando scaleGradeWithLargestRemainder (TS).
  IF v_sum <= 0 OR v_sum = p_total THEN
    RETURN p_grade;
  END IF;
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO v_out
    FROM jsonb_each(p_grade) WHERE left(key, 1) = '_';
  FOR v_k, v_v IN
    SELECT key, (value)::numeric FROM jsonb_each_text(p_grade)
     WHERE left(key, 1) <> '_' AND value ~ '^[0-9.]+$' AND (value)::numeric > 0
  LOOP
    v_floor := floor(v_v * p_total / v_sum)::bigint;
    v_out := jsonb_set(v_out, ARRAY[v_k], to_jsonb(v_floor));
    v_scaled_sum := v_scaled_sum + v_floor;
  END LOOP;
  -- Largest remainder: Σfloor(x·total/sum) ≤ round(total) vale tanto na
  -- escala pra cima quanto pra baixo ⇒ v_diff ≥ 0 e o loop abaixo cobre
  -- os dois sentidos sem mudança.
  v_diff := round(p_total)::integer - v_scaled_sum::integer;
  FOR v_rec IN
    SELECT key AS k,
           ((value)::numeric * p_total / v_sum) - floor((value)::numeric * p_total / v_sum) AS frac
      FROM jsonb_each_text(p_grade)
     WHERE left(key, 1) <> '_' AND value ~ '^[0-9.]+$' AND (value)::numeric > 0
     ORDER BY frac DESC, key
  LOOP
    EXIT WHEN v_diff <= 0;
    v_out := jsonb_set(v_out, ARRAY[v_rec.k], to_jsonb(COALESCE((v_out ->> v_rec.k)::bigint, 0) + 1));
    v_diff := v_diff - 1;
  END LOOP;
  RETURN v_out;
END;
$function$;

-- ----------------------------------------------------------------------------
-- (a) debit_sole_stock_by_grade — resolução canônica via resolve_sole_color
-- ----------------------------------------------------------------------------
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
         (COALESCE(p.sole_classification, '') = 'palmilha_pronta')
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
$function$;

-- ----------------------------------------------------------------------------
-- (c) convert_reservation_to_out — pendência de solado tenta débito by-grade
--     antes de encerrar; shortfall anotado em orders.notes
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_reservation_to_out(p_order_id uuid, p_product_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res RECORD; v_kind text; v_size text; v_size_qty numeric; v_available numeric; v_debit_size numeric;
  v_stock_grade jsonb; v_new_grade jsonb; v_debited_grade jsonb; v_shortfall_grade jsonb;
  v_total_debited numeric; v_shortfall_total numeric; v_prev_total numeric; v_prev_qty numeric;
  v_target_name text; v_effective_grade jsonb; v_debit numeric; v_synced uuid[] := '{}';
  v_op_ref uuid; v_op_color text; v_op_grade jsonb;
  v_before_debited numeric; v_after_debited numeric; v_pend_debited numeric; v_pend_shortfall numeric;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied: usuário não aprovado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('convert_reservation:' || p_order_id::text));
  FOR v_res IN
    SELECT * FROM public.material_reservations
     WHERE order_id = p_order_id AND (p_product_id IS NULL OR product_id = p_product_id) AND status = 'reserved'
     ORDER BY (CASE WHEN (metadata->>'kind') = 'sole_grade' THEN 0 ELSE 1 END), created_at, id
     FOR UPDATE
  LOOP
    v_kind := COALESCE(v_res.metadata ->> 'kind', 'component');
    IF v_kind = 'sole_grade' THEN
      v_effective_grade := v_res.metadata -> 'effective_grade';
      IF v_effective_grade IS NULL OR jsonb_typeof(v_effective_grade) <> 'object' THEN
        UPDATE public.material_reservations SET status = 'cancelled', updated_at = now() WHERE id = v_res.id; CONTINUE;
      END IF;
      SELECT stock_grade, quantity, name INTO v_stock_grade, v_prev_qty, v_target_name
        FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;
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
      IF v_total_debited <= 0 THEN CONTINUE; END IF;
      UPDATE public.products SET stock_grade = v_new_grade, quantity = GREATEST(0, quantity - v_total_debited), updated_at = now()
       WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_res.product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
              'Conversão Solado por grade' || CASE WHEN v_shortfall_total > 0 THEN ' (parcial)' ELSE '' END
              || ' (' || COALESCE(v_target_name, '') || ')', p_order_id);
      UPDATE public.material_reservations
         SET status = 'converted', quantity_reserved = v_total_debited, quantity_consumed = v_total_debited,
             metadata = jsonb_set(metadata, '{effective_grade}', v_debited_grade)
                        || CASE WHEN v_shortfall_total > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END,
             updated_at = now()
       WHERE id = v_res.id;
      IF v_shortfall_total > 0 THEN
        INSERT INTO public.material_reservations
          (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, metadata, notes)
        VALUES (v_res.order_id, v_res.product_id, v_shortfall_total, 0, 'reserved',
          COALESCE(v_res.reservation_type, 'soft'), COALESCE(v_res.source, 'onhand'),
          jsonb_set(v_res.metadata, '{effective_grade}', v_shortfall_grade)
            || jsonb_build_object('partial_pending', true, 'partial_of', v_res.id::text),
          '⚠ Saldo de baixa parcial (solado em falta) — reconciliar ao repor estoque');
      END IF;
      IF NOT (v_res.product_id = ANY(v_synced)) THEN v_synced := v_synced || v_res.product_id; END IF;
    ELSIF v_kind = 'sole_pending_grade' THEN
      -- ACHADO (c): antes, TODA pendência era cancelada em silêncio como
      -- "orphan" — sem debitar e sem registrar shortfall (caso vivo:
      -- OP-2026-01077/01078, PV-00144, 1.884 pares finalizados sem baixa).
      IF EXISTS (
        SELECT 1 FROM public.material_reservations mr2
         WHERE mr2.order_id = p_order_id AND mr2.id <> v_res.id
           AND (mr2.metadata ->> 'kind') = 'sole_grade'
           AND mr2.status IN ('reserved', 'consumed', 'converted')
      ) THEN
        -- Pendência REDUNDANTE: o solado é/foi tratado pela reserva
        -- sole_grade (o ramo acima roda primeiro no ORDER BY do loop).
        -- Cancelar como antes — tentar debitar aqui causaria duplo débito.
        UPDATE public.material_reservations
           SET status = 'cancelled', updated_at = now(),
               notes = COALESCE(NULLIF(notes, ''), '') || ' [cancelled at convert: orphan sole_pending_grade]'
         WHERE id = v_res.id;
      ELSE
        -- Pendência é o ÚNICO rastro do solado: tentar o débito canônico
        -- by-grade (resolve_sole_color + LEAST parcial por tamanho).
        SELECT o.reference_id, o.color, o.grade INTO v_op_ref, v_op_color, v_op_grade
          FROM public.orders o WHERE o.id = p_order_id;
        v_before_debited := COALESCE((
          SELECT SUM(sm.quantity) FROM public.stock_movements sm
           WHERE sm.order_id = p_order_id AND sm.movement_type = 'out'
             AND sm.description LIKE 'Debito Solado por grade%'), 0);
        IF v_op_ref IS NOT NULL AND v_op_grade IS NOT NULL AND jsonb_typeof(v_op_grade) = 'object' THEN
          PERFORM public.debit_sole_stock_by_grade(v_op_ref, p_order_id, COALESCE(v_op_color, ''), v_op_grade, false);
        END IF;
        v_after_debited := COALESCE((
          SELECT SUM(sm.quantity) FROM public.stock_movements sm
           WHERE sm.order_id = p_order_id AND sm.movement_type = 'out'
             AND sm.description LIKE 'Debito Solado por grade%'), 0);
        v_pend_debited := GREATEST(0, v_after_debited - v_before_debited);
        v_pend_shortfall := GREATEST(0, COALESCE(v_res.quantity_reserved, 0) - v_pend_debited);
        -- Se o débito consumiu a própria pendência (produto resolvido = produto
        -- da pendência), ela já saiu de 'reserved' e o UPDATE abaixo é no-op.
        UPDATE public.material_reservations
           SET status = 'cancelled', updated_at = now(),
               notes = COALESCE(NULLIF(notes, ''), '') ||
                 CASE WHEN v_pend_debited > 0
                   THEN ' [convert: débito by-grade executado no produto canônico — pendência substituída]'
                   ELSE ' [cancelled at convert: sole_pending_grade sem baixa (sem estoque ou produto não resolvido)]'
                 END
         WHERE id = v_res.id AND status = 'reserved';
        IF v_pend_shortfall > 0 THEN
          SELECT p.name INTO v_target_name FROM public.products WHERE id = v_res.product_id;
          -- Mesmo padrão de aviso do débito parcial de solado, agora na OP.
          UPDATE public.orders
             SET notes = COALESCE(NULLIF(notes, '') || E'\n', '')
                 || '⚠ Solado em falta na conversão: ' || round(v_pend_shortfall)::text
                 || ' de ' || round(COALESCE(v_res.quantity_reserved, 0))::text
                 || ' pares sem baixa (' || COALESCE(v_target_name, 'Solado')
                 || ') — reconciliar ao repor estoque'
           WHERE id = p_order_id;
        END IF;
        IF NOT (v_res.product_id = ANY(v_synced)) THEN v_synced := v_synced || v_res.product_id; END IF;
      END IF;
    ELSE
      SELECT quantity, name INTO v_prev_qty, v_target_name FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      v_debit := LEAST(COALESCE(v_res.quantity_reserved, 0), GREATEST(0, COALESCE(v_prev_qty, 0)));
      IF v_debit > 0 THEN
        UPDATE public.products SET quantity = quantity - v_debit, updated_at = now() WHERE id = v_res.product_id;
        INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
        VALUES (v_res.product_id, 'out', v_debit, v_prev_qty, v_prev_qty - v_debit,
                'Conversão ' || COALESCE(v_res.metadata ->> 'component', 'Material') || ' (' || COALESCE(v_target_name, '') || ')', p_order_id);
      END IF;
      UPDATE public.material_reservations
         SET status = 'converted', quantity_consumed = COALESCE(quantity_reserved, 0), updated_at = now()
       WHERE id = v_res.id;
    END IF;
  END LOOP;
  PERFORM public.sync_product_reserved_stock(pid) FROM unnest(v_synced) AS pid;
END;
$function$;

-- ============================================================================
-- REPAIR (d) — blocos idempotentes, WHERE estrito
-- ============================================================================

-- ----------------------------------------------------------------------------
-- d1. Re-resolve reservas VIVAS de solado que apontam pra produto divergente
--     do canônico (resolve_sole_color) e move pro produto certo.
--     Caso vivo verificado (2026-07-02): 3 reservas 'sole_grade' × 24 pares
--     (OP-2026-00784/785/786, PV-2026-00097) presas no INFANTIL CARAMELO
--     zerado 206eced8… em vez do canônico bc72840a… (mesmo grupo).
--     Só move dentro do MESMO grupo (keys do effective_grade continuam
--     válidas p/ conjugações de numeração) e só reservas 100% não consumidas.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_row RECORD;
  v_affected uuid[] := '{}';
BEGIN
  FOR v_row IN
    SELECT mr.id AS reservation_id, mr.product_id AS old_product_id,
           rsc.sole_product_id AS new_product_id, cp.name AS new_name
      FROM public.material_reservations mr
      JOIN public.orders o ON o.id = mr.order_id
      JOIN public.products oldp ON oldp.id = mr.product_id
      CROSS JOIN LATERAL public.resolve_sole_color(o.reference_id, o.color) rsc
      JOIN public.products cp ON cp.id = rsc.sole_product_id
     WHERE mr.status = 'reserved'
       AND (mr.metadata ->> 'kind') = 'sole_grade'
       AND COALESCE(mr.quantity_consumed, 0) = 0
       AND rsc.sole_product_id IS NOT NULL
       AND mr.product_id <> rsc.sole_product_id
       AND oldp.group_id = cp.group_id
     FOR UPDATE OF mr
  LOOP
    UPDATE public.material_reservations
       SET product_id = v_row.new_product_id,
           metadata = metadata || jsonb_build_object(
             'target_name', v_row.new_name,
             'resolution_repair', jsonb_build_object(
               'from_product_id', v_row.old_product_id::text,
               'repaired_at', now()::text,
               'reason', 'reserva apontava pra produto divergente do canônico resolve_sole_color (achado a, migration 20260902140000)')),
           updated_at = now()
     WHERE id = v_row.reservation_id;

    IF NOT (v_row.old_product_id = ANY(v_affected)) THEN v_affected := v_affected || v_row.old_product_id; END IF;
    IF NOT (v_row.new_product_id = ANY(v_affected)) THEN v_affected := v_affected || v_row.new_product_id; END IF;

    RAISE NOTICE 'Repair d1: reserva % movida de % para % (%)',
      v_row.reservation_id, v_row.old_product_id, v_row.new_product_id, v_row.new_name;
  END LOOP;

  -- Resync do reserved_stock nos produtos afetados (fonte única de sync).
  PERFORM public.sync_product_reserved_stock(pid) FROM unnest(v_affected) AS pid;
END $$;

-- ----------------------------------------------------------------------------
-- d2. Re-anota o shortfall nas OPs cuja pendência de solado foi cancelada em
--     silêncio pelo convert antigo (marker exato do cancelamento órfão) e cujo
--     solado NUNCA foi debitado por nenhuma via.
--     ⚠ Evidência viva (2026-07-02): o achado citava "PV-00145 / 2.208 pares",
--     mas as pendências canceladas no banco são do PV-00144 — OP-2026-01077
--     (1.104 pares) + OP-2026-01078 (780 pares) = 1.884 pares, canceladas em
--     27/06/2026. O bloco é dirigido pelo marker, então anota as OPs REAIS.
--     (As OPs do PV-00145 não têm NENHUMA reserva — fenômeno do achado (a),
--     fora do escopo deste repair.)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_row RECORD;
  v_msg text;
BEGIN
  FOR v_row IN
    SELECT o.id AS order_id, o.order_number, mr.quantity_reserved,
           p.name AS product_name, pgr.name AS group_name,
           to_char(mr.updated_at, 'DD/MM/YYYY') AS cancelled_on
      FROM public.material_reservations mr
      JOIN public.orders o ON o.id = mr.order_id
      JOIN public.products p ON p.id = mr.product_id
      LEFT JOIN public.product_groups pgr ON pgr.id = p.group_id
     WHERE mr.status = 'cancelled'
       AND (mr.metadata ->> 'kind') = 'sole_pending_grade'
       AND COALESCE(mr.quantity_consumed, 0) = 0
       AND mr.notes LIKE '%[cancelled at convert: orphan sole_pending_grade]%'
       -- solado nunca debitado por outra via (reserva ou movimento):
       AND NOT EXISTS (
             SELECT 1 FROM public.material_reservations mr2
              WHERE mr2.order_id = mr.order_id
                AND (mr2.metadata ->> 'kind') = 'sole_grade'
                AND mr2.status IN ('consumed', 'converted'))
       AND NOT EXISTS (
             SELECT 1 FROM public.stock_movements sm
              WHERE sm.order_id = mr.order_id AND sm.movement_type = 'out'
                AND (sm.description LIKE 'Debito Solado por grade%'
                  OR sm.description LIKE 'Conversão Solado por grade%'
                  OR sm.description LIKE 'Picking Solado por grade%'
                  OR sm.description LIKE 'Picking em massa (PV) — Solado por grade%'))
  LOOP
    v_msg := '⚠ Solado em falta na conversão: ' || round(v_row.quantity_reserved)::text
          || ' de ' || round(v_row.quantity_reserved)::text
          || ' pares sem baixa (' || COALESCE(v_row.group_name, v_row.product_name)
          || ') — pendência cancelada sem débito em ' || v_row.cancelled_on
          || '; reconciliar ao repor estoque';

    UPDATE public.orders o
       SET notes = COALESCE(NULLIF(o.notes, '') || E'\n', '') || v_msg
     WHERE o.id = v_row.order_id
       AND (o.notes IS NULL OR o.notes NOT LIKE '%Solado em falta na conversão%');

    IF FOUND THEN
      RAISE NOTICE 'Repair d2: OP % anotada — % pares de solado sem baixa', v_row.order_number, v_row.quantity_reserved;
    END IF;
  END LOOP;
END $$;

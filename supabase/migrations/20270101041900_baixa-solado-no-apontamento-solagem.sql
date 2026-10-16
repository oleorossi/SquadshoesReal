-- Baixa automática de solado ao apontar Solagem (qtd apontada).
--
-- Decisão do dono (2026-10-16):
--   1) Entrada em produção = só reserva (soft) — já é assim.
--   2) Baixa física = ao apontar/concluir Solagem (quantidade apontada)
--      OU quando o PV vai a Faturado (convert_reservation_to_out já existente).
--   3) Os dois caminhos são idempotentes: só tocam status='reserved'.
--   4) Sem estoque na numeração → LEAST + pending_reconciliation (não bloqueia).
--
-- Por que trigger em production_pointings:
--   execute_production_pointing_command é recriado com frequência; o INSERT no
--   ledger é o fato físico estável do apontamento (mesmo padrão do
--   trg_promote_op_on_first_pointing).

-- ---------------------------------------------------------------------------
-- 1. Helper: fatia proporcional da grade (método do maior resto)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sole_grade_take_pairs(
  p_grade jsonb,
  p_pairs numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := 0;
  v_target numeric;
  v_key text;
  v_qty numeric;
  v_base numeric;
  v_frac numeric;
  v_sum_base numeric := 0;
  v_out jsonb := '{}'::jsonb;
  v_parts jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_remain integer;
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' OR COALESCE(p_pairs, 0) <= 0 THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR v_key, v_qty IN
    SELECT g.key, g.value::numeric
      FROM jsonb_each_text(p_grade) AS g(key, value)
     WHERE left(g.key, 1) <> '_'
       AND g.value ~ '^-?[0-9]+(\.[0-9]+)?$'
       AND g.value::numeric > 0
  LOOP
    v_total := v_total + v_qty;
  END LOOP;

  IF v_total <= 0 THEN
    RETURN '{}'::jsonb;
  END IF;

  v_target := LEAST(p_pairs, v_total);

  -- Caso trivial: pega tudo.
  IF v_target >= v_total THEN
    FOR v_key, v_qty IN
      SELECT g.key, g.value::numeric
        FROM jsonb_each_text(p_grade) AS g(key, value)
       WHERE left(g.key, 1) <> '_'
         AND g.value ~ '^-?[0-9]+(\.[0-9]+)?$'
         AND g.value::numeric > 0
    LOOP
      v_out := jsonb_set(v_out, ARRAY[v_key], to_jsonb(v_qty));
    END LOOP;
    RETURN v_out;
  END IF;

  FOR v_key, v_qty IN
    SELECT g.key, g.value::numeric
      FROM jsonb_each_text(p_grade) AS g(key, value)
     WHERE left(g.key, 1) <> '_'
       AND g.value ~ '^-?[0-9]+(\.[0-9]+)?$'
       AND g.value::numeric > 0
  LOOP
    v_base := floor((v_qty * v_target) / v_total);
    v_frac := ((v_qty * v_target) / v_total) - v_base;
    v_sum_base := v_sum_base + v_base;
    v_parts := v_parts || jsonb_build_array(
      jsonb_build_object('k', v_key, 'base', v_base, 'frac', v_frac, 'need', v_qty)
    );
    IF v_base > 0 THEN
      v_out := jsonb_set(v_out, ARRAY[v_key], to_jsonb(v_base));
    END IF;
  END LOOP;

  v_remain := greatest(0, round(v_target - v_sum_base)::integer);

  FOR v_elem IN
    SELECT value
      FROM jsonb_array_elements(v_parts) AS t(value)
     ORDER BY (value->>'frac')::numeric DESC, value->>'k'
  LOOP
    EXIT WHEN v_remain <= 0;
    v_key := v_elem->>'k';
    v_qty := COALESCE((v_out ->> v_key)::numeric, 0);
    IF v_qty < (v_elem->>'need')::numeric THEN
      v_out := jsonb_set(v_out, ARRAY[v_key], to_jsonb(v_qty + 1));
      v_remain := v_remain - 1;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.sole_grade_take_pairs(jsonb, numeric) IS
  'Fatia proporcional de uma grade de solado até p_pairs (maior resto). Usada na baixa por apontamento de Solagem.';

REVOKE ALL ON FUNCTION public.sole_grade_take_pairs(jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sole_grade_take_pairs(jsonb, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Baixa física por numeração, até N pares, só em sole_grade reserved
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.debit_sole_grade_for_solagem_pointing(
  p_order_id uuid,
  p_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res record;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_effective_grade jsonb;
  v_take_grade jsonb;
  v_remaining_grade jsonb;
  v_debited_grade jsonb;
  v_shortfall_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_debit_size numeric;
  v_total_debited numeric;
  v_shortfall_total numeric;
  v_prev_total numeric;
  v_prev_qty numeric;
  v_target_name text;
  v_remaining_total numeric;
  v_left_to_take numeric;
  v_take_total numeric;
  v_synced uuid[] := '{}';
  v_debited_count integer := 0;
  v_pending_count integer := 0;
  v_debited_pairs numeric := 0;
BEGIN
  IF p_order_id IS NULL OR COALESCE(p_quantity, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'debited_pairs', 0,
      'debited_reservations', 0,
      'pending_reservations', 0,
      'skipped', true
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('stock_debit:' || p_order_id::text));

  v_left_to_take := p_quantity::numeric;

  FOR v_res IN
    SELECT *
      FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id
       AND mr.status = 'reserved'
       AND COALESCE(mr.metadata->>'kind', '') = 'sole_grade'
     ORDER BY mr.created_at, mr.id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left_to_take <= 0;

    v_effective_grade := v_res.metadata -> 'effective_grade';
    IF v_effective_grade IS NULL OR jsonb_typeof(v_effective_grade) <> 'object' THEN
      UPDATE public.material_reservations
         SET status = 'pending_reconciliation',
             updated_at = now(),
             metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object(
                    'partial_pending', true,
                    'pending_reason', 'sole_without_effective_grade',
                    'solagem_pointing', true
                  ),
             notes = COALESCE(NULLIF(notes, ''), '')
               || ' [pendente: solado sem grade efetiva no apontamento Solagem]'
       WHERE id = v_res.id;
      v_pending_count := v_pending_count + 1;
      CONTINUE;
    END IF;

    v_take_grade := public.sole_grade_take_pairs(v_effective_grade, v_left_to_take);
    v_take_total := 0;
    FOR v_size, v_size_qty IN
      SELECT g.key, g.value::numeric
        FROM jsonb_each_text(v_take_grade) AS g(key, value)
       WHERE g.value::numeric > 0
    LOOP
      v_take_total := v_take_total + v_size_qty;
    END LOOP;

    IF v_take_total <= 0 THEN
      CONTINUE;
    END IF;

    -- remaining = effective - take (tamanho a tamanho)
    v_remaining_grade := '{}'::jsonb;
    v_remaining_total := 0;
    FOR v_size, v_size_qty IN
      SELECT g.key, g.value::numeric
        FROM jsonb_each_text(v_effective_grade) AS g(key, value)
       WHERE left(g.key, 1) <> '_'
         AND g.value::numeric > 0
    LOOP
      v_available := GREATEST(v_size_qty - COALESCE((v_take_grade ->> v_size)::numeric, 0), 0);
      IF v_available > 0 THEN
        v_remaining_grade := jsonb_set(v_remaining_grade, ARRAY[v_size], to_jsonb(v_available));
        v_remaining_total := v_remaining_total + v_available;
      END IF;
    END LOOP;

    SELECT p.stock_grade, p.quantity, p.name
      INTO v_stock_grade, v_prev_qty, v_target_name
      FROM public.products p
     WHERE p.id = v_res.product_id
     FOR UPDATE;

    IF NOT FOUND THEN
      UPDATE public.material_reservations
         SET status = 'pending_reconciliation',
             updated_at = now(),
             metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('partial_pending', true, 'pending_reason', 'product_not_found'),
             notes = COALESCE(NULLIF(notes, ''), '')
               || ' [pendente: produto de solado não encontrado no apontamento Solagem]'
       WHERE id = v_res.id;
      v_pending_count := v_pending_count + 1;
      CONTINUE;
    END IF;

    v_stock_grade := COALESCE(v_stock_grade, '{}'::jsonb);
    v_prev_total := 0;
    FOR v_size IN
      SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
    LOOP
      v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    END LOOP;

    v_new_grade := v_stock_grade;
    v_total_debited := 0;
    v_shortfall_total := 0;
    v_debited_grade := '{}'::jsonb;
    v_shortfall_grade := '{}'::jsonb;

    FOR v_size, v_size_qty IN
      SELECT g.key, g.value::numeric
        FROM jsonb_each_text(v_take_grade) AS g(key, value)
       WHERE g.value::numeric > 0
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
        v_shortfall_grade := jsonb_set(
          v_shortfall_grade,
          ARRAY[v_size],
          to_jsonb(v_size_qty - v_debit_size)
        );
      END IF;
    END LOOP;

    -- A fatia apontada sai da reserva restante mesmo quando não há estoque
    -- (vira pending). Assim o Faturado não tenta baixar de novo a mesma fatia.
    IF v_total_debited > 0 THEN
      UPDATE public.products
         SET stock_grade = v_new_grade,
             quantity = GREATEST(0, COALESCE(quantity, 0) - v_total_debited),
             updated_at = now()
       WHERE id = v_res.product_id;

      INSERT INTO public.stock_movements (
        product_id, movement_type, quantity, previous_stock, new_stock,
        description, movement_reason, order_id, material_reservation_id, origin_type
      ) VALUES (
        v_res.product_id,
        'out',
        v_total_debited,
        v_prev_total,
        v_prev_total - v_total_debited,
        'Baixa Solagem — Solado por grade'
          || CASE WHEN v_shortfall_total > 0 THEN ' (parcial)' ELSE '' END
          || ' (' || COALESCE(v_target_name, '') || ')',
        'consumo_op',
        p_order_id,
        v_res.id,
        'production_pointing'
      );

      v_debited_pairs := v_debited_pairs + v_total_debited;
      v_debited_count := v_debited_count + 1;
    END IF;

    IF v_shortfall_total > 0 THEN
      INSERT INTO public.material_reservations (
        order_id, product_id, quantity_reserved, quantity_consumed, status,
        reservation_type, source, metadata, notes, sale_order_id
      ) VALUES (
        v_res.order_id,
        v_res.product_id,
        v_shortfall_total,
        0,
        'pending_reconciliation',
        COALESCE(v_res.reservation_type, 'soft'),
        COALESCE(v_res.source, 'onhand'),
        jsonb_set(COALESCE(v_res.metadata, '{}'::jsonb), '{effective_grade}', v_shortfall_grade)
          || jsonb_build_object(
               'partial_pending', true,
               'partial_of', v_res.id::text,
               'solagem_pointing', true,
               'requires_manual_reconciliation', true,
               'retroactive_debit_forbidden', true
             ),
        'Saldo de baixa parcial na Solagem (solado em falta) — reconciliar ao repor estoque',
        v_res.sale_order_id
      );
      v_pending_count := v_pending_count + 1;
    ELSIF v_total_debited <= 0 THEN
      -- Fatia inteira sem estoque → pendência da fatia apontada.
      INSERT INTO public.material_reservations (
        order_id, product_id, quantity_reserved, quantity_consumed, status,
        reservation_type, source, metadata, notes, sale_order_id
      ) VALUES (
        v_res.order_id,
        v_res.product_id,
        v_take_total,
        0,
        'pending_reconciliation',
        COALESCE(v_res.reservation_type, 'soft'),
        COALESCE(v_res.source, 'onhand'),
        jsonb_set(COALESCE(v_res.metadata, '{}'::jsonb), '{effective_grade}', v_take_grade)
          || jsonb_build_object(
               'partial_pending', true,
               'partial_of', v_res.id::text,
               'solagem_pointing', true,
               'requires_manual_reconciliation', true,
               'retroactive_debit_forbidden', true
             ),
        ' [pendente: sem estoque do solado no apontamento Solagem]',
        v_res.sale_order_id
      );
      v_pending_count := v_pending_count + 1;
    END IF;

    IF v_remaining_total > 0 THEN
      UPDATE public.material_reservations
         SET quantity_reserved = GREATEST(
               0,
               COALESCE(quantity_reserved, 0) - v_total_debited
             ),
             metadata = jsonb_set(
               COALESCE(metadata, '{}'::jsonb),
               '{effective_grade}',
               v_remaining_grade
             ) || jsonb_build_object('last_solagem_debit_at', now()),
             updated_at = now()
       WHERE id = v_res.id;
      -- Realinha covered/short com o físico restante.
      PERFORM public.allocate_sole_grade_reservation(v_res.id);
    ELSE
      IF v_total_debited > 0 THEN
        UPDATE public.material_reservations
           SET status = 'converted',
               reservation_type = 'hard',
               quantity_reserved = v_total_debited,
               quantity_consumed = v_total_debited,
               quantity_short = 0,
               consumed_at = now(),
               updated_at = now(),
               metadata = jsonb_set(
                 COALESCE(metadata, '{}'::jsonb),
                 '{effective_grade}',
                 v_debited_grade
               ) || jsonb_build_object(
                 'solagem_pointing', true,
                 'settled_on', 'solagem_pointing'
               )
         WHERE id = v_res.id;
      ELSE
        -- Nada debitado e nada restante na reserva original → encerra a linha
        -- (a fatia foi para pending acima).
        UPDATE public.material_reservations
           SET status = 'cancelled',
               updated_at = now(),
               quantity_short = 0,
               notes = COALESCE(NULLIF(notes, ''), '')
                 || ' [auto-cancelled: fatia Solagem sem estoque virou pending]',
               metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object('solagem_pointing', true)
         WHERE id = v_res.id;
      END IF;
    END IF;

    v_left_to_take := v_left_to_take - v_take_total;

    IF NOT (v_res.product_id = ANY(v_synced)) THEN
      v_synced := v_synced || v_res.product_id;
    END IF;
  END LOOP;

  BEGIN
    PERFORM public.sync_product_reserved_stock(pid)
      FROM unnest(v_synced) AS pid;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      '[debit_sole_grade_for_solagem_pointing] sync reserved_stock falhou OP %: %',
      p_order_id, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'requested_pairs', p_quantity,
    'debited_pairs', v_debited_pairs,
    'debited_reservations', v_debited_count,
    'pending_reservations', v_pending_count,
    'remaining_request', greatest(v_left_to_take, 0)
  );
END;
$function$;

COMMENT ON FUNCTION public.debit_sole_grade_for_solagem_pointing(uuid, integer) IS
  'Baixa solado por numeração até p_quantity pares a partir de reservas sole_grade reserved. Idempotente com Faturado/settle (só toca reserved).';

REVOKE ALL ON FUNCTION public.debit_sole_grade_for_solagem_pointing(uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debit_sole_grade_for_solagem_pointing(uuid, integer)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Trigger: apontamento Solagem com qty > 0 → baixa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_debit_sole_on_solagem_pointing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stage text;
BEGIN
  IF NEW.order_id IS NULL OR COALESCE(NEW.quantity, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_stage := public.canonical_stage_name(NEW.stage_name);
  IF v_stage IS DISTINCT FROM 'Solagem' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.debit_sole_grade_for_solagem_pointing(NEW.order_id, NEW.quantity);
  EXCEPTION WHEN OTHERS THEN
    -- Não impede o apontamento do chão de fábrica; a pendência/alarme cobre.
    BEGIN
      PERFORM public.record_op_reserve_failure_alert(
        NEW.order_id,
        'Baixa de solado na Solagem falhou: ' || SQLERRM,
        'solagem_sole_debit_falhou',
        'critical'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[tg_debit_sole_on_solagem_pointing] alerta também falhou OP %: %',
        NEW.order_id, SQLERRM;
    END;
    RAISE WARNING
      '[tg_debit_sole_on_solagem_pointing] OP % Solagem qty=% falhou: %',
      NEW.order_id, NEW.quantity, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_debit_sole_on_solagem_pointing ON public.production_pointings;
CREATE TRIGGER trg_debit_sole_on_solagem_pointing
  AFTER INSERT ON public.production_pointings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_debit_sole_on_solagem_pointing();

COMMENT ON FUNCTION public.tg_debit_sole_on_solagem_pointing() IS
  'Após apontamento em Solagem (qty>0), baixa solado reserved por numeração até a qtd apontada.';

REVOKE ALL ON FUNCTION public.tg_debit_sole_on_solagem_pointing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_debit_sole_on_solagem_pointing() TO authenticated, service_role;

-- Fix: convert_reservation_to_out abortava o faturamento com
--   "missing FROM-clause entry for table \"p\""
--
-- Causa: no ramo 'sole_pending_grade', quando havia FALTA de solado
-- (v_pend_shortfall > 0), a função montava o aviso de pendência lendo o nome
-- do produto com `SELECT p.name ... FROM public.products` — mas `products`
-- NÃO está aliasado como `p`. Todos os outros SELECTs de products na função
-- usam a forma sem alias (`SELECT name INTO ...`). Esse era o único ponto
-- com o alias fantasma.
--
-- Sintoma em produção: qualquer PV com OP em 'Reservado' carregando uma
-- reserva `sole_pending_grade` sem estoque de solado suficiente falhava ao ir
-- para 'Faturado' (o trigger finalize_orders_on_sale_order_billed chama
-- convert_reservation_to_out em cada OP). Ex.: PV-00146 / OP-2026-01167
-- (1248 pares de solado sem lastro).
--
-- Fix cirúrgico: `SELECT p.name` -> `SELECT name`. Nenhuma outra mudança de
-- comportamento — o caminho corrigido apenas volta a fazer o que sempre
-- deveria (anotar a falta na OP e finalizar).

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
  v_comp_shortfall numeric; v_msg text;
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
      IF EXISTS (
        SELECT 1 FROM public.material_reservations mr2
         WHERE mr2.order_id = p_order_id AND mr2.id <> v_res.id
           AND (mr2.metadata ->> 'kind') = 'sole_grade'
           AND mr2.status IN ('reserved', 'consumed', 'converted')
      ) THEN
        UPDATE public.material_reservations
           SET status = 'cancelled', updated_at = now(),
               notes = COALESCE(NULLIF(notes, ''), '') || ' [cancelled at convert: orphan sole_pending_grade]'
         WHERE id = v_res.id;
      ELSE
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
        UPDATE public.material_reservations
           SET status = 'cancelled', updated_at = now(),
               notes = COALESCE(NULLIF(notes, ''), '') ||
                 CASE WHEN v_pend_debited > 0
                   THEN ' [convert: débito by-grade executado no produto canônico — pendência substituída]'
                   ELSE ' [cancelled at convert: sole_pending_grade sem baixa (sem estoque ou produto não resolvido)]'
                 END
         WHERE id = v_res.id AND status = 'reserved';
        IF v_pend_shortfall > 0 THEN
          -- FIX (missing FROM-clause entry for table "p"): products não está
          -- aliasado como p aqui — usar a forma sem alias como no resto da fn.
          SELECT name INTO v_target_name FROM public.products WHERE id = v_res.product_id;
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
      -- Componente/tira genérico. FIX DEB-1/RES-2 (auditoria 2026-07-19):
      -- antes, debitava LEAST(estoque, reserva) mas gravava quantity_consumed =
      -- reserva CHEIA — sem shortfall, sem aviso. Agora espelha o ramo
      -- sole_grade: consumed = debitado real, flag partial_debit, linha de
      -- shortfall 'reserved' (reconciliável ao repor) e aviso na OP.
      SELECT quantity, name INTO v_prev_qty, v_target_name FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      v_debit := LEAST(COALESCE(v_res.quantity_reserved, 0), GREATEST(0, COALESCE(v_prev_qty, 0)));
      v_comp_shortfall := GREATEST(0, COALESCE(v_res.quantity_reserved, 0) - v_debit);
      IF v_debit <= 0 THEN
        v_msg := '⚠ Componente sem estoque na conversão: ' || COALESCE(v_target_name, v_res.product_id::text)
                 || ' (' || round(COALESCE(v_res.quantity_reserved, 0), 2)::text || ' sem baixa)';
        UPDATE public.orders o
           SET notes = COALESCE(NULLIF(o.notes, '') || E'\n', '') || v_msg
         WHERE o.id = p_order_id AND (o.notes IS NULL OR position(v_msg IN o.notes) = 0);
        CONTINUE;
      END IF;
      UPDATE public.products SET quantity = quantity - v_debit, updated_at = now() WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_res.product_id, 'out', v_debit, v_prev_qty, v_prev_qty - v_debit,
              'Conversão ' || COALESCE(v_res.metadata ->> 'component', 'Material')
              || CASE WHEN v_comp_shortfall > 0 THEN ' (parcial)' ELSE '' END
              || ' (' || COALESCE(v_target_name, '') || ')', p_order_id);
      UPDATE public.material_reservations
         SET status = 'converted', quantity_reserved = v_debit, quantity_consumed = v_debit,
             metadata = COALESCE(metadata, '{}'::jsonb)
                        || CASE WHEN v_comp_shortfall > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END,
             updated_at = now()
       WHERE id = v_res.id;
      IF v_comp_shortfall > 0 THEN
        INSERT INTO public.material_reservations
          (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, metadata, notes)
        VALUES (v_res.order_id, v_res.product_id, v_comp_shortfall, 0, 'reserved',
          COALESCE(v_res.reservation_type, 'soft'), COALESCE(v_res.source, 'onhand'),
          COALESCE(v_res.metadata, '{}'::jsonb)
            || jsonb_build_object('partial_pending', true, 'partial_of', v_res.id::text),
          '⚠ Saldo de baixa parcial (componente em falta) — reconciliar ao repor estoque');
        v_msg := '⚠ Componente com baixa PARCIAL na conversão: ' || COALESCE(v_target_name, v_res.product_id::text)
                 || ' (' || round(v_comp_shortfall, 2)::text || ' sem baixa)';
        UPDATE public.orders o
           SET notes = COALESCE(NULLIF(o.notes, '') || E'\n', '') || v_msg
         WHERE o.id = p_order_id AND (o.notes IS NULL OR position(v_msg IN o.notes) = 0);
      END IF;
      IF NOT (v_res.product_id = ANY(v_synced)) THEN v_synced := v_synced || v_res.product_id; END IF;
    END IF;
  END LOOP;
  PERFORM public.sync_product_reserved_stock(pid) FROM unnest(v_synced) AS pid;
END;
$function$;

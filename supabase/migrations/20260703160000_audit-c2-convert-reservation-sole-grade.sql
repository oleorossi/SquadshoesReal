-- =============================================================================
-- AUDITORIA C2 (CRÍTICO): convert_reservation_to_out botava débito PLANO no solado
-- graduado → trigger check_grade_quantity_coherence abortava (SUM(stock_grade)≠qty);
-- no faturamento o erro era engolido (console.warn) → PV faturado, solado NUNCA
-- baixado, reserved_stock inflado e RECEITA SEM LASTRO (ghost revenue). 151 reservas
-- sole_grade abertas; convert nunca rodou com sucesso nesse caminho.
--
-- Fix: reescreve convert_reservation_to_out espelhando a lógica CORRETA de
-- consume_all_reservations_for_order por tipo de reserva — sole_grade debita por
-- TAMANHO (stock_grade + quantity juntos), sole_pending_grade órfão é cancelado, e
-- strap/component fazem débito linear. SEM o bloco de embalagem (convert é chamado
-- também no Corte/ProductionKanban, onde debitar caixa seria prematuro). Mantém o
-- status 'converted', adiciona advisory lock por order_id e is_approved_user().
-- O caller do faturamento (useSaleOrders) passa a PROPAGAR o erro (não engolir).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.convert_reservation_to_out(p_order_id uuid, p_product_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res RECORD;
  v_kind text;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_total_debited numeric;
  v_prev_total numeric;
  v_prev_qty numeric;
  v_target_name text;
  v_effective_grade jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('convert_reservation:' || p_order_id::text));

  FOR v_res IN
    SELECT * FROM public.material_reservations
     WHERE order_id = p_order_id
       AND (p_product_id IS NULL OR product_id = p_product_id)
       AND status = 'reserved'
     ORDER BY (CASE WHEN (metadata->>'kind') = 'sole_grade' THEN 0 ELSE 1 END), created_at, id
     FOR UPDATE
  LOOP
    v_kind := COALESCE(v_res.metadata ->> 'kind', 'component');

    -- ===== sole_grade: débito por TAMANHO (corrige o abort do débito plano) =====
    IF v_kind = 'sole_grade' THEN
      v_effective_grade := v_res.metadata -> 'effective_grade';
      IF v_effective_grade IS NULL OR jsonb_typeof(v_effective_grade) <> 'object' THEN
        -- sem grade resolvida: cancela a reserva (não dá pra debitar por tamanho; não vaza)
        UPDATE public.material_reservations SET status = 'cancelled', updated_at = now() WHERE id = v_res.id;
        CONTINUE;
      END IF;

      SELECT stock_grade, quantity, name INTO v_stock_grade, v_prev_qty, v_target_name
        FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

      v_prev_total := 0;
      FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
      LOOP v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0); END LOOP;

      FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
      LOOP
        v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
        IF v_available < v_size_qty THEN
          RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponível %, necessário %',
            v_target_name, v_size, v_available, v_size_qty;
        END IF;
      END LOOP;

      v_new_grade := v_stock_grade;
      v_total_debited := 0;
      FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
      LOOP
        v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
        v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
        v_total_debited := v_total_debited + v_size_qty;
      END LOOP;

      IF v_total_debited > 0 THEN
        UPDATE public.products
           SET stock_grade = v_new_grade, quantity = GREATEST(0, quantity - v_total_debited), updated_at = now()
         WHERE id = v_res.product_id;
        INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
        VALUES (v_res.product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
                'Conversão Solado por grade (' || COALESCE(v_target_name, '') || ')', p_order_id);
      END IF;
      UPDATE public.material_reservations
         SET status = 'converted', quantity_consumed = COALESCE(quantity_reserved, 0), updated_at = now()
       WHERE id = v_res.id;

    -- ===== sole_pending_grade órfão: cancela (não debita plano) =====
    ELSIF v_kind = 'sole_pending_grade' THEN
      UPDATE public.material_reservations
         SET status = 'cancelled', updated_at = now(),
             notes = COALESCE(NULLIF(notes, ''), '') || ' [cancelled at convert: orphan sole_pending_grade]'
       WHERE id = v_res.id;

    -- ===== strap / component / default: débito linear =====
    ELSE
      SELECT quantity, name INTO v_prev_qty, v_target_name FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      UPDATE public.products
         SET quantity = GREATEST(0, quantity - v_res.quantity_reserved), updated_at = now()
       WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_res.product_id, 'out', v_res.quantity_reserved, v_prev_qty, v_prev_qty - v_res.quantity_reserved,
              'Conversão ' || COALESCE(v_res.metadata ->> 'component', 'Material') || ' (' || COALESCE(v_target_name, '') || ')', p_order_id);
      UPDATE public.material_reservations
         SET status = 'converted', quantity_consumed = COALESCE(quantity_reserved, 0), updated_at = now()
       WHERE id = v_res.id;
    END IF;
  END LOOP;
END;
$function$;

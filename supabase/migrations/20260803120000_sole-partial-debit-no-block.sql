-- ============================================================================
-- BAIXA PARCIAL DE SOLADO (decisão do usuário 2026-06-18)
-- ============================================================================
-- Contexto: PV-00141/00144 não conseguiam baixar/faturar/picking porque o solado
-- "01" CARAMELO tinha menos estoque por TAMANHO do que a demanda (tam 37 = 54 em
-- estoque, OPs pedindo 120/148). NÃO é bug de cálculo/cor (a coligação cabedal→
-- solado em sole_color_conjugations está correta) — é falta real. O usuário pediu:
-- "seguir mesmo assim — baixar o que tem (parcial por tamanho) e marcar o restante
-- como pendente pra reconciliar quando o solado chegar."
--
-- ESCOPO: muda APENAS o ramo sole_grade das DUAS funções que baixam solado por
-- grade. Os ramos linear (strap/component) e sole_pending_grade ficam IDÊNTICOS à
-- produção (não mexer no que não pediram).
--   • convert_reservation_to_out   — faturamento / entrada no Kanban (antes RAISE)
--   • commit_picking_for_sale_order — picking em massa do PV (antes pulava a OP)
--
-- NOVO comportamento do solado (idêntico nas duas):
--   debita LEAST(disponível, necessário) por tamanho. Se sobrar saldo:
--   - a reserva ORIGINAL vira 'converted'/'consumed' guardando SÓ o grade debitado
--     (effective_grade := debited_grade, quantity_reserved=quantity_consumed=debitado).
--     CRÍTICO p/ a SIMETRIA do estorno: restore_sole_grade_for_order credita de volta
--     o effective_grade das reservas consumed/converted — guardar só o que SAIU
--     garante que o cancelamento da OP credite exatamente o debitado (sem fantasma).
--   - o saldo faltante vira uma NOVA reserva 'reserved' (pendente) com
--     effective_grade := shortfall_grade, quantity_consumed=0, partial_pending=true.
--     É reconciliada automaticamente num próximo convert/picking quando o solado
--     chegar (re-processada normalmente; o snapshot do FOR evita reprocesso no mesmo
--     run). Em OP terminal (Faturado/Finalizado), tg_release_reservations_on_order_
--     terminal cancela a pendente (qty_consumed=0, nada a estornar).
--   Se NADA disponível (total_debited=0): não converte, não trava — deixa pendente.
--
-- reserved_stock: recomputado ao final via sync_product_reserved_stock (SUM(reserved-
-- consumed) WHERE status='reserved') por produto afetado — corrige qualquer drift do
-- trigger delta, qualquer que seja sua forma.
--
-- ⚠ ORDENAÇÃO: timestamp > todas as migrations que redefinem estas funções
-- (20260721160000 etc.) e > a última do repo (20260802120000), senão um db push
-- reaplicaria a versão all-or-nothing por cima. Aplicada via MCP em
-- ssvxfoybzmjlypnipqzn; registrar com migration repair antes do 1º db push.
-- ============================================================================

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
  v_debit_size numeric;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_debited_grade jsonb;
  v_shortfall_grade jsonb;
  v_total_debited numeric;
  v_shortfall_total numeric;
  v_prev_total numeric;
  v_prev_qty numeric;
  v_target_name text;
  v_effective_grade jsonb;
  v_debit numeric;
  v_synced uuid[] := '{}';
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

    -- ===== sole_grade: BAIXA PARCIAL por TAMANHO + split do saldo =====
    IF v_kind = 'sole_grade' THEN
      v_effective_grade := v_res.metadata -> 'effective_grade';
      IF v_effective_grade IS NULL OR jsonb_typeof(v_effective_grade) <> 'object' THEN
        UPDATE public.material_reservations SET status = 'cancelled', updated_at = now() WHERE id = v_res.id;
        CONTINUE;
      END IF;

      SELECT stock_grade, quantity, name INTO v_stock_grade, v_prev_qty, v_target_name
        FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

      v_prev_total := 0;
      FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
      LOOP v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0); END LOOP;

      v_new_grade := v_stock_grade;
      v_total_debited := 0;
      v_shortfall_total := 0;
      v_debited_grade := '{}'::jsonb;
      v_shortfall_grade := '{}'::jsonb;
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

      -- Nada disponível: não trava e não converte — deixa pendente p/ reconciliar.
      IF v_total_debited <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE public.products
         SET stock_grade = v_new_grade, quantity = GREATEST(0, quantity - v_total_debited), updated_at = now()
       WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_res.product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
              'Conversão Solado por grade' || CASE WHEN v_shortfall_total > 0 THEN ' (parcial)' ELSE '' END
              || ' (' || COALESCE(v_target_name, '') || ')', p_order_id);

      -- Original guarda SÓ o debitado (estorno credita exatamente o que saiu).
      UPDATE public.material_reservations
         SET status = 'converted',
             quantity_reserved = v_total_debited,
             quantity_consumed = v_total_debited,
             metadata = jsonb_set(metadata, '{effective_grade}', v_debited_grade)
                        || CASE WHEN v_shortfall_total > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END,
             updated_at = now()
       WHERE id = v_res.id;

      -- Saldo faltante → reserva PENDENTE (reconcilia quando o solado chegar).
      IF v_shortfall_total > 0 THEN
        INSERT INTO public.material_reservations
          (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, metadata, notes)
        VALUES (
          v_res.order_id, v_res.product_id, v_shortfall_total, 0, 'reserved',
          COALESCE(v_res.reservation_type, 'soft'), COALESCE(v_res.source, 'onhand'),
          jsonb_set(v_res.metadata, '{effective_grade}', v_shortfall_grade)
            || jsonb_build_object('partial_pending', true, 'partial_of', v_res.id::text),
          '⚠ Saldo de baixa parcial (solado em falta) — reconciliar ao repor estoque'
        );
      END IF;

      IF NOT (v_res.product_id = ANY(v_synced)) THEN v_synced := v_synced || v_res.product_id; END IF;

    -- ===== sole_pending_grade órfão: cancela (idêntico à produção) =====
    ELSIF v_kind = 'sole_pending_grade' THEN
      UPDATE public.material_reservations
         SET status = 'cancelled', updated_at = now(),
             notes = COALESCE(NULLIF(notes, ''), '') || ' [cancelled at convert: orphan sole_pending_grade]'
       WHERE id = v_res.id;

    -- ===== linear (strap/component): IDÊNTICO à produção (M4) =====
    ELSE
      SELECT quantity, name INTO v_prev_qty, v_target_name FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      v_debit := LEAST(COALESCE(v_res.quantity_reserved, 0), GREATEST(0, COALESCE(v_prev_qty, 0)));
      IF v_debit > 0 THEN
        UPDATE public.products
           SET quantity = quantity - v_debit, updated_at = now()
         WHERE id = v_res.product_id;
        INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
        VALUES (v_res.product_id, 'out', v_debit, v_prev_qty, v_prev_qty - v_debit,
                'Conversão ' || COALESCE(v_res.metadata ->> 'component', 'Material') || ' (' || COALESCE(v_target_name, '') || ')', p_order_id);
      END IF;
      UPDATE public.material_reservations
         SET status = 'converted', quantity_consumed = COALESCE(quantity_reserved, 0), updated_at = now()
       WHERE id = v_res.id;
    END IF;
  END LOOP;

  -- Recomputa reserved_stock dos solados afetados (autoritativo, idempotente).
  PERFORM public.sync_product_reserved_stock(pid) FROM unnest(v_synced) AS pid;
END;
$function$;


CREATE OR REPLACE FUNCTION public.commit_picking_for_sale_order(p_sale_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res RECORD;
  v_cur_qty numeric;
  v_picked integer := 0;
  v_skipped integer := 0;
  v_insufficient text[] := '{}';
  v_picked_items jsonb := '[]'::jsonb;
  v_so_exists boolean;
  v_kind text;
  v_effective_grade jsonb;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_debited_grade jsonb;
  v_shortfall_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_debit_size numeric;
  v_total_debited numeric;
  v_shortfall_total numeric;
  v_prev_total numeric;
  v_synced uuid[] := '{}';
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT true INTO v_so_exists
    FROM public.sale_orders
   WHERE id = p_sale_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de Venda não encontrado: %', p_sale_order_id;
  END IF;

  FOR v_res IN
    SELECT mr.id, mr.order_id, mr.product_id, mr.quantity_reserved, mr.reservation_type,
           mr.source, mr.metadata, p.name AS product_name, o.order_number AS op_number
      FROM public.material_reservations mr
      JOIN public.orders   o ON o.id = mr.order_id
      JOIN public.products p ON p.id = mr.product_id
     WHERE o.sale_order_id = p_sale_order_id
       AND mr.status = 'reserved'
     ORDER BY mr.product_id, mr.id
       FOR UPDATE OF mr
  LOOP
    v_kind := COALESCE(v_res.metadata ->> 'kind', 'component');

    -- ===== sole_grade: BAIXA PARCIAL por TAMANHO + split do saldo =====
    IF v_kind = 'sole_grade' THEN
      v_effective_grade := v_res.metadata -> 'effective_grade';
      IF v_effective_grade IS NULL OR jsonb_typeof(v_effective_grade) <> 'object' THEN
        UPDATE public.material_reservations
           SET status = 'cancelled', updated_at = now(),
               notes = COALESCE(NULLIF(notes, ''), '') || ' [cancelled at picking: sole_grade sem effective_grade]'
         WHERE id = v_res.id;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      SELECT stock_grade, quantity INTO v_stock_grade, v_cur_qty
        FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

      v_prev_total := 0;
      FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
      LOOP v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0); END LOOP;

      v_new_grade := v_stock_grade;
      v_total_debited := 0;
      v_shortfall_total := 0;
      v_debited_grade := '{}'::jsonb;
      v_shortfall_grade := '{}'::jsonb;
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
          v_insufficient := v_insufficient ||
            format('%s tam %s: disponível %s · necessário %s',
                   v_res.product_name, v_size, v_available::text, v_size_qty::text);
        END IF;
      END LOOP;

      -- Nada disponível: pula (pendente segue), conta como skip.
      IF v_total_debited <= 0 THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      UPDATE public.products
         SET stock_grade = v_new_grade, quantity = GREATEST(0, quantity - v_total_debited), updated_at = now()
       WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id, user_id)
      VALUES (v_res.product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
              'Picking em massa (PV) — Solado por grade' || CASE WHEN v_shortfall_total > 0 THEN ' (parcial)' ELSE '' END
              || ' — ' || COALESCE(v_res.op_number, ''), v_res.order_id, auth.uid());

      UPDATE public.material_reservations
         SET status = 'consumed',
             quantity_reserved = v_total_debited,
             quantity_consumed = v_total_debited,
             consumed_at = now(),
             reservation_type = 'hard',
             metadata = jsonb_set(metadata, '{effective_grade}', v_debited_grade)
                        || CASE WHEN v_shortfall_total > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END,
             updated_at = now()
       WHERE id = v_res.id;

      IF v_shortfall_total > 0 THEN
        INSERT INTO public.material_reservations
          (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, metadata, notes)
        VALUES (
          v_res.order_id, v_res.product_id, v_shortfall_total, 0, 'reserved',
          COALESCE(v_res.reservation_type, 'soft'), COALESCE(v_res.source, 'onhand'),
          jsonb_set(v_res.metadata, '{effective_grade}', v_shortfall_grade)
            || jsonb_build_object('partial_pending', true, 'partial_of', v_res.id::text),
          '⚠ Saldo de baixa parcial (solado em falta) — reconciliar ao repor estoque'
        );
      END IF;

      IF NOT (v_res.product_id = ANY(v_synced)) THEN v_synced := v_synced || v_res.product_id; END IF;
      v_picked := v_picked + 1;
      v_picked_items := v_picked_items || jsonb_build_object(
        'product_id', v_res.product_id, 'product_name', v_res.product_name,
        'quantity', v_total_debited, 'op', v_res.op_number,
        'partial', v_shortfall_total > 0);
      CONTINUE;
    END IF;

    -- ===== sole_pending_grade órfão: cancela (idêntico à produção) =====
    IF v_kind = 'sole_pending_grade' THEN
      UPDATE public.material_reservations
         SET status = 'cancelled', updated_at = now(),
             notes = COALESCE(NULLIF(notes, ''), '') || ' [cancelled at picking: orphan sole_pending_grade]'
       WHERE id = v_res.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- ===== linear: IDÊNTICO à produção (all-or-nothing) =====
    SELECT quantity INTO v_cur_qty
      FROM public.products
     WHERE id = v_res.product_id
       FOR UPDATE;

    IF v_cur_qty < v_res.quantity_reserved THEN
      v_insufficient := v_insufficient ||
        format('%s: disponível %s · necessário %s',
               v_res.product_name, v_cur_qty::text, v_res.quantity_reserved::text);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE public.products
       SET quantity   = quantity - v_res.quantity_reserved,
           updated_at = now()
     WHERE id = v_res.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock,
      description, order_id, user_id
    ) VALUES (
      v_res.product_id, 'out', v_res.quantity_reserved, v_cur_qty, v_cur_qty - v_res.quantity_reserved,
      'Picking realizado em massa (PV) — ' || COALESCE(v_res.op_number, ''), v_res.order_id, auth.uid()
    );

    UPDATE public.material_reservations
       SET status            = 'consumed',
           quantity_consumed = quantity_reserved,
           consumed_at       = now(),
           reservation_type  = 'hard',
           updated_at        = now()
     WHERE id = v_res.id;

    v_picked := v_picked + 1;
    v_picked_items := v_picked_items || jsonb_build_object(
      'product_id', v_res.product_id, 'product_name', v_res.product_name,
      'quantity', v_res.quantity_reserved, 'op', v_res.op_number);
  END LOOP;

  PERFORM public.sync_product_reserved_stock(pid) FROM unnest(v_synced) AS pid;

  IF v_picked > 0 THEN
    UPDATE public.sale_orders
       SET picking_individually_done_at = now(), updated_at = now()
     WHERE id = p_sale_order_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'picked_count',  v_picked,
    'skipped_count', v_skipped,
    'insufficient',  v_insufficient,
    'picked_items',  v_picked_items,
    'marked_done',   v_picked > 0
  );
END;
$function$;

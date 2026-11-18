-- A entrada do Ateliê (tg_cover_commitments_on_stock_in) grava quantity e
-- current_stock juntas, pelo comando de estoque. A saída que quita o corte
-- ('Ateliê · corte completado pela entrada', consumo_op) e a liberação do kit
-- só faziam quantity = quantity - débito. A tela de estoque e o MRP leem
-- quantity (v_products_list / v_mrp_needs.on_hand). current_stock é a coluna
-- espelho e ficou para trás: no GLOW METALIC + MASSABOX - CHAMPAGNE
-- (657aa32d-e665-4972-8e60-d19ad7841c2b) a entrada 0.24 e a saída 0.24 de
-- 18/11 04:32 deixaram quantity = 0 e current_stock = 0.24.
--
-- O SET usa o quantity antigo nos dois lados, então depois do débito as duas
-- colunas ficam iguais. Só este produto é alinhado agora. Os outros em que
-- quantity <> current_stock e existe movimento deste caminho saem em NOTICE,
-- sem UPDATE.

CREATE OR REPLACE FUNCTION public.apply_atelier_inbound(
  p_product_id uuid,
  p_movement_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phys numeric;
  v_name text;
  v_need record;
  v_donor record;
  v_take numeric;
  v_free numeric;
  v_open numeric;
  v_held numeric;
  v_qty numeric;
  v_consume numeric;
  v_prev numeric;
  v_mov uuid;
  v_res uuid;
  v_lot uuid;
  v_filled int := 0;
  v_stolen int := 0;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'product_null');
  END IF;
  IF public.product_requires_strap_engine_write(p_product_id) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'strap_product');
  END IF;

  SELECT COALESCE(p.quantity, 0), p.name
    INTO v_phys, v_name
    FROM public.products p
   WHERE p.id = p_product_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'product_not_found');
  END IF;

  FOR v_need IN
    SELECT d.id,
           d.sale_order_id,
           d.lot_id,
           d.pending_qty,
           so.order_number,
           public.billing_fortnight_start(public.resolve_billing_week_for_order(d.sale_order_id)) AS fortnight,
           public.commitment_cover_priority(d.sale_order_id) AS prio
      FROM public.cabedal_prep_stock_debits d
      LEFT JOIN public.sale_orders so ON so.id = d.sale_order_id
     WHERE d.product_id = p_product_id
       AND d.sector = 'corte_atelier'
       AND d.pending_qty > 0.0000001
       AND d.lot_id IS NOT NULL
     ORDER BY public.billing_fortnight_start(public.resolve_billing_week_for_order(d.sale_order_id)) NULLS LAST,
              public.commitment_cover_priority(d.sale_order_id),
              d.created_at,
              d.id
     FOR UPDATE OF d
  LOOP
    SELECT mr.id,
           GREATEST(COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0)
      INTO v_res, v_open
      FROM public.material_reservations mr
     WHERE mr.sale_order_id = v_need.sale_order_id
       AND mr.product_id = p_product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep', 'component')
       AND mr.strap_variant_id IS NULL
     ORDER BY mr.created_at
     LIMIT 1
     FOR UPDATE;

    SELECT v_phys - COALESCE(sum(GREATEST(
             COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0
           )), 0)
      INTO v_free
      FROM public.material_reservations mr
     WHERE mr.product_id = p_product_id
       AND mr.status IN ('reserved', 'partially_consumed');
    v_free := GREATEST(COALESCE(v_free, 0), 0) + COALESCE(v_open, 0);

    IF COALESCE(v_open, 0) + v_free < v_need.pending_qty THEN
      FOR v_donor IN
        SELECT mr.id,
               mr.sale_order_id,
               so.order_number,
               GREATEST(COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0) AS open_qty,
               public.billing_fortnight_start(public.resolve_billing_week_for_order(mr.sale_order_id)) AS fortnight,
               public.commitment_cover_priority(mr.sale_order_id) AS prio
          FROM public.material_reservations mr
          LEFT JOIN public.sale_orders so ON so.id = mr.sale_order_id
         WHERE mr.product_id = p_product_id
           AND mr.id IS DISTINCT FROM v_res
           AND mr.status IN ('reserved', 'partially_consumed')
           AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'component')
           AND mr.sale_order_id IS DISTINCT FROM v_need.sale_order_id
           AND GREATEST(COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0) > 0
           AND public.billing_fortnight_start(public.resolve_billing_week_for_order(mr.sale_order_id))
               >= COALESCE(v_need.fortnight, '0001-01-01'::date)
           AND public.atelier_inbound_cover_tier(mr.sale_order_id, p_product_id) > 0
           AND NOT EXISTS (
             SELECT 1
               FROM public.cabedal_prep_stock_debits stuck
              WHERE stuck.sale_order_id = mr.sale_order_id
                AND stuck.product_id = p_product_id
                AND stuck.sector = 'corte_atelier'
                AND stuck.pending_qty > 0.0000001
           )
         ORDER BY public.billing_fortnight_start(public.resolve_billing_week_for_order(mr.sale_order_id)) DESC,
                  public.atelier_inbound_cover_tier(mr.sale_order_id, p_product_id) DESC,
                  public.commitment_cover_priority(mr.sale_order_id) DESC,
                  mr.created_at DESC
         FOR UPDATE OF mr
      LOOP
        EXIT WHEN COALESCE(v_open, 0) + v_free >= v_need.pending_qty;
        v_take := LEAST(
          v_donor.open_qty,
          v_need.pending_qty - COALESCE(v_open, 0) - v_free
        );
        IF v_take <= 0 THEN
          CONTINUE;
        END IF;
        UPDATE public.material_reservations
           SET quantity_reserved = quantity_reserved - v_take,
               quantity_short = COALESCE(quantity_short, 0) + v_take,
               updated_at = now()
         WHERE id = v_donor.id;
        IF v_res IS NOT NULL THEN
          UPDATE public.material_reservations
             SET quantity_reserved = quantity_reserved + v_take,
                 quantity_short = GREATEST(COALESCE(quantity_short, 0) - v_take, 0),
                 updated_at = now()
           WHERE id = v_res;
          v_open := COALESCE(v_open, 0) + v_take;
        END IF;
        INSERT INTO public.reservation_reallocations (
          product_id, product_name, from_sale_order_id, to_sale_order_id,
          from_order_number, to_order_number, quantity, reason, stock_movement_id
        ) VALUES (
          p_product_id, v_name, v_donor.sale_order_id, v_need.sale_order_id,
          v_donor.order_number, v_need.order_number, v_take,
          'Ateliê parado na mesma quinzena ou quinzena anterior tomou empenho de PV com prazo pior',
          p_movement_id
        );
        v_stolen := v_stolen + 1;
      END LOOP;
    END IF;

    SELECT COALESCE(sum(GREATEST(
             COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0
           )), 0)
      INTO v_held
      FROM public.material_reservations mr
     WHERE mr.product_id = p_product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND mr.id IS DISTINCT FROM v_res;

    SELECT COALESCE(quantity, 0) INTO v_prev
      FROM public.products WHERE id = p_product_id FOR UPDATE;
    -- Reserva aberta zero não bloqueia a quitação do corte. Entra o físico
    -- que não está empenhado nos outros PVs (o empenho deste PV, se houver,
    -- também entra porque ficou de fora de v_held).
    v_qty := LEAST(
      v_need.pending_qty,
      GREATEST(COALESCE(v_prev, 0) - COALESCE(v_held, 0), 0)
    );

    -- Sem saldo que caiba, a falta permanece. Não zera pending_qty.
    IF v_qty <= 0.0000001 THEN
      CONTINUE;
    END IF;

    UPDATE public.products
       SET quantity = quantity - v_qty,
           current_stock = quantity - v_qty,
           updated_at = now()
     WHERE id = p_product_id;

    INSERT INTO public.stock_movements (
      product_id, order_id, lot_id, atelier_lot_id, movement_type, quantity,
      previous_stock, new_stock, description, movement_reason
    ) VALUES (
      p_product_id, NULL, NULL, v_need.lot_id, 'out', v_qty,
      v_prev, v_prev - v_qty,
      'Ateliê · corte completado pela entrada · lote ' || v_need.lot_id::text,
      'consumo_op'
    )
    RETURNING id INTO v_mov;

    UPDATE public.cabedal_prep_stock_debits
       SET quantity = COALESCE(quantity, 0) + v_qty,
           pending_qty = pending_qty - v_qty,
           fill_movement_ids = fill_movement_ids || v_mov
     WHERE id = v_need.id
       AND pending_qty >= v_qty - 0.0000001;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Falta do corte mudou durante a entrada; nada foi zerado sem movimento';
    END IF;

    v_consume := LEAST(COALESCE(v_open, 0), v_qty);
    IF v_res IS NOT NULL AND v_consume > 0 THEN
      UPDATE public.material_reservations
         SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_consume,
             quantity_reserved = GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_consume),
             status = CASE
               WHEN GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_consume)
                    <= COALESCE(quantity_consumed, 0) + v_consume
                 THEN 'consumed'
               ELSE 'partially_consumed'
             END,
             consumed_at = now(),
             metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('atelier_consumed', true, 'cut_fill_movement_id', v_mov),
             updated_at = now()
       WHERE id = v_res;
    END IF;

    v_phys := v_prev - v_qty;
    v_filled := v_filled + 1;
    v_lot := v_need.lot_id;

    IF public.atelier_lot_kit_is_closed(v_lot)
       AND EXISTS (
         SELECT 1
           FROM public.cabedal_prep_jobs j
          WHERE j.lot_id = v_lot
            AND COALESCE(j.execution_mode, 'contractor') <> 'internal'
            AND j.pipeline_status = 'cut'
       ) THEN
      PERFORM public.atelier_confirm_lot_release(v_lot);
      UPDATE public.atelier_lots
         SET dispatch_signal = 'Kit pronto. Escolha o prestador e envie — o envio não foi feito sozinho.',
             updated_at = now()
       WHERE id = v_lot;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'filled', v_filled, 'reallocations', v_stolen, 'product_id', p_product_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.atelier_confirm_lot_release(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot public.atelier_lots%ROWTYPE;
  v_line record;
  v_prev numeric;
  v_debit numeric;
  v_mov uuid;
  v_res_id uuid;
  v_lines int := 0;
  v_pending int := 0;
  v_skipped int := 0;
  v_gate text;
  v_already boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('atelier-release:' || p_lot_id::text, 0));

  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote do Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lot.status <> 'cut' THEN
    RAISE EXCEPTION 'Lote % precisa estar cortado', v_lot.lot_number USING ERRCODE = '22023';
  END IF;

  v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);
  IF v_gate = 'awaiting_components' THEN
    RAISE EXCEPTION 'Ainda falta estoque de componentes/tiras no lote %', v_lot.lot_number
      USING ERRCODE = '22023';
  END IF;

  FOR v_line IN
    SELECT * FROM public.atelier_lot_release_lines(p_lot_id)
  LOOP
    -- Idempotência: débito liberacao_atelier deste lote+item+produto já existe.
    -- Ignora ANTES de alterar o estoque. Segunda chamada (envio ou entrada) não duplica.
    SELECT EXISTS (
      SELECT 1
        FROM public.cabedal_prep_stock_debits s
       WHERE s.lot_id = p_lot_id
         AND s.sale_order_item_id = v_line.sale_order_item_id
         AND s.product_id = v_line.product_id
         AND s.sector = 'liberacao_atelier'
       FOR UPDATE
    ) INTO v_already;
    IF v_already THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT quantity INTO v_prev FROM public.products WHERE id = v_line.product_id FOR UPDATE;
    v_debit := LEAST(GREATEST(COALESCE(v_prev, 0), 0), v_line.required);
    v_mov := NULL;

    IF v_debit > 0 THEN
      UPDATE public.products
         SET quantity = quantity - v_debit,
             current_stock = quantity - v_debit,
             updated_at = now()
       WHERE id = v_line.product_id;

      INSERT INTO public.stock_movements (
        product_id, order_id, lot_id, atelier_lot_id, movement_type, quantity,
        previous_stock, new_stock, description, movement_reason
      ) VALUES (
        v_line.product_id, NULL, NULL, p_lot_id, 'out', v_debit,
        v_prev, v_prev - v_debit,
        'Ateliê · liberação ' || v_lot.lot_number || ' · ' || v_line.component,
        'consumo_op'
      )
      RETURNING id INTO v_mov;

      SELECT mr.id INTO v_res_id
        FROM public.material_reservations mr
       WHERE mr.sale_order_id = v_line.sale_order_id
         AND mr.product_id = v_line.product_id
         AND mr.status IN ('reserved', 'partially_consumed')
         AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep')
       ORDER BY mr.created_at
       LIMIT 1
       FOR UPDATE;

      IF v_res_id IS NOT NULL THEN
        UPDATE public.material_reservations
           SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_debit,
               quantity_reserved = GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit),
               status = CASE
                 WHEN GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit)
                      <= COALESCE(quantity_consumed, 0) + v_debit
                   THEN 'consumed'
                 ELSE 'partially_consumed'
               END,
               consumed_at = now(),
               metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object('atelier_consumed', true),
               updated_at = now()
         WHERE id = v_res_id;
      END IF;
    ELSE
      v_res_id := NULL;
    END IF;

    INSERT INTO public.cabedal_prep_stock_debits (
      sale_order_id, sale_order_item_id, product_id, quantity,
      required_qty, pending_qty, component,
      stock_movement_id, sector, lot_id, reservation_id
    )
    SELECT
      v_line.sale_order_id, v_line.sale_order_item_id, v_line.product_id, v_debit,
      v_line.required, GREATEST(v_line.required - v_debit, 0), v_line.component,
      v_mov, 'liberacao_atelier', p_lot_id, v_res_id
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.cabedal_prep_stock_debits s
        WHERE s.lot_id = p_lot_id
          AND s.sale_order_item_id = v_line.sale_order_item_id
          AND s.product_id = v_line.product_id
          AND s.sector = 'liberacao_atelier'
     );
    IF NOT FOUND THEN
      IF v_mov IS NOT NULL THEN
        RAISE EXCEPTION 'Liberação do lote % disputou o mesmo item; a transação foi desfeita para não debitar duas vezes',
          v_lot.lot_number
          USING ERRCODE = '40001';
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_lines := v_lines + 1;
    IF v_line.required - v_debit > 0 THEN
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);

  RETURN jsonb_build_object(
    'ok', true, 'lot_number', v_lot.lot_number,
    'lines', v_lines, 'pending_lines', v_pending,
    'skipped_already_debited', v_skipped, 'kit_gate', v_gate
  );
END;
$$;


-- Alinha só o produto medido, e só no estado medido (quantity 0, espelho 0.24).
DO $align_glow$
DECLARE
  v_qty numeric;
  v_cur numeric;
  v_row record;
  v_n int := 0;
BEGIN
  SELECT quantity, current_stock
    INTO v_qty, v_cur
    FROM public.products
   WHERE id = '657aa32d-e665-4972-8e60-d19ad7841c2b'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE NOTICE 'produto 657aa32d ausente; nada alinhado';
  ELSIF v_qty = 0 AND round(v_cur, 4) = 0.2400 THEN
    UPDATE public.products
       SET current_stock = 0,
           updated_at = now()
     WHERE id = '657aa32d-e665-4972-8e60-d19ad7841c2b'
       AND quantity = 0
       AND round(current_stock, 4) = 0.2400;
    RAISE NOTICE 'current_stock alinhado a 0 em 657aa32d-e665-4972-8e60-d19ad7841c2b';
  ELSIF v_qty IS NOT DISTINCT FROM v_cur THEN
    RAISE NOTICE 'produto 657aa32d ja alinhado quantity=%', v_qty;
  ELSE
    RAISE NOTICE 'produto 657aa32d NAO alterado: quantity=% current_stock=% (esperado 0 e 0.24)', v_qty, v_cur;
  END IF;

  FOR v_row IN
    SELECT p.id, p.sku, p.name, p.quantity, p.current_stock,
           COALESCE((
             SELECT sum(m.quantity)
               FROM public.stock_movements m
              WHERE m.product_id = p.id
                AND m.movement_type = 'out'
                AND m.movement_reason = 'consumo_op'
                AND (
                  m.description LIKE 'Ateliê · corte completado pela entrada%'
                  OR m.description LIKE 'Ateliê · liberação%'
                )
           ), 0) AS atelier_out
      FROM public.products p
     WHERE p.id <> '657aa32d-e665-4972-8e60-d19ad7841c2b'
       AND p.quantity IS DISTINCT FROM p.current_stock
       AND EXISTS (
         SELECT 1
           FROM public.stock_movements m
          WHERE m.product_id = p.id
            AND m.movement_type = 'out'
            AND m.movement_reason = 'consumo_op'
            AND (
              m.description LIKE 'Ateliê · corte completado pela entrada%'
              OR m.description LIKE 'Ateliê · liberação%'
            )
       )
     ORDER BY p.sku
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE 'divergencia mesmo caminho id=% sku=% qty=% current=% saida_atelie=% name=%',
      v_row.id, v_row.sku, v_row.quantity, v_row.current_stock, v_row.atelier_out, v_row.name;
  END LOOP;
  RAISE NOTICE 'outros produtos quantity<>current_stock com saida Ateliê corte/liberacao: %', v_n;
END
$align_glow$;

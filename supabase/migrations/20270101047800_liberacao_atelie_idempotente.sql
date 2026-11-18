-- A liberação do lote deixa de debitar duas vezes.
-- Item que já tem cabedal_prep_stock_debits sector = liberacao_atelier
-- naquele lote é ignorado ANTES de mexer em products.quantity.
-- O clique de envio pode chamar a liberação de novo: não sai
-- estoque dobrado. Esta migration não chama o envio.

ALTER TABLE public.atelier_lots
  ADD COLUMN IF NOT EXISTS dispatch_signal text;

COMMENT ON COLUMN public.atelier_lots.dispatch_signal IS
  'Aviso de que o kit está pronto para o clique de envio. Não envia sozinho.';

CREATE OR REPLACE FUNCTION public.billing_fortnight_start(p_day date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_day IS NULL THEN NULL::date
    WHEN EXTRACT(DAY FROM p_day)::int <= 15 THEN date_trunc('month', p_day)::date
    ELSE (date_trunc('month', p_day)::date + 15)
  END;
$$;

REVOKE ALL ON FUNCTION public.billing_fortnight_start(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_fortnight_start(date) TO authenticated, service_role;

-- Critério único de kit fechado: napa do corte sem pending_qty E portão pronto.
CREATE OR REPLACE FUNCTION public.atelier_lot_kit_is_closed(p_lot_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gate text;
  v_napa numeric;
BEGIN
  IF p_lot_id IS NULL THEN
    RETURN false;
  END IF;
  v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);
  SELECT COALESCE(sum(GREATEST(d.pending_qty, 0)), 0)
    INTO v_napa
    FROM public.cabedal_prep_stock_debits d
   WHERE d.lot_id = p_lot_id
     AND d.sector = 'corte_atelier';
  RETURN v_gate = 'ready_to_send' AND COALESCE(v_napa, 0) <= 0.0000001;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_lot_kit_is_closed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_lot_kit_is_closed(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_lot_kit_is_closed(uuid) IS
  'Kit fechou quando não há pending_qty de napa do corte e kit_gate é ready_to_send.';

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
         SET quantity = quantity - v_debit, updated_at = now()
       WHERE id = v_line.product_id;

      INSERT INTO public.stock_movements (
        product_id, order_id, lot_id, movement_type, quantity,
        previous_stock, new_stock, description, movement_reason
      ) VALUES (
        v_line.product_id, NULL, p_lot_id, 'out', v_debit,
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

REVOKE ALL ON FUNCTION public.atelier_confirm_lot_release(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_confirm_lot_release(uuid) TO authenticated, service_role;

DO $signal$
DECLARE
  v_def text;
  v_old text := $o$'kit_gate', l.kit_gate,$o$;
  v_new text := $n$'kit_gate', l.kit_gate, 'dispatch_signal', l.dispatch_signal,$n$;
BEGIN
  SELECT pg_get_functiondef('public.list_atelier_lots()'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'list_atelier_lots() não encontrada';
  END IF;
  IF strpos(v_def, 'dispatch_signal') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'list_atelier_lots sem kit_gate para expor o sinal de envio';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$signal$;

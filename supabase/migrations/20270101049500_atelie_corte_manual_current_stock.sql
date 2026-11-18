-- O corte manual do lote ('Ateliê · corte {lote}') baixava só quantity.
-- A entrada que quita o corte e a liberação do kit já gravam current_stock
-- com o mesmo saldo. Este caminho passa a fazer o mesmo. Sem UPDATE de dado:
-- nenhum produto é realinhado aqui.

CREATE OR REPLACE FUNCTION public.atelier_confirm_lot_cut(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot public.atelier_lots%ROWTYPE;
  v_dem record;
  v_line record;
  v_prev numeric;
  v_debit numeric;
  v_mov uuid;
  v_res_id uuid;
  v_items int := 0;
  v_lines int := 0;
  v_pending int := 0;
  v_gate text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote do Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lot.status = 'cut' THEN
    PERFORM public.atelier_refresh_lot_kit_gate(p_lot_id);
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'status', 'cut',
      'kit_gate', (SELECT kit_gate FROM public.atelier_lots WHERE id = p_lot_id));
  END IF;
  IF v_lot.status <> 'open' THEN
    RAISE EXCEPTION 'Lote % está %', v_lot.lot_number, v_lot.status USING ERRCODE = '22023';
  END IF;

  FOR v_dem IN
    SELECT d.id, d.sale_order_id, d.sale_order_item_id
      FROM public.cabedal_prep_demands d
     WHERE d.lot_id = p_lot_id
       AND d.status <> 'cancelled'
       AND EXISTS (
         SELECT 1 FROM public.cabedal_prep_jobs j
          WHERE j.demand_id = d.id AND j.pipeline_status = 'awaiting_cut'
       )
     ORDER BY d.created_at
  LOOP
    v_items := v_items + 1;

    -- Só Cabedal (napa). COMPONENTES / Tiras na liberação.
    FOR v_line IN
      SELECT l.product_id, min(l.component) AS component, sum(l.required)::numeric AS required
        FROM public.sale_order_material_demand_lines(v_dem.sale_order_id) l
       WHERE l.sale_order_item_id = v_dem.sale_order_item_id
         AND l.component = 'Cabedal'
       GROUP BY l.product_id
       ORDER BY l.product_id
    LOOP
      IF COALESCE(v_line.required, 0) <= 0 THEN
        CONTINUE;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.cabedal_prep_stock_debits s
         WHERE s.sale_order_item_id = v_dem.sale_order_item_id
           AND s.product_id = v_line.product_id
           AND s.lot_id IS NOT NULL
           AND COALESCE(s.sector, '') = 'corte_atelier'
      ) THEN
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
          product_id, order_id, movement_type, quantity,
          previous_stock, new_stock, description, movement_reason
        ) VALUES (
          v_line.product_id, NULL, 'out', v_debit,
          v_prev, v_prev - v_debit,
          'Ateliê · corte ' || v_lot.lot_number || ' · ' || v_line.component,
          'consumo_op'
        )
        RETURNING id INTO v_mov;

        SELECT mr.id INTO v_res_id
          FROM public.material_reservations mr
         WHERE mr.sale_order_id = v_dem.sale_order_id
           AND mr.product_id = v_line.product_id
           AND mr.status IN ('reserved', 'partially_consumed')
           AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep')
           AND mr.strap_variant_id IS NULL
           AND mr.sale_order_strap_demand_id IS NULL
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
      ) VALUES (
        v_dem.sale_order_id, v_dem.sale_order_item_id, v_line.product_id, v_debit,
        v_line.required, GREATEST(v_line.required - v_debit, 0), v_line.component,
        v_mov, 'corte_atelier', p_lot_id, v_res_id
      );

      v_lines := v_lines + 1;
      IF v_line.required - v_debit > 0 THEN
        v_pending := v_pending + 1;
      END IF;
    END LOOP;

    UPDATE public.cabedal_prep_jobs
       SET pipeline_status = 'cut', cut_at = now(), updated_at = now()
     WHERE demand_id = v_dem.id AND pipeline_status = 'awaiting_cut';
  END LOOP;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'Lote % não tem itens aguardando corte', v_lot.lot_number USING ERRCODE = '22023';
  END IF;

  UPDATE public.atelier_lots
     SET status = 'cut', cut_at = now(), cut_by = auth.uid(), updated_at = now()
   WHERE id = p_lot_id;

  v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);

  RETURN jsonb_build_object(
    'ok', true, 'lot_number', v_lot.lot_number,
    'items', v_items, 'lines', v_lines, 'pending_lines', v_pending,
    'kit_gate', v_gate
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_confirm_lot_cut(uuid) TO authenticated, service_role;

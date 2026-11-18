-- Entrada de estoque:
--   * dentro da mesma quinzena, lote de Ateliê parado vem primeiro;
--   * pode tomar empenho de PV com prazo pior (não fura quinzena anterior);
--   * a falta de napa do corte vira stock_movement de verdade, ligado ao lote;
--   * se o kit fechar, debita o kit (liberação idempotente) e sinaliza o envio.
-- Não marca o job como enviado. Job interno não é sinalizado.
-- A OS de prestador continua no clique de envio.

ALTER TABLE public.cabedal_prep_stock_debits
  ADD COLUMN IF NOT EXISTS fill_movement_ids uuid[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.reservation_reallocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  product_name text,
  from_sale_order_id uuid,
  to_sale_order_id uuid,
  from_order_number text,
  to_order_number text,
  quantity numeric NOT NULL CHECK (quantity > 0),
  reason text NOT NULL,
  stock_movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reservation_reallocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reservation_reallocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.reservation_reallocations TO authenticated;
GRANT ALL ON TABLE public.reservation_reallocations TO service_role;

DROP POLICY IF EXISTS reservation_reallocations_select ON public.reservation_reallocations;
CREATE POLICY reservation_reallocations_select ON public.reservation_reallocations
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

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
  v_qty numeric;
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
           AND (
             public.billing_fortnight_start(public.resolve_billing_week_for_order(mr.sale_order_id))
               > COALESCE(v_need.fortnight, '0001-01-01'::date)
             OR public.commitment_cover_priority(mr.sale_order_id) > v_need.prio
           )
           AND NOT EXISTS (
             SELECT 1
               FROM public.cabedal_prep_stock_debits stuck
              WHERE stuck.sale_order_id = mr.sale_order_id
                AND stuck.product_id = p_product_id
                AND stuck.sector = 'corte_atelier'
                AND stuck.pending_qty > 0.0000001
           )
         ORDER BY public.billing_fortnight_start(public.resolve_billing_week_for_order(mr.sale_order_id)) DESC,
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

    SELECT COALESCE(quantity, 0) INTO v_prev
      FROM public.products WHERE id = p_product_id FOR UPDATE;
    v_qty := LEAST(v_need.pending_qty, GREATEST(COALESCE(v_prev, 0), 0));
    IF v_res IS NOT NULL THEN
      SELECT GREATEST(COALESCE(quantity_reserved, 0) - COALESCE(quantity_consumed, 0), 0)
        INTO v_open
        FROM public.material_reservations WHERE id = v_res;
      v_qty := LEAST(v_qty, COALESCE(v_open, 0));
    END IF;

    -- Sem saldo que caiba, a falta permanece. Não zera pending_qty.
    IF v_qty <= 0.0000001 THEN
      CONTINUE;
    END IF;

    UPDATE public.products
       SET quantity = quantity - v_qty, updated_at = now()
     WHERE id = p_product_id;

    INSERT INTO public.stock_movements (
      product_id, order_id, lot_id, movement_type, quantity,
      previous_stock, new_stock, description, movement_reason
    ) VALUES (
      p_product_id, NULL, v_need.lot_id, 'out', v_qty,
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

    IF v_res IS NOT NULL THEN
      UPDATE public.material_reservations
         SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_qty,
             quantity_reserved = GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_qty),
             status = CASE
               WHEN GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_qty)
                    <= COALESCE(quantity_consumed, 0) + v_qty
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

REVOKE ALL ON FUNCTION public.apply_atelier_inbound(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_atelier_inbound(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_cover_commitments_on_stock_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.movement_type = 'in'
     AND NEW.product_id IS NOT NULL
     AND COALESCE(NEW.quantity, 0) > 0 THEN
    PERFORM public.cover_open_material_commitments(NEW.product_id, NEW.quantity, NEW.id);
    BEGIN
      PERFORM public.reallocate_product_commitments(NEW.product_id, NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[tg_cover_commitments_on_stock_in] realocação falhou para %: %',
        NEW.product_id, SQLERRM;
    END;
    PERFORM public.apply_atelier_inbound(NEW.product_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

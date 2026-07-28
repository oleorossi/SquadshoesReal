-- B2 (espelho SQL) -- auditoria 2026-07-28: resync_op_atomic deletava
-- material_reservations ANTES de chamar restore_sole_grade_for_order (que le
-- exatamente essas reservas kind='sole_grade'), tornando o estorno de grade um
-- no-op -- o re-debito por grade entao debitava a grade 2x (drift -T em
-- stock_grade a cada resync de OP com solado por grade).
-- Fix: restore movido pro INICIO (antes do estorno escalar e dos DELETEs), e o
-- estorno escalar pula os movimentos 'Debito Solado por grade%' ja cobertos
-- pelo restore (que credita stock_grade E quantity) -- mesmo desenho do fix TS
-- em src/lib/resyncOPs.ts. Base: corpo da migration 20260728100006 (def viva
-- md5 a0cb8c61... + defaults do split da Costura).

CREATE OR REPLACE FUNCTION public.resync_op_atomic(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_op record;
  v_mov record;
  v_prev_stock numeric;
  v_new_stock numeric;
  v_grade jsonb;
  v_status text;
  v_errors text[] := '{}';
  v_delta jsonb := NULL;
  v_sole_restored boolean := false;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT id, reference_id, quantity, color, grade, sale_order_id, order_number, status
    INTO v_op
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP não encontrada: %', p_order_id;
  END IF;

  v_status := LOWER(COALESCE(v_op.status, ''));
  IF v_status NOT IN ('reservado', 'em produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'OP not active', 'status', v_op.status);
  END IF;

  v_grade := COALESCE(v_op.grade, '{}'::jsonb);

  -- B2 (auditoria 2026-07-28): o restore de grade PRECISA rodar ANTES do
  -- DELETE de material_reservations (ele le as reservas kind='sole_grade')
  -- e antes do estorno escalar, que entao PULA os movimentos do solado
  -- (o restore ja credita stock_grade E quantity; sem o skip o quantity
  -- seria creditado 2x).
  BEGIN
    PERFORM public.restore_sole_grade_for_order(p_order_id);
    v_sole_restored := true;
  EXCEPTION WHEN undefined_function THEN
    v_sole_restored := false;
  END;

  FOR v_mov IN
    SELECT product_id, quantity, description
      FROM public.stock_movements
     WHERE order_id = p_order_id AND movement_type = 'out'
  LOOP
    IF v_sole_restored
       AND (v_mov.description LIKE 'Debito Solado por grade%'
            OR v_mov.description LIKE 'Conversão Solado por grade%')
       AND EXISTS (
         SELECT 1 FROM public.material_reservations mr
          WHERE mr.order_id = p_order_id
            AND mr.product_id = v_mov.product_id
            AND (mr.metadata ->> 'kind') = 'sole_grade'
            AND (mr.metadata ? 'sole_restored_at')
       )
    THEN
      CONTINUE;  -- escalar do solado ja estornado pelo restore por grade
                 -- (cobre debito direto E baixa via convert_reservation_to_out)
    END IF;
    SELECT quantity INTO v_prev_stock
      FROM public.products
     WHERE id = v_mov.product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      v_errors := v_errors || ('Produto não encontrado: ' || v_mov.product_id::text);
      CONTINUE;
    END IF;

    v_new_stock := v_prev_stock + v_mov.quantity;
    UPDATE public.products SET quantity = v_new_stock, updated_at = now()
     WHERE id = v_mov.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_mov.product_id, 'in', v_mov.quantity, v_prev_stock, v_new_stock,
      'Estorno automático - resync_op_atomic', p_order_id
    );
  END LOOP;

  UPDATE public.production_consumptions
     SET superseded_at = now(),
         superseded_reason = 'resync_op_atomic'
   WHERE order_id = p_order_id
     AND superseded_at IS NULL;

  DELETE FROM public.material_reservations WHERE order_id = p_order_id;
  DELETE FROM public.order_stages WHERE order_id = p_order_id;

  IF v_op.sale_order_id IS NOT NULL THEN
    DELETE FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_op.sale_order_id;
  END IF;

  UPDATE public.stock_movements
     SET order_id = NULL
   WHERE order_id = p_order_id
     AND movement_type = 'out';

  PERFORM public.hybrid_debit_stock_for_order(
    v_op.reference_id,
    v_op.quantity,
    COALESCE(v_op.color, ''),
    p_order_id,
    CASE WHEN v_grade <> '{}'::jsonb THEN v_grade ELSE NULL END
  );

  IF v_grade <> '{}'::jsonb THEN
    BEGIN
      PERFORM public.debit_sole_stock_by_grade(
        v_op.reference_id, p_order_id, COALESCE(v_op.color, ''), v_grade
      );
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END IF;

  INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  SELECT p_order_id,
         stage_name,
         stage_order,
         'pendente',
         v_op.quantity,
         0
    FROM (
      SELECT
        COALESCE(
          (SELECT array_agg(value::text ORDER BY ordinality)
             FROM technical_sheets ts,
                  jsonb_array_elements_text(ts.production_sectors) WITH ORDINALITY
            WHERE ts.id = v_op.reference_id
              AND ts.production_sectors IS NOT NULL
              AND jsonb_array_length(ts.production_sectors) > 0),
          -- M20: 'Costura' não existe mais em sector_settings (split
          -- 20261001120000) — o default gera as duas costuras na ordem canônica.
          ARRAY['Corte Palmilha','Corte Forração','Costura Palmilha','Costura Cabedal','Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
        ) AS names
    ) s,
    LATERAL (
      SELECT name AS stage_name, ord AS stage_order
        FROM unnest(s.names) WITH ORDINALITY AS u(name, ord)
    ) lat;

  -- NOVO (2026-07-25): fecha a causa-raiz do furo de baixa. hybrid_debit
  -- reconstrói a reserva a partir do snapshot; qualquer componente que a ficha
  -- ATUAL pede e ficou de fora entra aqui como reserva de delta.
  BEGIN
    v_delta := public.reserve_missing_materials_for_order(p_order_id);
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || ('reserva de delta falhou: ' || SQLERRM);
    PERFORM public.record_op_reserve_failure_alert(p_order_id, 'resync_op_atomic: ' || SQLERRM);
  END;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_op.order_number,
    'errors', v_errors,
    'delta_reservations', v_delta,
    'resynced_at', now()
  );
END;
$fn$;

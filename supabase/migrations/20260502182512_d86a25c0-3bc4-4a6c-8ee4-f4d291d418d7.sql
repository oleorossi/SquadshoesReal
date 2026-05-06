-- =============================================================================
-- Audit-2 critical fixes: resync_op_atomic sector rename + atomic PO total
-- =============================================================================

-- ── Fix #1: resync_op_atomic — replace legacy sector fallback ───────────────
DROP FUNCTION IF EXISTS public.resync_op_atomic(p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.resync_op_atomic(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op record;
  v_mov record;
  v_prev_stock numeric;
  v_new_stock numeric;
  v_grade jsonb;
  v_status text;
  v_errors text[] := '{}';
BEGIN
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

  FOR v_mov IN
    SELECT product_id, quantity
      FROM public.stock_movements
     WHERE order_id = p_order_id AND movement_type = 'out'
  LOOP
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

  BEGIN
    PERFORM public.restore_sole_grade_for_order(p_order_id);
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

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

  -- Updated fallback: post-rename canonical sector names matching
  -- 20260506120000_sector-rename-wave-stages.sql.
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
          ARRAY['Corte Palmilha','Corte Forração','Mesa','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
        ) AS names
    ) s,
    LATERAL (
      SELECT name AS stage_name, ord AS stage_order
        FROM unnest(s.names) WITH ORDINALITY AS u(name, ord)
    ) lat;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_op.order_number,
    'errors', v_errors,
    'resynced_at', now()
  );
END;
$$;

-- ── Fix #3: upsert_po_item_atomic now also updates purchase_orders.total_value ─
DROP FUNCTION IF EXISTS public.upsert_po_item_atomic(
  uuid, uuid, numeric, numeric, text, numeric, numeric, numeric, jsonb, text
);

CREATE OR REPLACE FUNCTION public.upsert_po_item_atomic(
  p_po_id          uuid,
  p_product_id     uuid,
  p_qty_delta      numeric,
  p_unit_price     numeric,
  p_unit           text DEFAULT 'un',
  p_current_stock  numeric DEFAULT 0,
  p_min_stock      numeric DEFAULT 0,
  p_max_stock      numeric DEFAULT 0,
  p_grade_delta    jsonb DEFAULT NULL,
  p_color          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_item_id      uuid;
  v_old_qty      numeric;
  v_old_grade    jsonb;
  v_new_grade    jsonb;
  v_new_qty      numeric;
  v_inserted     boolean := false;
  v_size         text;
  v_size_qty     numeric;
  v_qty_applied  numeric;
  v_total_delta  numeric;
BEGIN
  PERFORM 1 FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;

  SELECT id, quantity, COALESCE(grade, '{}'::jsonb)
    INTO v_item_id, v_old_qty, v_old_grade
    FROM public.purchase_order_items
   WHERE purchase_order_id = p_po_id
     AND product_id        = p_product_id
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;

  IF v_item_id IS NOT NULL THEN
    v_new_grade := v_old_grade;
    IF p_grade_delta IS NOT NULL AND jsonb_typeof(p_grade_delta) = 'object' THEN
      FOR v_size, v_size_qty IN
        SELECT key, value::numeric FROM jsonb_each_text(p_grade_delta)
      LOOP
        v_new_grade := jsonb_set(
          v_new_grade,
          ARRAY[v_size],
          to_jsonb(COALESCE((v_new_grade ->> v_size)::numeric, 0) + v_size_qty)
        );
      END LOOP;
    END IF;

    v_new_qty := v_old_qty + p_qty_delta;

    UPDATE public.purchase_order_items
       SET quantity            = v_new_qty,
           suggested_quantity  = suggested_quantity + p_qty_delta,
           max_stock           = GREATEST(max_stock, p_max_stock),
           grade               = CASE WHEN p_grade_delta IS NOT NULL THEN v_new_grade ELSE grade END
     WHERE id = v_item_id;

  ELSE
    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, quantity, suggested_quantity, unit_price, unit,
      current_stock, min_stock, max_stock, grade, color
    ) VALUES (
      p_po_id, p_product_id, p_qty_delta, p_qty_delta, p_unit_price, p_unit,
      p_current_stock, p_min_stock, p_max_stock, p_grade_delta, p_color
    )
    RETURNING id INTO v_item_id;

    v_old_qty   := 0;
    v_new_qty   := p_qty_delta;
    v_inserted  := true;
  END IF;

  v_qty_applied := v_new_qty - v_old_qty;
  v_total_delta := v_qty_applied * COALESCE(p_unit_price, 0);

  UPDATE public.purchase_orders
     SET total_value = COALESCE(total_value, 0) + v_total_delta,
         updated_at  = now()
   WHERE id = p_po_id;

  RETURN jsonb_build_object(
    'item_id',  v_item_id,
    'inserted', v_inserted,
    'old_qty',  v_old_qty,
    'new_qty',  v_new_qty,
    'qty_delta_applied', v_qty_applied,
    'total_delta_applied', v_total_delta
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_po_item_atomic(
  uuid, uuid, numeric, numeric, text, numeric, numeric, numeric, jsonb, text
) TO authenticated, service_role;
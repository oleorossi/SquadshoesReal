-- =============================================================================
-- Add is_approved_user() guard to upsert_po_item_atomic and
-- register_order_shipment SECURITY DEFINER RPCs
-- =============================================================================
-- upsert_po_item_atomic (20260507160000): any authenticated unapproved user
--   could mutate purchase_order_items (inflate quantities, change prices).
-- register_order_shipment (20260519160000): any authenticated unapproved user
--   could bulk-advance sale orders to 'Expedido' without authorized NF-e,
--   bypassing the NF-e check enforced by useUpdateSaleOrderStatus in the TS layer.
--
-- Both functions are tightened with the standard is_approved_user() guard.
-- Mirrors 20260507180000, 20260518140000, 20260519170000, 20260520120000.
-- =============================================================================

-- 1. upsert_po_item_atomic
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
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Lock the existing row (if any) to serialise concurrent callers
  SELECT id, quantity, COALESCE(grade, '{}'::jsonb)
    INTO v_item_id, v_old_qty, v_old_grade
    FROM public.purchase_order_items
   WHERE purchase_order_id = p_po_id
     AND product_id        = p_product_id
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;

  IF v_item_id IS NULL THEN
    -- No existing row — insert
    v_new_qty   := p_qty_delta;
    v_new_grade := COALESCE(p_grade_delta, '{}'::jsonb);
    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, quantity, unit_price,
      unit, current_stock, min_stock, max_stock, grade, color
    ) VALUES (
      p_po_id, p_product_id, v_new_qty, p_unit_price,
      p_unit, p_current_stock, p_min_stock, p_max_stock, v_new_grade, p_color
    )
    RETURNING id INTO v_item_id;
    v_inserted := true;
  ELSE
    -- Existing row — accumulate
    v_new_qty := v_old_qty + p_qty_delta;
    -- Merge grade JSONB: sum per-size values
    v_new_grade := v_old_grade;
    IF p_grade_delta IS NOT NULL THEN
      FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each(p_grade_delta) LOOP
        v_new_grade := jsonb_set(
          v_new_grade,
          ARRAY[v_size],
          to_jsonb(COALESCE((v_new_grade->>v_size)::numeric, 0) + v_size_qty)
        );
      END LOOP;
    END IF;

    UPDATE public.purchase_order_items SET
      quantity    = v_new_qty,
      unit_price  = p_unit_price,
      grade       = v_new_grade
    WHERE id = v_item_id;
  END IF;

  -- Keep purchase_orders.total_value in sync within the same transaction
  -- (prevents the separate increment call from creating a concurrent-write window)
  UPDATE public.purchase_orders
     SET total_value = (
           SELECT COALESCE(SUM(quantity * unit_price), 0)
             FROM public.purchase_order_items
            WHERE purchase_order_id = p_po_id
         ),
         updated_at = now()
   WHERE id = p_po_id;

  RETURN jsonb_build_object(
    'item_id',   v_item_id,
    'new_qty',   v_new_qty,
    'inserted',  v_inserted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_po_item_atomic(uuid, uuid, numeric, numeric, text, numeric, numeric, numeric, jsonb, text) TO authenticated;


-- 2. register_order_shipment
CREATE OR REPLACE FUNCTION public.register_order_shipment(
  p_sale_order_ids uuid[],
  p_manifest_id    uuid  DEFAULT NULL,
  p_checked_by     text  DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  UPDATE public.sale_orders
     SET shipped_at  = now(),
         checked_by  = p_checked_by,
         status      = 'Expedido'
   WHERE id          = ANY(p_sale_order_ids)
     AND status      = 'Faturado'
     AND shipped_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_manifest_id IS NOT NULL AND v_count > 0 THEN
    -- Match manifest items to sale orders by position rather than Cartesian join.
    WITH ordered_ids AS (
      SELECT id, row_number() OVER () AS rn
        FROM unnest(p_sale_order_ids) AS sub(id)
    ),
    ordered_items AS (
      SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
        FROM public.loading_manifest_items
       WHERE manifest_id    = p_manifest_id
         AND sale_order_id IS NULL
    )
    UPDATE public.loading_manifest_items lmi
       SET sale_order_id = oi.id
      FROM ordered_items oitm
      JOIN ordered_ids oi USING (rn)
     WHERE lmi.id = oitm.id;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_order_shipment(uuid[], uuid, text) TO authenticated;

COMMENT ON FUNCTION public.register_order_shipment(uuid[], uuid, text) IS
  'Atomically sets shipped_at + status=Expedido for Faturado orders. Requires approved user. Returns count of rows actually transitioned.';

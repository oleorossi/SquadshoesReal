-- =============================================================================
-- Atomic upsert for purchase_order_items — closes lost-update race
-- =============================================================================
--
-- Problem (audit Agent1 #7): both materialAutoPO.ts:102-114 and
-- soleAutoPO.ts:174-202 read existingItem.quantity then UPDATE quantity =
-- existing + delta (no row lock, no ON CONFLICT). Two concurrent calls
-- (e.g. two PVs approved within the same second, or MRP + manual approval
-- racing) read the same baseline and write the lower of the two cumulative
-- quantities — the second-to-write effectively wins, the other delta is
-- lost. The PO total uses an atomic RPC (increment_purchase_order_total)
-- but the items themselves were left racy.
--
-- Fix: an SQL RPC that takes a SELECT FOR UPDATE on the existing item row
-- (or inserts atomically when none exists) and merges the grade JSONB
-- by summing per-size values. Replace SELECT-then-UPDATE in the two .ts
-- callers with this RPC.
--
-- Note: there is no UNIQUE (purchase_order_id, product_id) constraint on
-- the table because legacy POs may already have duplicate rows. We do not
-- add one here to avoid breaking the apply step. The RPC effectively
-- consolidates duplicates by always operating on the first matching row,
-- but if duplicates exist the planner may pick either. A future migration
-- can add the constraint after a one-shot consolidation pass.
-- =============================================================================

DROP FUNCTION IF EXISTS public.upsert_po_item_atomic(p_po_id          uuid, p_product_id     uuid, p_qty_delta      numeric, p_unit_price     numeric, p_unit           text, p_current_stock  numeric, p_min_stock      numeric, p_max_stock      numeric, p_grade_delta    jsonb, p_color          text) CASCADE;
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
  -- Lock the existing row (if any) to serialise concurrent callers
  SELECT id, quantity, COALESCE(grade, '{}'::jsonb)
    INTO v_item_id, v_old_qty, v_old_grade
    FROM public.purchase_order_items
   WHERE purchase_order_id = p_po_id
     AND product_id        = p_product_id
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;

  IF v_item_id IS NOT NULL THEN
    -- Merge grade by summing per-size values
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
    -- Atomic insert: same transaction holds row-level locks until commit
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

  RETURN jsonb_build_object(
    'item_id',  v_item_id,
    'inserted', v_inserted,
    'old_qty',  v_old_qty,
    'new_qty',  v_new_qty,
    'qty_delta_applied', v_new_qty - v_old_qty
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_po_item_atomic(
  uuid, uuid, numeric, numeric, text, numeric, numeric, numeric, jsonb, text
) TO authenticated, service_role;

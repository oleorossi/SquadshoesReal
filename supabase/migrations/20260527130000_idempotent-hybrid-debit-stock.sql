-- Make hybrid_debit_stock_for_order idempotent under retry.
--
-- Problem: the previous version (20260521130000) had no idempotency guard.
-- material_reservations has no UNIQUE(order_id, product_id) constraint, so
-- the ON CONFLICT DO NOTHING used in the sole_handled_by_grade branch is
-- silently a no-op (no conflict target exists). If the function is called
-- twice for the same p_order_id — e.g. the JS client retried after a DB
-- commit succeeded but the response was lost, or a double-click on
-- "Lançar OP" — the function would:
--   1. Phase 1 FOR UPDATE locks rows (now seeing already-debited quantity).
--   2. Phase 2 UPDATEs products.quantity = quantity - v_required AGAIN
--      (double debit).
--   3. INSERT a duplicate stock_movements row.
--   4. INSERT duplicate material_reservations rows.
--
-- Fix: at the very top of the function, take a transaction-scoped advisory
-- lock keyed on p_order_id (serializes any concurrent calls for the same
-- order) and check whether material_reservations already has rows for this
-- order in a non-cancelled state. If so, return early as a no-op.
--
-- The advisory lock auto-releases at COMMIT/ROLLBACK. The idempotency check
-- runs INSIDE that lock so two concurrent retries for the same order
-- serialize through the lock and only one runs the debit.

DROP FUNCTION IF EXISTS public.hybrid_debit_stock_for_order(p_reference_id uuid, p_order_quantity numeric, p_color text, p_order_id uuid, p_order_grade jsonb) CASCADE;
CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_order_id uuid,
  p_order_grade jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_pid uuid;
  v_name text;
  v_required numeric;
  v_available numeric;
  v_mode text;
  v_source text;
  v_result jsonb := '[]'::jsonb;
  v_size integer;
  v_snap_id uuid;
  v_soi_id uuid;
  v_sale_order_id uuid;
  v_product record;
  v_sole_handled_by_grade boolean;
  v_already_debited boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Serialize concurrent calls for the same order_id. Lock auto-releases at
  -- transaction end. hashtext() folds uuid → int4; collisions are harmless
  -- (cause unrelated orders to occasionally serialize) but make double-debit
  -- on the SAME order impossible.
  PERFORM pg_advisory_xact_lock(hashtext('hybrid_debit:' || p_order_id::text));

  -- Idempotency: if any non-cancelled reservation already exists for this
  -- order, a previous call already ran. Return a no-op result so retries
  -- don't double-debit. Cancelled reservations don't count — they belong to
  -- a previously-cancelled-then-recreated lifecycle that is allowed.
  SELECT EXISTS (
    SELECT 1 FROM public.material_reservations
     WHERE order_id = p_order_id
       AND status <> 'cancelled'
  ) INTO v_already_debited;

  IF v_already_debited THEN
    RETURN jsonb_build_object('snapshot_id', NULL, 'items', '[]'::jsonb, 'idempotent_skip', true);
  END IF;

  -- When grade is present, debit_sole_stock_by_grade will handle sole stock
  v_sole_handled_by_grade := (p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object');

  v_size := NULL;
  IF v_sole_handled_by_grade THEN
    SELECT key::integer INTO v_size
      FROM jsonb_each_text(p_order_grade)
     WHERE key ~ '^[0-9]+$'
     ORDER BY value::numeric DESC
     LIMIT 1;
  END IF;

  SELECT sale_order_id INTO v_sale_order_id FROM public.orders WHERE id = p_order_id;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT id INTO v_soi_id
      FROM public.sale_order_items
     WHERE sale_order_id = v_sale_order_id
       AND reference_id = p_reference_id
       AND COALESCE(color,'') = COALESCE(p_color,'')
     LIMIT 1;
  END IF;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT consumption_snapshot, id INTO v_items, v_snap_id
      FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_sale_order_id
       AND (sale_order_item_id IS NOT DISTINCT FROM v_soi_id)
     LIMIT 1;
  END IF;

  IF v_items IS NULL THEN
    IF v_sale_order_id IS NOT NULL THEN
      v_snap_id := public.freeze_technical_sheet(
        p_reference_id, v_sale_order_id, v_soi_id, p_color, p_order_quantity, v_size, p_order_grade
      );
      SELECT consumption_snapshot INTO v_items
        FROM public.technical_sheet_snapshots WHERE id = v_snap_id;
    ELSE
      IF v_sole_handled_by_grade THEN
        v_items := public.calculate_order_consumption_by_grade(p_reference_id, p_order_grade, p_color);
      ELSE
        SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
          INTO v_items
          FROM public.calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size) c;
      END IF;
    END IF;
  END IF;

  -- Phase 1: lock + fail-fast
  -- Skip sole stock check here when grade is present (debit_sole_stock_by_grade validates per-size)
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_source := v_item ->> 'source';

    -- When grade handles sole debit, skip sole validation here
    IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
      CONTINUE;
    END IF;

    SELECT id, quantity, name INTO v_product
      FROM public.products WHERE id = v_pid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % do snapshot não encontrado', v_pid;
    END IF;

    v_required := (v_item ->> 'required')::numeric;
    IF v_product.quantity < v_required AND (v_item ->> 'debit_mode') = 'hard' THEN
      RAISE EXCEPTION
        'Estoque insuficiente para % "%": disponível %, necessário %',
        v_item ->> 'component', v_product.name, v_product.quantity, v_required;
    END IF;
  END LOOP;

  -- Phase 2: actual debit
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_name   := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_mode   := v_item ->> 'debit_mode';
    v_source := v_item ->> 'source';

    SELECT quantity INTO v_available FROM public.products WHERE id = v_pid;

    -- Sole handled by debit_sole_stock_by_grade when grade is present:
    -- register reservation for traceability but skip the stock UPDATE
    IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft');

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'sole_deferred_to_grade'
      );
      CONTINUE;
    END IF;

    IF v_mode = 'hard' THEN
      UPDATE public.products
         SET quantity = GREATEST(0, quantity - v_required), updated_at = now()
       WHERE id = v_pid;

      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES
        (v_pid, 'out', v_required, v_available, v_available - v_required,
         'Débito OP ' || COALESCE(v_name,'') ||
         CASE WHEN COALESCE(p_color,'') <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, v_required, 'consumed', 'hard');

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'debited'
      );
    ELSE
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft');

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'reserved'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('snapshot_id', v_snap_id, 'items', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb) TO authenticated;

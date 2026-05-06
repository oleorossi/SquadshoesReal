-- Drop stale overloads of hybrid_debit_stock_for_order.
--
-- Diagnostic showed 3 versions of public.hybrid_debit_stock_for_order in the
-- deployed DB. Migration 20260527130000 only DROP'd the canonical signature
-- (uuid, numeric, text, uuid, jsonb) and recreated it — but at least 2 older
-- overloads with slightly different argument types (e.g. integer instead of
-- numeric) survived intact. They lack the advisory_lock + idempotent_skip
-- protection added in that migration: if PostgREST resolves a JS .rpc() call
-- to one of those stale versions due to argument-type matching, double-debit
-- is still possible.
--
-- This migration drops EVERY signature of hybrid_debit_stock_for_order and
-- recreates only the canonical idempotent version.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
      FROM pg_proc
     WHERE proname = 'hybrid_debit_stock_for_order'
       AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::text || ' CASCADE';
  END LOOP;
END $$;

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

  PERFORM pg_advisory_xact_lock(hashtext('hybrid_debit:' || p_order_id::text));

  SELECT EXISTS (
    SELECT 1 FROM public.material_reservations
     WHERE order_id = p_order_id
       AND status <> 'cancelled'
  ) INTO v_already_debited;

  IF v_already_debited THEN
    RETURN jsonb_build_object('snapshot_id', NULL, 'items', '[]'::jsonb, 'idempotent_skip', true);
  END IF;

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

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_source := v_item ->> 'source';

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

NOTIFY pgrst, 'reload schema';

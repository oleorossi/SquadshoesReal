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
  v_result jsonb := '[]'::jsonb;
  v_size integer;
BEGIN
  v_size := NULL;
  IF p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
    SELECT key::integer INTO v_size
    FROM jsonb_each_text(p_order_grade)
    WHERE key ~ '^[0-9]+$'
    ORDER BY value::numeric DESC
    LIMIT 1;
  END IF;

  v_items := calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) AS value LOOP
    IF (v_item ->> 'stock_ok')::boolean = false THEN
      RAISE EXCEPTION 'Estoque insuficiente para % "%": disponível %, necessário %',
        v_item ->> 'component',
        v_item ->> 'product_name',
        v_item ->> 'available',
        v_item ->> 'required';
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) AS value LOOP
    v_pid      := (v_item ->> 'product_id')::uuid;
    v_name     := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_available := (v_item ->> 'available')::numeric;
    v_mode     := v_item ->> 'debit_mode';

    IF v_mode = 'hard' THEN
      UPDATE products SET quantity = quantity - v_required, updated_at = now() WHERE id = v_pid;
      INSERT INTO stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES
        (v_pid, 'out', v_required, v_available, v_available - v_required,
         'Débito OP (' || v_name || ')' ||
         CASE WHEN p_color <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);
      INSERT INTO material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, v_required, 'consumed', 'hard');
      v_result := v_result || jsonb_build_object('product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'debited');
    ELSE
      INSERT INTO material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft');
      v_result := v_result || jsonb_build_object('product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'reserved');
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_consumption(uuid, numeric, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_material_product(text, text, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_sole_color(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb) TO authenticated;
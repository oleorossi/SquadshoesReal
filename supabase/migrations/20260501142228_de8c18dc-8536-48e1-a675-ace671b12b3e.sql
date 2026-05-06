CREATE OR REPLACE FUNCTION public.convert_reservation_to_out(
  p_order_id   uuid,
  p_product_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            RECORD;
  v_prev_qty   numeric;
  v_new_qty    numeric;
BEGIN
  FOR r IN
    SELECT mr.product_id, mr.quantity_reserved AS quantity, mr.id,
           p.quantity AS current_qty
      FROM public.material_reservations mr
      JOIN public.products p ON p.id = mr.product_id
     WHERE mr.order_id   = p_order_id
       AND (p_product_id IS NULL OR mr.product_id = p_product_id)
       AND mr.status = 'reserved'
     FOR UPDATE OF mr
  LOOP
    v_prev_qty := r.current_qty;
    v_new_qty  := r.current_qty - r.quantity;

    UPDATE public.products
       SET quantity       = v_new_qty,
           reserved_stock = GREATEST(COALESCE(reserved_stock, 0) - r.quantity, 0)
     WHERE id = r.product_id;

    UPDATE public.material_reservations
       SET status     = 'converted',
           updated_at = now()
     WHERE id = r.id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity,
      previous_stock, new_stock,
      description, order_id
    ) VALUES (
      r.product_id, 'out', r.quantity,
      v_prev_qty, v_new_qty,
      'Conversão de reserva → débito (entrada em Corte) — OP ' || p_order_id::text,
      p_order_id
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_reservation_to_out(uuid, uuid) TO authenticated;
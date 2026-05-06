CREATE OR REPLACE FUNCTION public.debit_packaging_stock(
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_box_id     uuid;
  v_label_id   uuid;
  v_total_pairs integer;
  v_prev_qty   numeric;
  v_new_qty    numeric;
BEGIN
  -- 1. Obter os IDs dos materiais de embalagem associados ao produto da OP
  -- e o total de pares da OP
  SELECT 
    p.box_id, 
    p.label_id,
    COALESCE(SUM(oi.quantity), 0)
  INTO 
    v_box_id, 
    v_label_id,
    v_total_pairs
  FROM public.production_orders po
  JOIN public.products p ON p.id = po.product_id
  LEFT JOIN public.production_order_items oi ON oi.production_order_id = po.id
  WHERE po.id = p_order_id
  GROUP BY p.box_id, p.label_id;

  IF v_total_pairs <= 0 THEN
    RETURN;
  END IF;

  -- 2. Debitar Caixas (Box)
  IF v_box_id IS NOT NULL THEN
    SELECT quantity INTO v_prev_qty FROM public.products WHERE id = v_box_id FOR UPDATE;
    v_new_qty := v_prev_qty - v_total_pairs;
    
    UPDATE public.products 
    SET quantity = v_new_qty, 
        updated_at = now() 
    WHERE id = v_box_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity,
      previous_stock, new_stock,
      description, order_id
    ) VALUES (
      v_box_id, 'out', v_total_pairs,
      v_prev_qty, v_new_qty,
      'Débito automático de caixas (entrada em Embalagem) — OP ' || p_order_id::text,
      p_order_id
    );
  END IF;

  -- 3. Debitar Etiquetas (Label)
  IF v_label_id IS NOT NULL THEN
    SELECT quantity INTO v_prev_qty FROM public.products WHERE id = v_label_id FOR UPDATE;
    v_new_qty := v_prev_qty - v_total_pairs;
    
    UPDATE public.products 
    SET quantity = v_new_qty, 
        updated_at = now() 
    WHERE id = v_label_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity,
      previous_stock, new_stock,
      description, order_id
    ) VALUES (
      v_label_id, 'out', v_total_pairs,
      v_prev_qty, v_new_qty,
      'Débito automático de etiquetas (entrada em Embalagem) — OP ' || p_order_id::text,
      p_order_id
    );
  END IF;

END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_stock(uuid) TO authenticated;
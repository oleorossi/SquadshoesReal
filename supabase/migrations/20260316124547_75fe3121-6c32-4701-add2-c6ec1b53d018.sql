
-- 1. Create no-op debit_strap_materials so debit_stock_for_order doesn't crash
CREATE OR REPLACE FUNCTION public.debit_strap_materials(p_reference_id uuid, p_order_quantity integer, p_color text, p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Strap debit is handled client-side via debit_strap_stock with user-chosen colors
  NULL;
END;
$$;

-- 2. Recreate debit_strap_stock with optional order_id parameter
CREATE OR REPLACE FUNCTION public.debit_strap_stock(p_strap_colors jsonb, p_order_quantity integer, p_order_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_product_id uuid;
  v_product_name text;
  v_current_qty numeric;
  v_required numeric;
  v_consumption numeric;
BEGIN
  IF p_strap_colors IS NULL OR jsonb_typeof(p_strap_colors) != 'array' OR jsonb_array_length(p_strap_colors) = 0 THEN
    RETURN;
  END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(p_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';
    
    BEGIN
      v_group_id := (v_strap ->> 'group_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_group_id := NULL;
    END;

    IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN
      CONTINUE;
    END IF;

    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 1);
    IF v_consumption <= 0 THEN
      v_consumption := 1;
    END IF;

    v_required := v_consumption * p_order_quantity;

    SELECT p.id, p.name, p.quantity
    INTO v_product_id, v_product_name, v_current_qty
    FROM public.products p
    WHERE p.active = true
      AND p.group_id = v_group_id
      AND p.color = v_color
    LIMIT 1;

    IF v_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity
      INTO v_product_id, v_product_name, v_current_qty
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_group_id
      LIMIT 1;
    END IF;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Material da tira nao encontrado no estoque (grupo: %)', v_group_id;
    END IF;

    IF v_current_qty < v_required THEN
      RAISE EXCEPTION 'Estoque insuficiente para tira "%" (cor: %): disponivel %, necessario %',
        v_product_name, v_color, v_current_qty, v_required;
    END IF;

    UPDATE public.products SET quantity = quantity - v_required, updated_at = now() WHERE id = v_product_id;
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (v_product_id, 'out', v_required, v_current_qty, v_current_qty - v_required,
            'Debito Tira (' || COALESCE(v_product_name, '') || ') Cor: ' || v_color || ' - ' || v_consumption || 'm x ' || p_order_quantity || ' pares',
            p_order_id);
  END LOOP;
END;
$$;

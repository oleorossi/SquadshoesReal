
DROP FUNCTION IF EXISTS public.debit_strap_stock(
  p_strap_colors jsonb,
  p_order_quantity integer
) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_strap_stock(
  p_strap_colors jsonb,
  p_order_quantity integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_product_id uuid;
  v_product_name text;
  v_current_qty numeric;
  v_required numeric;
BEGIN
  IF p_strap_colors IS NULL OR jsonb_typeof(p_strap_colors) != 'array' OR jsonb_array_length(p_strap_colors) = 0 THEN
    RETURN;
  END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(p_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';
    
    -- Try to get group_id
    BEGIN
      v_group_id := (v_strap ->> 'group_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_group_id := NULL;
    END;

    -- Skip if no group or no color
    IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN
      CONTINUE;
    END IF;

    -- Each strap consumes 1 unit per pair
    v_required := p_order_quantity;

    -- Find matching product: same group + same color
    SELECT p.id, p.name, p.quantity
    INTO v_product_id, v_product_name, v_current_qty
    FROM public.products p
    WHERE p.active = true
      AND p.group_id = v_group_id
      AND p.color = v_color
    LIMIT 1;

    IF v_product_id IS NULL THEN
      -- Fallback: try any product in the group
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

    -- Debit
    UPDATE public.products SET quantity = quantity - v_required, updated_at = now() WHERE id = v_product_id;
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description)
    VALUES (v_product_id, 'out', v_required, v_current_qty, v_current_qty - v_required,
            'Debito Tira (' || COALESCE(v_product_name, '') || ') Cor: ' || v_color);
  END LOOP;
END;
$$;

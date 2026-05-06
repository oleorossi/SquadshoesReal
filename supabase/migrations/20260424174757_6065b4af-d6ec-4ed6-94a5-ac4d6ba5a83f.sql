-- Update restore_product_stocks_for_order to handle box_types (packaging)
DROP FUNCTION IF EXISTS public.restore_product_stocks_for_order(p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      RECORD;
  v_prev_qty numeric;
  v_new_qty  numeric;
  v_is_box   boolean;
BEGIN
  -- Aggregate all 'out' movements for this order per product
  FOR v_row IN
    SELECT product_id, SUM(quantity) AS total_qty
    FROM stock_movements
    WHERE order_id = p_order_id
      AND movement_type = 'out'
    GROUP BY product_id
  LOOP
    -- Check if product_id exists in box_types
    SELECT EXISTS(SELECT 1 FROM box_types WHERE id = v_row.product_id) INTO v_is_box;

    IF v_is_box THEN
      -- Increment stock in box_types and capture before/after values
      UPDATE box_types
      SET quantity = quantity + v_row.total_qty, updated_at = now()
      WHERE id = v_row.product_id
      RETURNING quantity - v_row.total_qty, quantity
      INTO v_prev_qty, v_new_qty;
    ELSE
      -- Increment stock in products and capture before/after values
      UPDATE products
      SET quantity = quantity + v_row.total_qty, updated_at = now()
      WHERE id = v_row.product_id
      RETURNING quantity - v_row.total_qty, quantity
      INTO v_prev_qty, v_new_qty;
    END IF;

    IF FOUND THEN
      INSERT INTO stock_movements(
        product_id, movement_type, quantity,
        previous_stock, v_new_qty, -- Note: the column name is new_stock, but we use variables here
        description, order_id
      ) VALUES (
        v_row.product_id, 'in', v_row.total_qty,
        v_prev_qty, v_new_qty,
        'Estorno automático - Exclusão de OP',
        p_order_id
      );
    END IF;
  END LOOP;
END;
$$;

-- Fix the column name in the INSERT (v_new_qty was a typo in my thought, fixing to new_stock)
DROP FUNCTION IF EXISTS public.restore_product_stocks_for_order(p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      RECORD;
  v_prev_qty numeric;
  v_new_qty  numeric;
  v_is_box   boolean;
BEGIN
  FOR v_row IN
    SELECT product_id, SUM(quantity) AS total_qty
    FROM stock_movements
    WHERE order_id = p_order_id
      AND movement_type = 'out'
    GROUP BY product_id
  LOOP
    SELECT EXISTS(SELECT 1 FROM box_types WHERE id = v_row.product_id) INTO v_is_box;

    IF v_is_box THEN
      UPDATE box_types
      SET quantity = quantity + v_row.total_qty, updated_at = now()
      WHERE id = v_row.product_id
      RETURNING (quantity - v_row.total_qty), quantity
      INTO v_prev_qty, v_new_qty;
    ELSE
      UPDATE products
      SET quantity = quantity + v_row.total_qty, updated_at = now()
      WHERE id = v_row.product_id
      RETURNING (quantity - v_row.total_qty), quantity
      INTO v_prev_qty, v_new_qty;
    END IF;

    IF FOUND THEN
      INSERT INTO stock_movements(
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        v_row.product_id, 'in', v_row.total_qty,
        v_prev_qty, v_new_qty,
        'Estorno automático - Exclusão de OP',
        p_order_id
      );
    END IF;
  END LOOP;
END;
$$;

-- Fix: restore_product_stocks_for_order was only restoring to `products` table,
-- but packaging debited via box_type_id updates `box_types` (a separate table).
-- This caused box_types stock to be permanently lost when an OP was cancelled.
-- Fix: attempt restore in `products` first; if not found, restore in `box_types`.

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
BEGIN
  FOR v_row IN
    SELECT product_id, SUM(quantity) AS total_qty
    FROM stock_movements
    WHERE order_id = p_order_id
      AND movement_type = 'out'
    GROUP BY product_id
  LOOP
    -- Try products table first
    UPDATE products
    SET quantity = quantity + v_row.total_qty
    WHERE id = v_row.product_id
    RETURNING quantity - v_row.total_qty, quantity
    INTO v_prev_qty, v_new_qty;

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
    ELSE
      -- Not a product — try box_types (packaging stock)
      UPDATE box_types
      SET quantity = quantity + v_row.total_qty
      WHERE id = v_row.product_id
      RETURNING quantity - v_row.total_qty, quantity
      INTO v_prev_qty, v_new_qty;

      IF FOUND THEN
        INSERT INTO stock_movements(
          product_id, movement_type, quantity,
          previous_stock, new_stock, description, order_id
        ) VALUES (
          v_row.product_id, 'in', v_row.total_qty,
          v_prev_qty, v_new_qty,
          'Estorno automático embalagem - Exclusão de OP',
          p_order_id
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_product_stocks_for_order(uuid) TO authenticated;

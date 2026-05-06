-- =============================================================================
-- PERFORMANCE: batch stock restore for order deletion
-- Replaces N read+write round-trips in useOrders.ts with a single RPC call.
-- =============================================================================

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
BEGIN
  -- Aggregate all 'out' movements for this order per product
  FOR v_row IN
    SELECT product_id, SUM(quantity) AS total_qty
    FROM stock_movements
    WHERE order_id = p_order_id
      AND movement_type = 'out'
    GROUP BY product_id
  LOOP
    -- Increment stock and capture before/after values atomically
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
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_product_stocks_for_order(uuid) TO authenticated;

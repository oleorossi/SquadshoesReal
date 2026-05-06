-- =============================================================================
-- Audit-2 Batch I: make restore_product_stocks_for_order idempotent
-- =============================================================================
--
-- The previous version (from 20260426160000_fix-restore-box-types-stock.sql)
-- summed every 'out' movement for the order and added the total back to the
-- product, regardless of whether the same restore had already happened.
-- Calling the function twice (UI bug, retry, manual cancel after auto cancel)
-- inflated stock by the original debit amount on each extra call.
--
-- Fix: compute the NET outstanding debit per product
--   net = SUM(out) - SUM(in for this order on this product)
-- and only restore products whose net is still > 0. After the first restore,
-- net == 0 and subsequent calls become no-ops.
--
-- Also restores box_types on the same idempotent basis.
-- =============================================================================

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
    SELECT product_id,
           -- Net debit still owed back to stock for this order.
           -- 'out' movements are debits, 'in' movements are restores; if a
           -- previous restore already credited the product the net drops to 0.
           SUM(CASE WHEN movement_type = 'out' THEN quantity ELSE 0 END)
           - SUM(CASE WHEN movement_type = 'in'  THEN quantity ELSE 0 END) AS total_qty
    FROM stock_movements
    WHERE order_id = p_order_id
      AND movement_type IN ('out', 'in')
    GROUP BY product_id
    HAVING SUM(CASE WHEN movement_type = 'out' THEN quantity ELSE 0 END)
         - SUM(CASE WHEN movement_type = 'in'  THEN quantity ELSE 0 END) > 0
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

COMMENT ON FUNCTION public.restore_product_stocks_for_order(uuid) IS
  'Idempotent restore: credits back to stock the NET (out − in) movement for '
  'the order. After the first call the net is 0, so repeat calls are no-ops.';

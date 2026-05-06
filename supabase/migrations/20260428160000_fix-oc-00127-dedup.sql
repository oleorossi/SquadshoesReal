-- Fix OC-2026-00127: remove duplicate purchase_order_items caused by the
-- generateAutoPurchaseOrders bug (items were appended without dedup check).
-- Keeps the entry with the highest quantity per product_id, recalculates total_value.

DO $$
DECLARE
  v_po_id uuid;
  v_total  numeric;
BEGIN
  SELECT id INTO v_po_id
    FROM purchase_orders
   WHERE order_number = 'OC-2026-00127';

  IF v_po_id IS NULL THEN
    RAISE NOTICE 'OC-2026-00127 não encontrada — nada a fazer.';
    RETURN;
  END IF;

  -- Remove duplicates: for each product_id keep the row with the highest quantity
  -- (= the most recent / largest deficit). Ties broken by latest created_at.
  DELETE FROM purchase_order_items
   WHERE purchase_order_id = v_po_id
     AND id NOT IN (
           SELECT DISTINCT ON (product_id) id
             FROM purchase_order_items
            WHERE purchase_order_id = v_po_id
            ORDER BY product_id, quantity DESC, created_at DESC
         );

  -- Recalculate total_value from the remaining (deduplicated) items
  SELECT COALESCE(SUM(quantity * unit_price), 0)
    INTO v_total
    FROM purchase_order_items
   WHERE purchase_order_id = v_po_id;

  UPDATE purchase_orders
     SET total_value = v_total
   WHERE id = v_po_id;

  RAISE NOTICE 'OC-2026-00127 corrigida — duplicatas removidas, total atualizado para R$ %', v_total;
END;
$$;

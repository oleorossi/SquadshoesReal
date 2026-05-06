
-- 1) Cleanup orphan empty sale order from failed duplication
DELETE FROM public.sale_orders
WHERE order_number = 'PV-2026-00096'
  AND NOT EXISTS (SELECT 1 FROM public.sale_order_items WHERE sale_order_id = sale_orders.id);

-- 2) Helper function to safely roll back an empty sale order
CREATE OR REPLACE FUNCTION public.delete_empty_sale_order(p_sale_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.sale_order_items WHERE sale_order_id = p_sale_order_id;
  IF v_count > 0 THEN
    RETURN false;
  END IF;
  DELETE FROM public.sale_orders WHERE id = p_sale_order_id;
  RETURN true;
END;
$$;

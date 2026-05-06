DROP FUNCTION IF EXISTS public.sync_product_quantity_from_movements() CASCADE;
CREATE OR REPLACE FUNCTION public.sync_product_quantity_from_movements()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product_id uuid;
  v_new_qty numeric;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);

  SELECT COALESCE(SUM(
    CASE WHEN movement_type = 'in' THEN quantity
         WHEN movement_type = 'out' THEN -quantity
         WHEN movement_type = 'adjustment' THEN quantity
         ELSE 0
    END
  ), 0)
  INTO v_new_qty
  FROM public.stock_movements
  WHERE product_id = v_product_id;

  UPDATE public.products
     SET quantity   = v_new_qty,
         updated_at = now()
   WHERE id = v_product_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_qty ON public.stock_movements;
CREATE TRIGGER trg_sync_product_qty
AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.sync_product_quantity_from_movements();
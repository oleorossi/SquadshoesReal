DROP FUNCTION IF EXISTS public.recalc_purchase_order_total() CASCADE;
CREATE OR REPLACE FUNCTION public.recalc_purchase_order_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.purchase_orders
     SET total_value = COALESCE((
           SELECT SUM(COALESCE(quantity, 0) * COALESCE(unit_price, 0))
             FROM public.purchase_order_items
            WHERE purchase_order_id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id)
         ), 0),
         updated_at = now()
   WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_purchase_order_total ON public.purchase_order_items;

CREATE TRIGGER trg_sync_purchase_order_total
AFTER INSERT OR UPDATE OF quantity, unit_price OR DELETE
ON public.purchase_order_items
FOR EACH ROW EXECUTE FUNCTION public.recalc_purchase_order_total();
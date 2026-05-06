-- =============================================================================
-- Add trigger to keep purchase_orders.total_value in sync with items
-- =============================================================================
-- sale_orders has trg_sync_sale_order_total (migration 20260504160000).
-- purchase_orders had no equivalent — editing an item quantity/price in
-- PurchaseOrders.tsx left the PO header total stale until the next full reload.
-- upsert_po_item_atomic already maintains the total atomically for its callers,
-- but direct item INSERT/UPDATE (PurchaseOrders OrderDetailDialog edit flow)
-- bypasses the RPC and still needs a backstop.
-- =============================================================================

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

COMMENT ON FUNCTION public.recalc_purchase_order_total() IS
  'Keeps purchase_orders.total_value = SUM(qty * unit_price) of items, mirroring trg_sync_sale_order_total.';

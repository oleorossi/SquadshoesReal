-- ---------------------------------------------------------------
-- Add RPC: increment_purchase_order_total
--
-- Replaces the read-modify-write pattern in materialAutoPO.ts
-- and soleAutoPO.ts with a single atomic UPDATE that avoids
-- lost-update race conditions when two processes simultaneously
-- add items to the same open purchase order.
--
-- Usage (from JS):
--   supabase.rpc('increment_purchase_order_total', {
--     p_po_id: openPO.id,
--     p_delta: shortageQty * unitPrice,
--   })
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.increment_purchase_order_total(
  p_po_id uuid,
  p_delta numeric
) CASCADE;
CREATE OR REPLACE FUNCTION public.increment_purchase_order_total(
  p_po_id uuid,
  p_delta numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.purchase_orders
     SET total_value = COALESCE(total_value, 0) + p_delta,
         updated_at  = now()
   WHERE id = p_po_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de compra % não encontrada', p_po_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_purchase_order_total(uuid, numeric) TO authenticated;

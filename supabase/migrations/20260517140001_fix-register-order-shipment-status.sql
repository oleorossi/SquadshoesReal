-- =============================================================================
-- Fix register_order_shipment: atomically advance status to Expedido
-- =============================================================================
-- The original function (20260516120000) only set shipped_at = now() and
-- checked shipped_at IS NULL.  It did NOT check or update status.
-- The frontend (OrderPickingPage.tsx) then did a separate .update({status:'Expedido'})
-- with .eq('status','Faturado').
--
-- Problem: any order with shipped_at IS NULL but status != 'Faturado' would
-- get shipped_at stamped by the RPC but its status would NOT advance.  Also,
-- two discrete writes create a short window where shipped_at is set but status
-- is still 'Faturado' — a concurrent read could see a partially-transitioned row.
--
-- Fix: add AND status = 'Faturado' to the WHERE clause and atomically set
-- status = 'Expedido' in the same UPDATE.  The frontend's separate status update
-- becomes a safe no-op (already 'Expedido') rather than a correctness dependency.
-- =============================================================================

DROP FUNCTION IF EXISTS public.register_order_shipment(p_sale_order_ids uuid[], p_manifest_id    uuid, p_checked_by     text) CASCADE;
CREATE OR REPLACE FUNCTION public.register_order_shipment(
  p_sale_order_ids uuid[],
  p_manifest_id    uuid  DEFAULT NULL,
  p_checked_by     text  DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.sale_orders
     SET shipped_at  = now(),
         checked_by  = p_checked_by,
         status      = 'Expedido'
   WHERE id          = ANY(p_sale_order_ids)
     AND status      = 'Faturado'
     AND shipped_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_manifest_id IS NOT NULL AND v_count > 0 THEN
    UPDATE public.loading_manifest_items
       SET sale_order_id = sub.id
      FROM unnest(p_sale_order_ids) AS sub(id)
     WHERE loading_manifest_items.manifest_id     = p_manifest_id
       AND loading_manifest_items.sale_order_id  IS NULL
     LIMIT v_count;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_order_shipment(uuid[], uuid, text) TO authenticated;

COMMENT ON FUNCTION public.register_order_shipment(uuid[], uuid, text) IS
  'Atomically sets shipped_at + status=Expedido for Faturado orders. Returns count of rows actually transitioned.';

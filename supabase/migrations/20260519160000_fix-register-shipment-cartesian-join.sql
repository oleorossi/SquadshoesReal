-- =============================================================================
-- Fix register_order_shipment: deterministic manifest item assignment
-- =============================================================================
-- The previous version (20260517140000) had a Cartesian join when assigning
-- sale_order_ids to loading_manifest_items:
--
--   UPDATE loading_manifest_items
--      SET sale_order_id = sub.id
--     FROM unnest(p_sale_order_ids) AS sub(id)
--    WHERE manifest_id = p_manifest_id AND sale_order_id IS NULL
--    LIMIT v_count;
--
-- Every NULL manifest item was paired with every unnested sale_order_id, and
-- PostgreSQL picked an assignment per target row (implementation-defined).
-- LIMIT without ORDER BY is also non-deterministic. This could assign the
-- wrong sale_order to the wrong manifest line.
--
-- Fix: match rows using row_number() so each manifest item gets exactly one
-- sale_order_id in arrival order (created_at, id as tie-breaker).
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
    -- Match manifest items to sale orders by position rather than Cartesian join.
    WITH ordered_ids AS (
      SELECT id, row_number() OVER () AS rn
        FROM unnest(p_sale_order_ids) AS sub(id)
    ),
    ordered_items AS (
      SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
        FROM public.loading_manifest_items
       WHERE manifest_id    = p_manifest_id
         AND sale_order_id IS NULL
    )
    UPDATE public.loading_manifest_items lmi
       SET sale_order_id = oi.id
      FROM ordered_items oitm
      JOIN ordered_ids oi USING (rn)
     WHERE lmi.id = oitm.id;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_order_shipment(uuid[], uuid, text) TO authenticated;

COMMENT ON FUNCTION public.register_order_shipment(uuid[], uuid, text) IS
  'Atomically sets shipped_at + status=Expedido for Faturado orders. Assigns manifest items by position. Returns count of rows actually transitioned.';

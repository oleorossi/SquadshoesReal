CREATE OR REPLACE FUNCTION public.register_order_shipment(
  p_sale_order_ids uuid[],
  p_manifest_id    uuid DEFAULT NULL,
  p_checked_by     text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.sale_orders
     SET shipped_at = now(),
         checked_by = p_checked_by,
         status     = 'Expedido'
   WHERE id         = ANY(p_sale_order_ids)
     AND status     = 'Faturado'
     AND shipped_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_manifest_id IS NOT NULL AND v_count > 0 THEN
    INSERT INTO public.loading_manifest_items (manifest_id, sale_order_id)
    SELECT p_manifest_id, unnest(p_sale_order_ids)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_order_shipment(uuid[], uuid, text) TO authenticated;
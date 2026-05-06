-- =============================================================================
-- Add server-side NF-e authorization check to register_order_shipment
-- =============================================================================
-- Audit-32 finding [2]: register_order_shipment (SECURITY DEFINER) sets
-- sale_orders.status='Expedido' for Faturado orders without verifying that an
-- authorized NF-e exists. The TypeScript-layer NF-e check in
-- useUpdateSaleOrderStatus is bypassed when the Order Picking page calls this
-- RPC directly. Physical goods could leave the warehouse without a SEFAZ-
-- authorized fiscal document — a regulatory compliance risk.
--
-- The check is skipped when ambiente='homologacao' (test environment) to avoid
-- blocking developer workflows.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_order_shipment(
  p_sale_order_ids uuid[],
  p_manifest_id    uuid  DEFAULT NULL,
  p_checked_by     text  DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_sid   uuid;
  v_nfe_ok boolean;
  v_ambiente text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Server-side NF-e guard: refuse shipment of orders that have no authorized NF-e.
  -- Bypassed in homologacao to avoid blocking developer/test workflows.
  SELECT COALESCE(MAX(ambiente), 'homologacao')
    INTO v_ambiente
    FROM public.companies
   WHERE active = true
   LIMIT 1;

  IF v_ambiente = 'producao' THEN
    FOREACH v_sid IN ARRAY p_sale_order_ids LOOP
      SELECT EXISTS (
        SELECT 1 FROM public.nfe_emitidas
         WHERE sale_order_id = v_sid AND status = 'autorizada'
      ) INTO v_nfe_ok;
      IF NOT v_nfe_ok THEN
        RAISE EXCEPTION
          'Pedido % não pode ser expedido: nenhuma NF-e autorizada encontrada.',
          v_sid;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.sale_orders
     SET shipped_at  = now(),
         checked_by  = p_checked_by,
         status      = 'Expedido'
   WHERE id          = ANY(p_sale_order_ids)
     AND status      = 'Faturado'
     AND shipped_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_manifest_id IS NOT NULL AND v_count > 0 THEN
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
  'Atomically sets shipped_at + status=Expedido for Faturado orders. Requires approved user and authorized NF-e (production environment). Returns count of rows actually transitioned.';

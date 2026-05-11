-- =============================================================================
-- Auditoria pós-update: 3 fixes críticos
-- =============================================================================
-- #1 — convert_reservation_to_out: DUPLO DECREMENTO de reserved_stock
--   Após migration 20260617120000 (round 6) o trigger
--   tg_sync_reserved_stock_on_update decrementa reserved_stock quando status
--   sai de 'reserved'→'converted'. A função ainda fazia UPDATE manual
--   `reserved_stock -= quantity` antes do UPDATE status → 2× decremento.
--   Fix: remover decremento manual; setar quantity_consumed pra o trigger
--   contabilizar corretamente o consume total.
--
-- #2 — RLS bypass em time_record_manual_overrides
--   Policy "Auth users can insert manual overrides" tinha WITH CHECK (true)
--   → qualquer autenticado podia injetar override de horas no próprio
--   registro via DevTools. Restringe a admin/gerente (mesma estratégia
--   aplicada em bank_hours_movements no round 20260615120000).
--
-- #5 — 10 SECURITY DEFINER VIEWs (advisor ERROR)
--   Views criadas com SECURITY DEFINER bypassam RLS do usuário consultante
--   (rodam como criador). Risco se exposto a anon ou se usuário comum
--   acessa dados que RLS deveria restringir. Fix: SET security_invoker=true
--   força avaliação de RLS no contexto do caller.
-- =============================================================================

-- ─── #1: convert_reservation_to_out sem duplo decremento ────────────────────
CREATE OR REPLACE FUNCTION public.convert_reservation_to_out(
  p_order_id   uuid,
  p_product_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT product_id, quantity_reserved AS quantity, id
      FROM public.material_reservations
     WHERE order_id = p_order_id
       AND (p_product_id IS NULL OR product_id = p_product_id)
       AND status = 'reserved'
       FOR UPDATE
  LOOP
    -- Decrementa só products.quantity (estoque físico).
    -- products.reserved_stock fica para o trigger tg_sync_reserved_stock_on_update
    -- decrementar quando o UPDATE de status disparar.
    UPDATE public.products
       SET quantity = quantity - r.quantity,
           updated_at = now()
     WHERE id = r.product_id;

    -- Marca consumo total + status='converted'. Trigger AFTER UPDATE
    -- vai decrementar reserved_stock por (quantity_reserved - quantity_consumed).
    UPDATE public.material_reservations
       SET status            = 'converted',
           quantity_consumed = COALESCE(quantity_reserved, 0),
           updated_at        = now()
     WHERE id = r.id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_reservation_to_out(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.convert_reservation_to_out(uuid, uuid) IS
  'Converte reserva→saída de estoque. Decrementa products.quantity e marca '
  'material_reservations.status=converted+quantity_consumed=quantity_reserved. '
  'NÃO decrementa reserved_stock manualmente — delega ao trigger '
  'tg_sync_reserved_stock_on_update pra evitar duplo decremento.';

-- ─── #2: tighten RLS em time_record_manual_overrides ────────────────────────
DROP POLICY IF EXISTS "Auth users can insert manual overrides"
  ON public.time_record_manual_overrides;
DROP POLICY IF EXISTS "Auth users can view manual overrides"
  ON public.time_record_manual_overrides;
DROP POLICY IF EXISTS "RH roles can insert manual overrides"
  ON public.time_record_manual_overrides;
DROP POLICY IF EXISTS "RH roles can update manual overrides"
  ON public.time_record_manual_overrides;
DROP POLICY IF EXISTS "RH roles can delete manual overrides"
  ON public.time_record_manual_overrides;
DROP POLICY IF EXISTS "All authenticated can view manual overrides"
  ON public.time_record_manual_overrides;

-- SELECT: todos autenticados leem (relatórios/dashboards).
CREATE POLICY "All authenticated can view manual overrides"
  ON public.time_record_manual_overrides FOR SELECT TO authenticated
  USING (true);

-- INSERT/UPDATE/DELETE: apenas admin e gerente.
CREATE POLICY "RH roles can insert manual overrides"
  ON public.time_record_manual_overrides FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role IN ('admin'::app_role, 'gerente'::app_role)
    )
  );

CREATE POLICY "RH roles can update manual overrides"
  ON public.time_record_manual_overrides FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role IN ('admin'::app_role, 'gerente'::app_role)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role IN ('admin'::app_role, 'gerente'::app_role)
    )
  );

CREATE POLICY "RH roles can delete manual overrides"
  ON public.time_record_manual_overrides FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role IN ('admin'::app_role, 'gerente'::app_role)
    )
  );

-- ─── #5: SECURITY DEFINER → security_invoker em 10 views ────────────────────
-- Lista vinda do advisor (level=ERROR). security_invoker=true faz a view
-- avaliar RLS no contexto do usuário consultante, não do criador.
ALTER VIEW public.v_open_service_orders                  SET (security_invoker = true);
ALTER VIEW public.v_technical_sheets_audit_summary       SET (security_invoker = true);
ALTER VIEW public.v_technical_sheets_audit               SET (security_invoker = true);
ALTER VIEW public.v_companies_cert_status                SET (security_invoker = true);
ALTER VIEW public.v_soles_with_specs                     SET (security_invoker = true);
ALTER VIEW public.v_open_purchase_orders                 SET (security_invoker = true);
ALTER VIEW public.v_soles_audit                          SET (security_invoker = true);
ALTER VIEW public.v_products_missing_supplier_active_demand SET (security_invoker = true);
ALTER VIEW public.v_pv_outdated_status                   SET (security_invoker = true);
ALTER VIEW public.v_products_missing_supplier            SET (security_invoker = true);

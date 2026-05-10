-- =============================================================================
-- Auditoria UX (item R3): tighten RLS em bank_hours_movements
-- =============================================================================
-- Antes: policy "Approved can write" permitia INSERT/UPDATE/DELETE pra
-- qualquer usuário autenticado. Risco: qualquer logado podia dar 100h
-- de crédito a si mesmo via DevTools.
-- Agora: apenas roles admin/gerente podem escrever. Read continua aberta
-- pra todos autenticados (relatórios, dashboards).
-- =============================================================================

DROP POLICY IF EXISTS "Approved can write bank_hours_movements" ON public.bank_hours_movements;

CREATE POLICY "Only RH roles can insert bank_hours_movements"
  ON public.bank_hours_movements FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin'::app_role, 'gerente'::app_role)
    )
  );

CREATE POLICY "Only RH roles can update bank_hours_movements"
  ON public.bank_hours_movements FOR UPDATE TO authenticated
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

CREATE POLICY "Only RH roles can delete bank_hours_movements"
  ON public.bank_hours_movements FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin'::app_role, 'gerente'::app_role)
    )
  );

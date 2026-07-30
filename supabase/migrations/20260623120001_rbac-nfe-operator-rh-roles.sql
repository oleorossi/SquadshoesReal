-- =============================================================================
-- RBAC: novas roles nfe_operator e rh
-- =============================================================================
-- Adiciona 2 roles ao enum app_role e ajusta policies pra dar acesso restrito:
--
-- nfe_operator: emite/cancela NF-e + cadastra cliente/empresa fiscal +
--               vê PV com valor. NÃO tem acesso a AR/AP/DRE/banco/folha.
--
-- rh:          cadastros, ponto, banco de horas, escalas, faltas, terceirizados.
--              NÃO tem acesso a folha de pagamento (admin/gerente apenas) nem
--              a financeiro empresa (AR/AP/DRE).
-- =============================================================================

-- 1) Enum app_role
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'nfe_operator';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'rh';

-- 2) nfe_emitidas: admin, gerente, nfe_operator
DROP POLICY IF EXISTS rls_nfe_emitidas_all ON public.nfe_emitidas;
CREATE POLICY rls_nfe_emitidas_all ON public.nfe_emitidas
  FOR ALL TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente','nfe_operator']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','nfe_operator']));

-- 3) companies (config fiscal emitente): admin, gerente, nfe_operator
DROP POLICY IF EXISTS rls_companies_write ON public.companies;
CREATE POLICY rls_companies_write ON public.companies
  FOR ALL TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente','nfe_operator']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','nfe_operator']));

-- 4) bank_hours_movements: admin, gerente, rh
DROP POLICY IF EXISTS "Only RH roles can insert bank_hours_movements" ON public.bank_hours_movements;
CREATE POLICY "Only RH roles can insert bank_hours_movements"
  ON public.bank_hours_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY(ARRAY['admin'::app_role, 'gerente'::app_role, 'rh'::app_role])
    )
  );

DROP POLICY IF EXISTS "Only RH roles can update bank_hours_movements" ON public.bank_hours_movements;
CREATE POLICY "Only RH roles can update bank_hours_movements"
  ON public.bank_hours_movements
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY(ARRAY['admin'::app_role, 'gerente'::app_role, 'rh'::app_role])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY(ARRAY['admin'::app_role, 'gerente'::app_role, 'rh'::app_role])
    )
  );

DROP POLICY IF EXISTS "Only RH roles can delete bank_hours_movements" ON public.bank_hours_movements;
CREATE POLICY "Only RH roles can delete bank_hours_movements"
  ON public.bank_hours_movements
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY(ARRAY['admin'::app_role, 'gerente'::app_role, 'rh'::app_role])
    )
  );

COMMENT ON POLICY rls_nfe_emitidas_all ON public.nfe_emitidas IS
  'Admin, gerente e nfe_operator podem CRUD em nfe_emitidas. nfe_operator é a role dedicada à emissão de NF-e sem acesso a AR/AP/DRE.';

COMMENT ON POLICY rls_companies_write ON public.companies IS
  'Admin, gerente e nfe_operator podem CRUD em companies (config fiscal emitente). nfe_operator precisa cadastrar/atualizar dados fiscais.';

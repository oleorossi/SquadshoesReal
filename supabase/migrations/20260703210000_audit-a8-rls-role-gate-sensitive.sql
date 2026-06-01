-- =============================================================================
-- AUDITORIA A8 (alto, conservador): gate de ESCRITA por papel nas tabelas sensíveis
-- =============================================================================
-- As policies de escrita destas tabelas usavam is_approved_user() (checa approved,
-- não papel) ou true → qualquer usuário aprovado (almoxarifado/comercial/producao)
-- podia editar contas bancárias, funcionários (PII), perfis tributários (cálculo de
-- imposto), patrimônio, alçadas e aprovações de compra via REST.
--
-- Escopo CONSERVADOR (sem risco de travar operador): só as tabelas claramente de
-- GESTÃO. SELECT mantido amplo (não quebra dashboards). NÃO mexe nas operacionais
-- (pedidos/estoque/clientes/price_lists) — essas dependem do modelo de papéis do dono
-- (quem cria pedido? quem move estoque?) e gatear errado travaria a produção.
-- =============================================================================

-- bank_accounts → escrita admin/gerente
DROP POLICY IF EXISTS "Approved users can insert bank_accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "Approved users can update bank_accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "Approved users can delete bank_accounts" ON public.bank_accounts;
CREATE POLICY bank_accounts_ins_mgmt ON public.bank_accounts FOR INSERT TO authenticated WITH CHECK (public.user_has_any_role(ARRAY['admin','gerente']));
CREATE POLICY bank_accounts_upd_mgmt ON public.bank_accounts FOR UPDATE TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente'])) WITH CHECK (public.user_has_any_role(ARRAY['admin','gerente']));
CREATE POLICY bank_accounts_del_mgmt ON public.bank_accounts FOR DELETE TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente']));

-- employees (PII) → escrita admin/gerente/rh
DROP POLICY IF EXISTS "Approved users can insert employees" ON public.employees;
DROP POLICY IF EXISTS "Approved users can update employees" ON public.employees;
DROP POLICY IF EXISTS "Approved users can delete employees" ON public.employees;
CREATE POLICY employees_ins_mgmt ON public.employees FOR INSERT TO authenticated WITH CHECK (public.user_has_any_role(ARRAY['admin','gerente','rh']));
CREATE POLICY employees_upd_mgmt ON public.employees FOR UPDATE TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente','rh'])) WITH CHECK (public.user_has_any_role(ARRAY['admin','gerente','rh']));
CREATE POLICY employees_del_mgmt ON public.employees FOR DELETE TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente','rh']));

-- fiscal_tax_profiles → escrita admin/gerente/nfe_operator
DROP POLICY IF EXISTS "Auth users can insert fiscal_tax_profiles" ON public.fiscal_tax_profiles;
DROP POLICY IF EXISTS "Auth users can update fiscal_tax_profiles" ON public.fiscal_tax_profiles;
DROP POLICY IF EXISTS "Auth users can delete fiscal_tax_profiles" ON public.fiscal_tax_profiles;
CREATE POLICY ftp_ins_mgmt ON public.fiscal_tax_profiles FOR INSERT TO authenticated WITH CHECK (public.user_has_any_role(ARRAY['admin','gerente','nfe_operator']));
CREATE POLICY ftp_upd_mgmt ON public.fiscal_tax_profiles FOR UPDATE TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente','nfe_operator'])) WITH CHECK (public.user_has_any_role(ARRAY['admin','gerente','nfe_operator']));
CREATE POLICY ftp_del_mgmt ON public.fiscal_tax_profiles FOR DELETE TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente','nfe_operator']));

-- fixed_assets (patrimônio) → escrita admin/gerente
DROP POLICY IF EXISTS "Auth users can insert fixed_assets" ON public.fixed_assets;
DROP POLICY IF EXISTS "Auth users can update fixed_assets" ON public.fixed_assets;
DROP POLICY IF EXISTS "Auth users can delete fixed_assets" ON public.fixed_assets;
CREATE POLICY fa_ins_mgmt ON public.fixed_assets FOR INSERT TO authenticated WITH CHECK (public.user_has_any_role(ARRAY['admin','gerente']));
CREATE POLICY fa_upd_mgmt ON public.fixed_assets FOR UPDATE TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente'])) WITH CHECK (public.user_has_any_role(ARRAY['admin','gerente']));
CREATE POLICY fa_del_mgmt ON public.fixed_assets FOR DELETE TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente']));

-- purchase_approval_tiers (alçadas — lidas pelo trigger de aprovação) → escrita admin/gerente
DROP POLICY IF EXISTS "auth write tiers" ON public.purchase_approval_tiers;
CREATE POLICY pat_write_mgmt ON public.purchase_approval_tiers FOR ALL TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente'])) WITH CHECK (public.user_has_any_role(ARRAY['admin','gerente']));

-- purchase_order_approvals → escrita (aprovar PO) só admin/gerente; leitura mantida
DROP POLICY IF EXISTS "approved users po_approvals" ON public.purchase_order_approvals;
DROP POLICY IF EXISTS "auth insert po approvals" ON public.purchase_order_approvals;
CREATE POLICY poa_write_mgmt ON public.purchase_order_approvals FOR ALL TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente'])) WITH CHECK (public.user_has_any_role(ARRAY['admin','gerente']));

-- =============================================================================
-- Housekeeping: índices FK faltantes, índices duplicados, policies redundantes,
-- otimização de auth_rls_initplan
-- =============================================================================
-- Resultado do advisor de performance/segurança após auditoria de 2026-05-11.
-- Reduz tempo de JOIN/CASCADE em FKs sem cover index e elimina re-avaliação
-- de auth.uid() por linha em policies (initplan optimization).
-- =============================================================================

-- ─── 30 índices para FKs sem cover ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_bank_account_id
  ON public.bank_reconciliations (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_clients_price_list_id
  ON public.clients (price_list_id);
CREATE INDEX IF NOT EXISTS idx_cnab_remittance_files_bank_account_id
  ON public.cnab_remittance_files (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_cnab_remittance_items_accounts_receivable_id
  ON public.cnab_remittance_items (accounts_receivable_id);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_contact_id
  ON public.crm_interactions (contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_representative_id
  ON public.crm_interactions (representative_id);
CREATE INDEX IF NOT EXISTS idx_crm_nps_responses_client_id
  ON public.crm_nps_responses (client_id);
CREATE INDEX IF NOT EXISTS idx_crm_nps_responses_sale_order_id
  ON public.crm_nps_responses (sale_order_id);
CREATE INDEX IF NOT EXISTS idx_cyclic_inventory_counts_product_id
  ON public.cyclic_inventory_counts (product_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_manifest_id
  ON public.delivery_tracking (manifest_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_transporter_id
  ON public.delivery_tracking (transporter_id);
CREATE INDEX IF NOT EXISTS idx_lgpd_consents_contact_id
  ON public.lgpd_consents (contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_cross_dock_sale_order_id
  ON public.orders (cross_dock_sale_order_id);
CREATE INDEX IF NOT EXISTS idx_picking_items_lot_id
  ON public.picking_items (lot_id);
CREATE INDEX IF NOT EXISTS idx_picking_items_product_id
  ON public.picking_items (product_id);
CREATE INDEX IF NOT EXISTS idx_picking_items_reference_id
  ON public.picking_items (reference_id);
CREATE INDEX IF NOT EXISTS idx_picking_sessions_wave_id
  ON public.picking_sessions (wave_id);
CREATE INDEX IF NOT EXISTS idx_pricing_simulations_created_by
  ON public.pricing_simulations (created_by);
CREATE INDEX IF NOT EXISTS idx_production_setup_times_from_reference_id
  ON public.production_setup_times (from_reference_id);
CREATE INDEX IF NOT EXISTS idx_production_setup_times_to_reference_id
  ON public.production_setup_times (to_reference_id);
CREATE INDEX IF NOT EXISTS idx_purchase_quotation_items_product_id
  ON public.purchase_quotation_items (product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_quotation_prices_quotation_item_id
  ON public.purchase_quotation_prices (quotation_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_quotation_responses_supplier_id
  ON public.purchase_quotation_responses (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_quotations_selected_supplier_id
  ON public.purchase_quotations (selected_supplier_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspection_plans_product_id
  ON public.quality_inspection_plans (product_id);
CREATE INDEX IF NOT EXISTS idx_sac_ticket_history_ticket_id
  ON public.sac_ticket_history (ticket_id);
CREATE INDEX IF NOT EXISTS idx_sac_tickets_reference_id
  ON public.sac_tickets (reference_id);
CREATE INDEX IF NOT EXISTS idx_sale_orders_parent_order_id
  ON public.sale_orders (parent_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_non_conformities_purchase_order_id
  ON public.supplier_non_conformities (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_time_record_manual_overrides_created_by
  ON public.time_record_manual_overrides (created_by);

-- ─── 4 índices duplicados ───────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_bank_hours_mov_emp_date;
DROP INDEX IF EXISTS public.idx_order_costs_order;
DROP INDEX IF EXISTS public.idx_fk_production_consumptions_order_id;
DROP INDEX IF EXISTS public.idx_fk_quality_inspections_order_id;

-- ─── 4 multiple_permissive_policies (mantém ALL, dropa SELECT redundante) ───
DROP POLICY IF EXISTS "approved users select absences" ON public.absences;
DROP POLICY IF EXISTS "approved users select benefits_config" ON public.benefits_config;
DROP POLICY IF EXISTS "Authenticated can read payroll_runs" ON public.payroll_runs;
DROP POLICY IF EXISTS "approved users qinsp" ON public.quality_inspections;

-- ─── auth_rls_initplan: substituir auth.uid() por (SELECT auth.uid()) ──────
-- bank_hours_movements (4 policies)
DROP POLICY IF EXISTS "Authenticated can read bank_hours_movements" ON public.bank_hours_movements;
CREATE POLICY "Authenticated can read bank_hours_movements"
  ON public.bank_hours_movements FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Only RH roles can insert bank_hours_movements" ON public.bank_hours_movements;
CREATE POLICY "Only RH roles can insert bank_hours_movements"
  ON public.bank_hours_movements FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = (SELECT auth.uid())
               AND ur.role IN ('admin'::app_role, 'gerente'::app_role))
  );

DROP POLICY IF EXISTS "Only RH roles can update bank_hours_movements" ON public.bank_hours_movements;
CREATE POLICY "Only RH roles can update bank_hours_movements"
  ON public.bank_hours_movements FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = (SELECT auth.uid())
               AND ur.role IN ('admin'::app_role, 'gerente'::app_role))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = (SELECT auth.uid())
               AND ur.role IN ('admin'::app_role, 'gerente'::app_role))
  );

DROP POLICY IF EXISTS "Only RH roles can delete bank_hours_movements" ON public.bank_hours_movements;
CREATE POLICY "Only RH roles can delete bank_hours_movements"
  ON public.bank_hours_movements FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = (SELECT auth.uid())
               AND ur.role IN ('admin'::app_role, 'gerente'::app_role))
  );

-- payroll_runs (1 ALL remaining)
DROP POLICY IF EXISTS "Approved can write payroll_runs" ON public.payroll_runs;
CREATE POLICY "Approved can write payroll_runs"
  ON public.payroll_runs FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- pricing_simulations (delete/update own)
DROP POLICY IF EXISTS "Approved users can delete own pricing_simulations" ON public.pricing_simulations;
CREATE POLICY "Approved users can delete own pricing_simulations"
  ON public.pricing_simulations FOR DELETE
  USING (is_approved_user() AND (created_by = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Approved users can update own pricing_simulations" ON public.pricing_simulations;
CREATE POLICY "Approved users can update own pricing_simulations"
  ON public.pricing_simulations FOR UPDATE
  USING (is_approved_user() AND (created_by = (SELECT auth.uid())));

-- user_mfa_settings
DROP POLICY IF EXISTS "users mfa_self" ON public.user_mfa_settings;
CREATE POLICY "users mfa_self"
  ON public.user_mfa_settings FOR ALL TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR is_approved_user())
  WITH CHECK ((user_id = (SELECT auth.uid())) OR is_approved_user());

-- time_record_manual_overrides (re-roda as 3 com SELECT wrapper)
DROP POLICY IF EXISTS "RH roles can insert manual overrides" ON public.time_record_manual_overrides;
CREATE POLICY "RH roles can insert manual overrides"
  ON public.time_record_manual_overrides FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = (SELECT auth.uid())
               AND ur.role IN ('admin'::app_role, 'gerente'::app_role))
  );

DROP POLICY IF EXISTS "RH roles can update manual overrides" ON public.time_record_manual_overrides;
CREATE POLICY "RH roles can update manual overrides"
  ON public.time_record_manual_overrides FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = (SELECT auth.uid())
               AND ur.role IN ('admin'::app_role, 'gerente'::app_role))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = (SELECT auth.uid())
               AND ur.role IN ('admin'::app_role, 'gerente'::app_role))
  );

DROP POLICY IF EXISTS "RH roles can delete manual overrides" ON public.time_record_manual_overrides;
CREATE POLICY "RH roles can delete manual overrides"
  ON public.time_record_manual_overrides FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = (SELECT auth.uid())
               AND ur.role IN ('admin'::app_role, 'gerente'::app_role))
  );

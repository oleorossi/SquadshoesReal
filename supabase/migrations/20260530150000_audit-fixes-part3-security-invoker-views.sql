-- Auditoria 2026-05-29 (parte 3) — resolve security_definer_view (16 ERROR)
--
-- Vira as 17 views SECURITY DEFINER restantes pra security_invoker, pra que
-- respeitem a RLS do chamador em vez de rodar como owner (bypass de RLS).
--
-- Pré-requisito (Passo 1): as views operacionais lêem catálogos que hoje só
-- admin/gerente podem SELECIONAR (products/suppliers/technical_sheets/
-- work_schedules/purchase_orders/purchase_order_items). Virar pra invoker sem
-- ajustar isso faria a UI vazia pra papéis operacionais (almoxarifado/producao/
-- comercial). Adicionamos SELECT aditivo por is_approved_user() — policies são
-- OR, então leitura vira admin/gerente OR approved = approved (superset); WRITE
-- continua admin/gerente (policies FOR ALL existentes). Aditivo: não remove
-- nada, impossível quebrar leitura. Mesma exposição que as views definer já
-- davam a todos os autenticados.
--
-- As views de RH (bank_hours_*, employee_punch_pattern, time_pendings) e
-- financeiras/fiscais (economic_group_*, sale_order_billing_health,
-- nfe_sequence_gaps) NÃO recebem broadening: ao virar invoker passam a
-- respeitar a RLS restritiva das tabelas-base (bank_hours_movements=admin/
-- gerente/rh, accounts_receivable=admin/gerente, nfe_emitidas=admin/gerente/
-- nfe_operator) — tightening intencional (essas views vazavam PII/financeiro
-- pra qualquer autenticado quando eram SECURITY DEFINER).

-- ============================================================================
-- Passo 1: SELECT aditivo (is_approved_user) nos catálogos operacionais
-- ============================================================================
DROP POLICY IF EXISTS products_select_approved ON public.products;
CREATE POLICY products_select_approved ON public.products
  FOR SELECT TO authenticated USING (is_approved_user());

DROP POLICY IF EXISTS suppliers_select_approved ON public.suppliers;
CREATE POLICY suppliers_select_approved ON public.suppliers
  FOR SELECT TO authenticated USING (is_approved_user());

DROP POLICY IF EXISTS technical_sheets_select_approved ON public.technical_sheets;
CREATE POLICY technical_sheets_select_approved ON public.technical_sheets
  FOR SELECT TO authenticated USING (is_approved_user());

DROP POLICY IF EXISTS work_schedules_select_approved ON public.work_schedules;
CREATE POLICY work_schedules_select_approved ON public.work_schedules
  FOR SELECT TO authenticated USING (is_approved_user());

DROP POLICY IF EXISTS purchase_orders_select_approved ON public.purchase_orders;
CREATE POLICY purchase_orders_select_approved ON public.purchase_orders
  FOR SELECT TO authenticated USING (is_approved_user());

DROP POLICY IF EXISTS purchase_order_items_select_approved ON public.purchase_order_items;
CREATE POLICY purchase_order_items_select_approved ON public.purchase_order_items
  FOR SELECT TO authenticated USING (is_approved_user());

-- ============================================================================
-- Passo 2: vira as 17 views pra security_invoker
-- ============================================================================
DO $$
DECLARE v_view text;
BEGIN
  FOREACH v_view IN ARRAY ARRAY[
    'bank_hours_balance','sale_order_min_billing','v_bank_hours_per_sector','v_bank_hours_summary',
    'v_economic_group_credit','v_economic_group_kpis','v_employee_punch_pattern','v_mrp_needs',
    'v_nfe_sequence_gaps','v_operator_productivity','v_products_below_rop','v_sale_order_billing_health',
    'v_sector_load_by_reference','v_sheets_missing_lining_consumption','v_shoe_category_unmapped',
    'v_time_pendings','vw_punch_clock_params_current'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relname=v_view AND c.relkind='v') THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v_view);
    END IF;
  END LOOP;
END $$;

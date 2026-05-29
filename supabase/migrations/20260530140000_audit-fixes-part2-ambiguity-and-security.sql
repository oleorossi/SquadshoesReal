-- Auditoria 2026-05-29 (parte 2) — itens deferidos
--
-- AMB-1 (NOVO, CRÍTICO descoberto durante reaplicação dos testes):
--   calculate_order_consumption tem duas overloads — v4 (4 args) e v5 (4 args
--   + p_material_variant_id DEFAULT NULL). Qualquer chamada com 4 args ficava
--   ambígua -> 42725 "is not unique". Isso quebrava fn_projected_demand e
--   portanto v_mrp_needs em PROD (qualquer SELECT na view dava erro).
--   Frontend só usa v5 (5 args explícitos). SQL callers passam 4 args, que a
--   v5 absorve via default. Drop da v4 elimina a ambiguidade.
--
-- SEC-1 (extensão):
--   REVOKE SELECT FROM anon em TODAS as 17 views ainda SECURITY DEFINER.
--   A PR anterior cobriu só as 8 mais sensíveis. Não viramos as views pra
--   security_invoker porque as tabelas-base (products/suppliers/sale_orders/
--   technical_sheets) têm RLS restritiva por role (admin/gerente). Virar
--   quebraria a UI pra producao/comercial — refactor de RLS dessas tabelas
--   merece sessão dedicada.
--
-- SEC-5: 2 das 67 policies "USING true" eram administrativas e perigosas:
--   - company_settings INSERT/UPDATE (CNPJ, razão social, dados fiscais)
--   - punch_clock_params INSERT (jornada, tolerância, parâmetros de relógio)
--   Restringidas por role. As demais USING true são catálogos de leitura
--   ou tabelas operacionais (vehicles, drivers, delivery_*, fuel_prices,
--   sector_distribution_plan, order_lots, production_alerts) — mantidas.

-- ============================================================================
-- AMB-1: drop da overload v4 ambígua de calculate_order_consumption
-- ============================================================================
DROP FUNCTION IF EXISTS public.calculate_order_consumption(uuid, numeric, text, integer);

-- ============================================================================
-- SEC-1 (extensão): revoga anon nas 9 views SECURITY DEFINER restantes
-- ============================================================================
DO $$
DECLARE v_view text;
BEGIN
  FOREACH v_view IN ARRAY ARRAY[
    'v_mrp_needs','v_nfe_sequence_gaps','v_products_below_rop','v_sale_order_billing_health',
    'v_sector_load_by_reference','v_sheets_missing_lining_consumption','v_shoe_category_unmapped',
    'v_time_pendings','vw_punch_clock_params_current'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relname=v_view) THEN
      EXECUTE format('REVOKE SELECT ON public.%I FROM anon', v_view);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- SEC-5a: company_settings — INSERT/UPDATE só admin/gerente
-- ============================================================================
DROP POLICY IF EXISTS company_settings_insert ON public.company_settings;
CREATE POLICY company_settings_insert ON public.company_settings
  FOR INSERT TO authenticated
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente']));

DROP POLICY IF EXISTS company_settings_update ON public.company_settings;
CREATE POLICY company_settings_update ON public.company_settings
  FOR UPDATE TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente']));

-- ============================================================================
-- SEC-5b: punch_clock_params — INSERT só admin/gerente/rh
-- ============================================================================
DROP POLICY IF EXISTS "Auth users can insert punch clock params" ON public.punch_clock_params;
CREATE POLICY "Approved RH can insert punch clock params" ON public.punch_clock_params
  FOR INSERT TO authenticated
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','rh']));

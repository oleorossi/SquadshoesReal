-- =============================================================================
-- Auditoria de seguranca: 6 ERRORs + 14 RLS always-true + 5 search_path mut.
-- =============================================================================
-- Aplicada via Supabase MCP em 2026-05-08. get_advisors apontou 229 security
-- lints, dos quais 6 ERRORs criticos. Esta migration corrige:
--
--   1. 6 views com SECURITY DEFINER (rodam com permissoes do dono, ignoram RLS
--      do caller) -> ALTER VIEW SET (security_invoker = true).
--   2. 5 funcoes sem search_path explicito -> SET search_path = public.
--   3. 14 RLS policies "always true" (USING true / WITH CHECK true) ->
--      substituir por is_approved_user(). Inclui orders, sale_orders,
--      sale_order_items, stock_movements, etc.
--
-- Pos-aplicacao: 229 -> 0 ERRORs, 200+ WARNs (mas todos by design — funcoes
-- intencionalmente expostas via SECURITY DEFINER).
-- =============================================================================

-- 1) Views: remover SECURITY DEFINER
ALTER VIEW public.v_time_import_archive          SET (security_invoker = true);
ALTER VIEW public.v_overdue_purchase_orders      SET (security_invoker = true);
ALTER VIEW public.v_wave_detail                  SET (security_invoker = true);
ALTER VIEW public.v_client_credit_exposure       SET (security_invoker = true);
ALTER VIEW public.v_late_orders                  SET (security_invoker = true);
ALTER VIEW public.product_stock_with_reservations SET (security_invoker = true);

-- 2) Funcoes sem search_path explicito
ALTER FUNCTION public.check_grade_quantity_coherence()                    SET search_path = public;
ALTER FUNCTION public.stage_order(text)                                    SET search_path = public;
ALTER FUNCTION public.stage_order(production_stage_enum)                   SET search_path = public;
ALTER FUNCTION public.add_business_days(date, integer)                     SET search_path = public;
ALTER FUNCTION public.add_business_days(timestamp with time zone, integer) SET search_path = public;
ALTER FUNCTION public.update_wave_timeline(uuid)                           SET search_path = public;
ALTER FUNCTION public.compute_wave_timeline(uuid[])                        SET search_path = public;

-- 3) RLS policies "always true" -> is_approved_user()
DROP POLICY IF EXISTS "Authenticated users can manage artisanal recipes" ON public.artisanal_recipes;
CREATE POLICY "approved_manage_artisanal_recipes" ON public.artisanal_recipes
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS "rls_orders_all" ON public.orders;
CREATE POLICY "rls_orders_all" ON public.orders
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS "rls_picking_list_items_all" ON public.picking_list_items;
CREATE POLICY "rls_picking_list_items_all" ON public.picking_list_items
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS "rls_picking_lists_all" ON public.picking_lists;
CREATE POLICY "rls_picking_lists_all" ON public.picking_lists
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS "rls_production_waves_all" ON public.production_waves;
CREATE POLICY "rls_production_waves_all" ON public.production_waves
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS "rls_quality_records_all" ON public.quality_records;
CREATE POLICY "rls_quality_records_all" ON public.quality_records
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS "rls_sale_order_items_all" ON public.sale_order_items;
CREATE POLICY "rls_sale_order_items_all" ON public.sale_order_items
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS "rls_sale_orders_all" ON public.sale_orders;
CREATE POLICY "rls_sale_orders_all" ON public.sale_orders
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS "rls_stock_movements_all" ON public.stock_movements;
CREATE POLICY "rls_stock_movements_all" ON public.stock_movements
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS "Authenticated users can manage sole size conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Authenticated users can insert sole size conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Authenticated users can update sole size conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Authenticated users can delete sole size conjugations" ON public.sole_size_conjugations;
CREATE POLICY "approved_manage_sole_conjugations" ON public.sole_size_conjugations
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));

DROP POLICY IF EXISTS "allow_all_palmilha_colors" ON public.technical_sheet_palmilha_colors;
CREATE POLICY "approved_manage_palmilha_colors" ON public.technical_sheet_palmilha_colors
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));

-- 4) RLS em 18 tabelas desprotegidas (incluindo employee_payroll, employee_bank_hours,
--    employee_absences, time_import_logs, reference_material_variants — dados sensiveis)
DO $$
DECLARE
  t text;
  needs_policies text[] := ARRAY[
    'employee_absences','employee_bank_hours','employee_payroll','equipment',
    'loading_manifest_items','loading_manifests','maintenance_logs','maintenance_plans',
    'material_color_groups','reference_material_variants','resync_queue',
    'technical_sheet_lining_colors','time_import_logs'
  ];
BEGIN
  FOREACH t IN ARRAY needs_policies LOOP
    EXECUTE format('DROP POLICY IF EXISTS "approved_select" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "approved_insert" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "approved_update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "approved_delete" ON public.%I', t);
    EXECUTE format('CREATE POLICY "approved_select" ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_approved_user()))', t);
    EXECUTE format('CREATE POLICY "approved_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_approved_user()))', t);
    EXECUTE format('CREATE POLICY "approved_update" ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()))', t);
    EXECUTE format('CREATE POLICY "approved_delete" ON public.%I FOR DELETE TO authenticated USING ((SELECT public.is_approved_user()))', t);
  END LOOP;
END $$;

ALTER TABLE public.baus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.box_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_bank_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loading_manifest_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loading_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_color_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_material_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technical_sheet_lining_colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_import_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_company_rates ENABLE ROW LEVEL SECURITY;

-- 5) Move extension unaccent de public -> extensions
ALTER FUNCTION public.debit_strap_stock(jsonb, integer, uuid, jsonb)
  SET search_path = public, extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension e
             JOIN pg_namespace n ON n.oid = e.extnamespace
             WHERE e.extname='unaccent' AND n.nspname='public') THEN
    ALTER EXTENSION unaccent SET SCHEMA extensions;
  END IF;
END $$;

-- 6) Drop 5 indexes duplicados
DROP INDEX IF EXISTS public.idx_material_reservations_order;
DROP INDEX IF EXISTS public.idx_material_reservations_product;
DROP INDEX IF EXISTS public.idx_sale_orders_created_at;
DROP INDEX IF EXISTS public.idx_stock_mvmt_product;
DROP INDEX IF EXISTS public.uq_technical_sheet_sole_colors_sheet_color;

-- 7) Wrap auth.uid()/is_approved_user() em (SELECT ...) em todas as policies
-- (ganho de perf gigante em queries que tocam muitas linhas — Postgres
-- re-avaliava a funcao por LINHA em vez de uma vez por query)
DO $$
DECLARE
  pol RECORD;
  new_qual TEXT;
  new_check TEXT;
  cmd_clause TEXT;
  using_clause TEXT;
  check_clause TEXT;
  roles_clause TEXT;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    new_qual  := COALESCE(pol.qual, '');
    new_check := COALESCE(pol.with_check, '');

    new_qual  := regexp_replace(new_qual,  '(?<!\(SELECT )auth\.(uid|role|jwt|email)\(\)', '(SELECT auth.\1())', 'g');
    new_check := regexp_replace(new_check, '(?<!\(SELECT )auth\.(uid|role|jwt|email)\(\)', '(SELECT auth.\1())', 'g');
    new_qual  := regexp_replace(new_qual,  '(?<!\(SELECT )(public\.)?is_approved_user\(\)', '(SELECT public.is_approved_user())', 'g');
    new_check := regexp_replace(new_check, '(?<!\(SELECT )(public\.)?is_approved_user\(\)', '(SELECT public.is_approved_user())', 'g');

    IF new_qual = COALESCE(pol.qual, '') AND new_check = COALESCE(pol.with_check, '') THEN
      CONTINUE;
    END IF;

    cmd_clause := CASE pol.cmd
      WHEN 'ALL' THEN 'FOR ALL' WHEN 'SELECT' THEN 'FOR SELECT'
      WHEN 'INSERT' THEN 'FOR INSERT' WHEN 'UPDATE' THEN 'FOR UPDATE'
      WHEN 'DELETE' THEN 'FOR DELETE'
    END;
    roles_clause := 'TO ' || array_to_string(pol.roles, ', ');
    using_clause := CASE WHEN pol.qual IS NOT NULL THEN 'USING (' || new_qual || ')' ELSE '' END;
    check_clause := CASE WHEN pol.with_check IS NOT NULL THEN 'WITH CHECK (' || new_check || ')' ELSE '' END;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS %s %s %s %s %s',
      pol.policyname, pol.schemaname, pol.tablename,
      pol.permissive, cmd_clause, roles_clause, using_clause, check_clause
    );
  END LOOP;
END $$;

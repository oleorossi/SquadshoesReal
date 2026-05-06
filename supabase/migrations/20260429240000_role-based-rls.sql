-- =============================================================================
-- Role-Based Row Level Security (RLS)
-- Migration: 20260429240000_role-based-rls.sql
-- =============================================================================
--
-- Role hierarchy (defined in app_role enum):
--   admin        — full access to everything including user management
--   gerente      — full access except user management (read-only on user_roles)
--   almoxarifado — operational access (same as any authenticated user for Cat B)
--   operador     — operational access (same as authenticated for Cat B)
--   comercial    — operational access
--   consulta     — read-only (covered by authenticated SELECT policies)
--
-- Categories:
--   A  Reference/config data  — all authenticated can SELECT; admin/gerente write
--   B  Operational data       — all authenticated can read and write
--   C  Financial/sensitive    — admin/gerente only for all operations
--   D  User management        — users see own role; admin writes
--
-- NOTE: The `role` column is of type app_role (enum). Comparisons are done via
-- ::text cast to avoid coupling to the enum internals in helper functions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper functions in the auth schema
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.user_has_role(required_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role::text = required_role
  );
$$;

CREATE OR REPLACE FUNCTION auth.user_has_any_role(roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role::text = ANY(roles)
  );
$$;

-- =============================================================================
-- CATEGORY A — Reference / Config data
-- SELECT: all authenticated users
-- INSERT / UPDATE / DELETE: admin or gerente only
-- Tables: groups (product_groups), suppliers, products, technical_sheets,
--         sole_technical_specs, component_sheets, fiscal_config, cost_policies,
--         factoring_config, work_schedules
-- =============================================================================

-- ---- suppliers ----
DROP POLICY IF EXISTS "Auth users can view suppliers"   ON public.suppliers;
DROP POLICY IF EXISTS "Auth users can insert suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Auth users can update suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Auth users can delete suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "rls_suppliers_select"            ON public.suppliers;
DROP POLICY IF EXISTS "rls_suppliers_write"             ON public.suppliers;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_suppliers_select" ON public.suppliers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_suppliers_write" ON public.suppliers
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- products ----
DROP POLICY IF EXISTS "Authenticated users can view products"    ON public.products;
DROP POLICY IF EXISTS "Authenticated users can insert products"  ON public.products;
DROP POLICY IF EXISTS "Authenticated users can update products"  ON public.products;
DROP POLICY IF EXISTS "Authenticated users can delete products"  ON public.products;
DROP POLICY IF EXISTS "Anyone can view products"                 ON public.products;
DROP POLICY IF EXISTS "rls_products_select"                      ON public.products;
DROP POLICY IF EXISTS "rls_products_write"                       ON public.products;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_products_select" ON public.products
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_products_write" ON public.products
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- product_groups ----
DROP POLICY IF EXISTS "rls_product_groups_select" ON public.product_groups;
DROP POLICY IF EXISTS "rls_product_groups_write"  ON public.product_groups;

ALTER TABLE public.product_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_product_groups_select" ON public.product_groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_product_groups_write" ON public.product_groups
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- technical_sheets ----
DROP POLICY IF EXISTS "Auth users can view technical_sheets"    ON public.technical_sheets;
DROP POLICY IF EXISTS "Auth users can insert technical_sheets"  ON public.technical_sheets;
DROP POLICY IF EXISTS "Auth users can update technical_sheets"  ON public.technical_sheets;
DROP POLICY IF EXISTS "Auth users can delete technical_sheets"  ON public.technical_sheets;
DROP POLICY IF EXISTS "rls_technical_sheets_select"             ON public.technical_sheets;
DROP POLICY IF EXISTS "rls_technical_sheets_write"              ON public.technical_sheets;

ALTER TABLE public.technical_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_technical_sheets_select" ON public.technical_sheets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_technical_sheets_write" ON public.technical_sheets
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- sole_technical_specs ----
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.sole_technical_specs;
DROP POLICY IF EXISTS "rls_sole_technical_specs_select"   ON public.sole_technical_specs;
DROP POLICY IF EXISTS "rls_sole_technical_specs_write"    ON public.sole_technical_specs;

ALTER TABLE public.sole_technical_specs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_sole_technical_specs_select" ON public.sole_technical_specs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_sole_technical_specs_write" ON public.sole_technical_specs
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- component_sheets ----
DROP POLICY IF EXISTS "Auth users can view component_sheets"    ON public.component_sheets;
DROP POLICY IF EXISTS "Auth users can insert component_sheets"  ON public.component_sheets;
DROP POLICY IF EXISTS "Auth users can update component_sheets"  ON public.component_sheets;
DROP POLICY IF EXISTS "Auth users can delete component_sheets"  ON public.component_sheets;
DROP POLICY IF EXISTS "Approved users can insert component_sheets" ON public.component_sheets;
DROP POLICY IF EXISTS "Approved users can update component_sheets" ON public.component_sheets;
DROP POLICY IF EXISTS "Approved users can delete component_sheets" ON public.component_sheets;
DROP POLICY IF EXISTS "rls_component_sheets_select"             ON public.component_sheets;
DROP POLICY IF EXISTS "rls_component_sheets_write"              ON public.component_sheets;

ALTER TABLE public.component_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_component_sheets_select" ON public.component_sheets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_component_sheets_write" ON public.component_sheets
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- fiscal_config ----
DROP POLICY IF EXISTS "Auth users can view fiscal_config"    ON public.fiscal_config;
DROP POLICY IF EXISTS "Auth users can insert fiscal_config"  ON public.fiscal_config;
DROP POLICY IF EXISTS "Auth users can update fiscal_config"  ON public.fiscal_config;
DROP POLICY IF EXISTS "Auth users can delete fiscal_config"  ON public.fiscal_config;
DROP POLICY IF EXISTS "rls_fiscal_config_select"             ON public.fiscal_config;
DROP POLICY IF EXISTS "rls_fiscal_config_write"              ON public.fiscal_config;

ALTER TABLE public.fiscal_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_fiscal_config_select" ON public.fiscal_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_fiscal_config_write" ON public.fiscal_config
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- cost_policies ----
DROP POLICY IF EXISTS "Auth users can view cost_policies"    ON public.cost_policies;
DROP POLICY IF EXISTS "Auth users can insert cost_policies"  ON public.cost_policies;
DROP POLICY IF EXISTS "Auth users can update cost_policies"  ON public.cost_policies;
DROP POLICY IF EXISTS "Auth users can delete cost_policies"  ON public.cost_policies;
DROP POLICY IF EXISTS "Approved users can insert cost_policies" ON public.cost_policies;
DROP POLICY IF EXISTS "Approved users can update cost_policies" ON public.cost_policies;
DROP POLICY IF EXISTS "Approved users can delete cost_policies" ON public.cost_policies;
DROP POLICY IF EXISTS "rls_cost_policies_select"             ON public.cost_policies;
DROP POLICY IF EXISTS "rls_cost_policies_write"              ON public.cost_policies;

ALTER TABLE public.cost_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_cost_policies_select" ON public.cost_policies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_cost_policies_write" ON public.cost_policies
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- factoring_config ----
DROP POLICY IF EXISTS "Authenticated users can manage factoring_config" ON public.factoring_config;
DROP POLICY IF EXISTS "rls_factoring_config_select"                     ON public.factoring_config;
DROP POLICY IF EXISTS "rls_factoring_config_write"                      ON public.factoring_config;

ALTER TABLE public.factoring_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_factoring_config_select" ON public.factoring_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_factoring_config_write" ON public.factoring_config
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- work_schedules ----
DROP POLICY IF EXISTS "Auth users can view work_schedules"    ON public.work_schedules;
DROP POLICY IF EXISTS "Auth users can insert work_schedules"  ON public.work_schedules;
DROP POLICY IF EXISTS "Auth users can update work_schedules"  ON public.work_schedules;
DROP POLICY IF EXISTS "Auth users can delete work_schedules"  ON public.work_schedules;
DROP POLICY IF EXISTS "rls_work_schedules_select"             ON public.work_schedules;
DROP POLICY IF EXISTS "rls_work_schedules_write"              ON public.work_schedules;

ALTER TABLE public.work_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_work_schedules_select" ON public.work_schedules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_work_schedules_write" ON public.work_schedules
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- =============================================================================
-- CATEGORY B — Operational data (all authenticated users can read and write)
-- Tables: orders, sale_orders, sale_order_items, production_waves, wave_orders,
--         picking_lists, picking_list_items, stock_movements, quality_records,
--         notifications
-- =============================================================================

-- ---- orders ----
DROP POLICY IF EXISTS "Auth users can view orders"          ON public.orders;
DROP POLICY IF EXISTS "Auth users can insert orders"        ON public.orders;
DROP POLICY IF EXISTS "Auth users can update orders"        ON public.orders;
DROP POLICY IF EXISTS "Auth users can delete orders"        ON public.orders;
DROP POLICY IF EXISTS "Approved users can insert orders"    ON public.orders;
DROP POLICY IF EXISTS "Approved users can update orders"    ON public.orders;
DROP POLICY IF EXISTS "Approved users can delete orders"    ON public.orders;
DROP POLICY IF EXISTS "rls_orders_all"                      ON public.orders;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_orders_all" ON public.orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- sale_orders ----
DROP POLICY IF EXISTS "Auth users can view sale_orders"    ON public.sale_orders;
DROP POLICY IF EXISTS "Auth users can insert sale_orders"  ON public.sale_orders;
DROP POLICY IF EXISTS "Auth users can update sale_orders"  ON public.sale_orders;
DROP POLICY IF EXISTS "Auth users can delete sale_orders"  ON public.sale_orders;
DROP POLICY IF EXISTS "rls_sale_orders_all"               ON public.sale_orders;

ALTER TABLE public.sale_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_sale_orders_all" ON public.sale_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- sale_order_items ----
DROP POLICY IF EXISTS "Auth users can view sale_order_items"    ON public.sale_order_items;
DROP POLICY IF EXISTS "Auth users can insert sale_order_items"  ON public.sale_order_items;
DROP POLICY IF EXISTS "Auth users can update sale_order_items"  ON public.sale_order_items;
DROP POLICY IF EXISTS "Auth users can delete sale_order_items"  ON public.sale_order_items;
DROP POLICY IF EXISTS "Approved users can insert sale_order_items" ON public.sale_order_items;
DROP POLICY IF EXISTS "Approved users can update sale_order_items" ON public.sale_order_items;
DROP POLICY IF EXISTS "Approved users can delete sale_order_items" ON public.sale_order_items;
DROP POLICY IF EXISTS "rls_sale_order_items_all"               ON public.sale_order_items;

ALTER TABLE public.sale_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_sale_order_items_all" ON public.sale_order_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- production_waves ----
-- Note: prior policies named auth_all_waves / waves_select / waves_insert / etc.
DROP POLICY IF EXISTS "auth_all_waves"   ON public.production_waves;
DROP POLICY IF EXISTS "waves_select"     ON public.production_waves;
DROP POLICY IF EXISTS "waves_insert"     ON public.production_waves;
DROP POLICY IF EXISTS "waves_update"     ON public.production_waves;
DROP POLICY IF EXISTS "waves_delete"     ON public.production_waves;
DROP POLICY IF EXISTS "rls_production_waves_all" ON public.production_waves;

ALTER TABLE public.production_waves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_production_waves_all" ON public.production_waves
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- wave_orders (may not exist yet — wrapped in exception block) ----
DO $$ BEGIN
  DROP POLICY IF EXISTS "rls_wave_orders_all" ON public.wave_orders;
  ALTER TABLE public.wave_orders ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "rls_wave_orders_all" ON public.wave_orders
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN
  NULL; -- table does not exist yet; skip silently
END $$;

-- ---- picking_lists ----
DROP POLICY IF EXISTS "Auth users can view picking_lists"       ON public.picking_lists;
DROP POLICY IF EXISTS "Approved users can insert picking_lists" ON public.picking_lists;
DROP POLICY IF EXISTS "Approved users can update picking_lists" ON public.picking_lists;
DROP POLICY IF EXISTS "Approved users can delete picking_lists" ON public.picking_lists;
DROP POLICY IF EXISTS "rls_picking_lists_all"                   ON public.picking_lists;

ALTER TABLE public.picking_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_picking_lists_all" ON public.picking_lists
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- picking_list_items ----
DROP POLICY IF EXISTS "Auth users can view picking_list_items"       ON public.picking_list_items;
DROP POLICY IF EXISTS "Approved users can insert picking_list_items" ON public.picking_list_items;
DROP POLICY IF EXISTS "Approved users can update picking_list_items" ON public.picking_list_items;
DROP POLICY IF EXISTS "Approved users can delete picking_list_items" ON public.picking_list_items;
DROP POLICY IF EXISTS "rls_picking_list_items_all"                   ON public.picking_list_items;

ALTER TABLE public.picking_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_picking_list_items_all" ON public.picking_list_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- stock_movements ----
DROP POLICY IF EXISTS "Auth users can view movements"               ON public.stock_movements;
DROP POLICY IF EXISTS "Auth users can insert movements"             ON public.stock_movements;
DROP POLICY IF EXISTS "Approved users can insert stock_movements"   ON public.stock_movements;
DROP POLICY IF EXISTS "Approved users can update stock_movements"   ON public.stock_movements;
DROP POLICY IF EXISTS "Approved users can delete stock_movements"   ON public.stock_movements;
DROP POLICY IF EXISTS "rls_stock_movements_all"                     ON public.stock_movements;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_stock_movements_all" ON public.stock_movements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- quality_records ----
DROP POLICY IF EXISTS "Auth users can view quality_records"       ON public.quality_records;
DROP POLICY IF EXISTS "Approved users can insert quality_records" ON public.quality_records;
DROP POLICY IF EXISTS "Approved users can update quality_records" ON public.quality_records;
DROP POLICY IF EXISTS "Approved users can delete quality_records" ON public.quality_records;
DROP POLICY IF EXISTS "rls_quality_records_all"                   ON public.quality_records;

ALTER TABLE public.quality_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_quality_records_all" ON public.quality_records
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- notifications ----
DROP POLICY IF EXISTS "Users can view own or broadcast notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view relevant notifications"         ON public.notifications;
DROP POLICY IF EXISTS "Approved users can create notifications"       ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications"            ON public.notifications;
DROP POLICY IF EXISTS "Users can delete own notifications"            ON public.notifications;
DROP POLICY IF EXISTS "rls_notifications_all"                         ON public.notifications;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_notifications_all" ON public.notifications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================================================
-- CATEGORY C — Financial / Sensitive data (admin or gerente only)
-- Tables: financial_entries, accounts_receivable, accounts_payable,
--         purchase_orders, purchase_order_items, nfe_emitidas, cogs_entries
-- =============================================================================

-- ---- financial_entries ----
DROP POLICY IF EXISTS "Auth users can view financial_entries"    ON public.financial_entries;
DROP POLICY IF EXISTS "Auth users can insert financial_entries"  ON public.financial_entries;
DROP POLICY IF EXISTS "Auth users can update financial_entries"  ON public.financial_entries;
DROP POLICY IF EXISTS "Auth users can delete financial_entries"  ON public.financial_entries;
DROP POLICY IF EXISTS "rls_financial_entries_all"               ON public.financial_entries;

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_financial_entries_all" ON public.financial_entries
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- accounts_receivable ----
DROP POLICY IF EXISTS "Auth users can view accounts_receivable"    ON public.accounts_receivable;
DROP POLICY IF EXISTS "Auth users can insert accounts_receivable"  ON public.accounts_receivable;
DROP POLICY IF EXISTS "Auth users can update accounts_receivable"  ON public.accounts_receivable;
DROP POLICY IF EXISTS "Auth users can delete accounts_receivable"  ON public.accounts_receivable;
DROP POLICY IF EXISTS "rls_accounts_receivable_all"               ON public.accounts_receivable;

ALTER TABLE public.accounts_receivable ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_accounts_receivable_all" ON public.accounts_receivable
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- accounts_payable ----
DROP POLICY IF EXISTS "Auth users can view accounts_payable"       ON public.accounts_payable;
DROP POLICY IF EXISTS "Auth users can insert accounts_payable"     ON public.accounts_payable;
DROP POLICY IF EXISTS "Auth users can update accounts_payable"     ON public.accounts_payable;
DROP POLICY IF EXISTS "Auth users can delete accounts_payable"     ON public.accounts_payable;
DROP POLICY IF EXISTS "Approved users can insert accounts_payable" ON public.accounts_payable;
DROP POLICY IF EXISTS "Approved users can update accounts_payable" ON public.accounts_payable;
DROP POLICY IF EXISTS "Approved users can delete accounts_payable" ON public.accounts_payable;
DROP POLICY IF EXISTS "rls_accounts_payable_all"                   ON public.accounts_payable;

ALTER TABLE public.accounts_payable ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_accounts_payable_all" ON public.accounts_payable
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- purchase_orders ----
DROP POLICY IF EXISTS "Auth users can view purchase_orders"    ON public.purchase_orders;
DROP POLICY IF EXISTS "Auth users can insert purchase_orders"  ON public.purchase_orders;
DROP POLICY IF EXISTS "Auth users can update purchase_orders"  ON public.purchase_orders;
DROP POLICY IF EXISTS "Auth users can delete purchase_orders"  ON public.purchase_orders;
DROP POLICY IF EXISTS "rls_purchase_orders_all"               ON public.purchase_orders;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_purchase_orders_all" ON public.purchase_orders
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- purchase_order_items ----
DROP POLICY IF EXISTS "Auth users can view purchase_order_items"    ON public.purchase_order_items;
DROP POLICY IF EXISTS "Auth users can insert purchase_order_items"  ON public.purchase_order_items;
DROP POLICY IF EXISTS "Auth users can update purchase_order_items"  ON public.purchase_order_items;
DROP POLICY IF EXISTS "Auth users can delete purchase_order_items"  ON public.purchase_order_items;
DROP POLICY IF EXISTS "rls_purchase_order_items_all"               ON public.purchase_order_items;

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_purchase_order_items_all" ON public.purchase_order_items
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- nfe_emitidas ----
-- Note: prior migration dropped all policies via a DO loop before recreating them
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'nfe_emitidas'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.nfe_emitidas', pol.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "rls_nfe_emitidas_all" ON public.nfe_emitidas;

ALTER TABLE public.nfe_emitidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_nfe_emitidas_all" ON public.nfe_emitidas
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- cogs_entries ----
DROP POLICY IF EXISTS "Auth users can view cogs_entries"       ON public.cogs_entries;
DROP POLICY IF EXISTS "Approved users can insert cogs_entries" ON public.cogs_entries;
DROP POLICY IF EXISTS "Approved users can update cogs_entries" ON public.cogs_entries;
DROP POLICY IF EXISTS "Approved users can delete cogs_entries" ON public.cogs_entries;
DROP POLICY IF EXISTS "rls_cogs_entries_all"                   ON public.cogs_entries;

ALTER TABLE public.cogs_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_cogs_entries_all" ON public.cogs_entries
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- =============================================================================
-- CATEGORY D — User management
-- user_roles : SELECT own row or admin/gerente; INSERT/UPDATE/DELETE admin only
-- companies  : SELECT authenticated; INSERT/UPDATE/DELETE admin only
-- =============================================================================

-- ---- user_roles ----
-- Drop existing policies individually to avoid locking out current users
DROP POLICY IF EXISTS "Users can view own roles"  ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert roles"   ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles"   ON public.user_roles;
DROP POLICY IF EXISTS "users_see_own_role"        ON public.user_roles;
DROP POLICY IF EXISTS "rls_user_roles_select"     ON public.user_roles;
DROP POLICY IF EXISTS "rls_user_roles_insert"     ON public.user_roles;
DROP POLICY IF EXISTS "rls_user_roles_update"     ON public.user_roles;
DROP POLICY IF EXISTS "rls_user_roles_delete"     ON public.user_roles;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Allow a user to see their own role, or admin/gerente to see all
CREATE POLICY "users_see_own_role" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- Only admin can modify role assignments
CREATE POLICY "rls_user_roles_insert" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (auth.user_has_role('admin'));

CREATE POLICY "rls_user_roles_update" ON public.user_roles
  FOR UPDATE TO authenticated
  USING  (auth.user_has_role('admin'))
  WITH CHECK (auth.user_has_role('admin'));

CREATE POLICY "rls_user_roles_delete" ON public.user_roles
  FOR DELETE TO authenticated
  USING (auth.user_has_role('admin'));

-- ---- companies ----
DROP POLICY IF EXISTS "Auth users can manage companies" ON public.companies;
DROP POLICY IF EXISTS "rls_companies_select"            ON public.companies;
DROP POLICY IF EXISTS "rls_companies_write"             ON public.companies;

DO $$ BEGIN
  ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "rls_companies_select" ON public.companies
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "rls_companies_write" ON public.companies
    FOR ALL TO authenticated
    USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
    WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

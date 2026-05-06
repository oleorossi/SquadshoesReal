
-- =====================================================
-- RLS HARDENING MIGRATION
-- 1. Add WITH CHECK to all UPDATE policies
-- 2. Remove duplicate policies on employee_advances
-- 3. Restrict audit_logs INSERT to authenticated only
-- 4. Restrict profiles INSERT to system trigger only
-- =====================================================

-- ============ 1. FIX audit_logs: restrict INSERT to authenticated ============
DROP POLICY IF EXISTS "Anyone can insert audit logs" ON public.audit_logs;
CREATE POLICY "Auth users can insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- ============ 2. REMOVE DUPLICATE policies on employee_advances ============
DROP POLICY IF EXISTS "Approved users can delete advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Approved users can insert advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Approved users can update advances" ON public.employee_advances;

-- ============ 3. FIX profiles INSERT: only system trigger should insert ============
DROP POLICY IF EXISTS "Approved users can insert profiles" ON public.profiles;

-- ============ 4. ADD WITH CHECK to ALL UPDATE policies ============

-- accounts_payable
DROP POLICY IF EXISTS "Approved users can update accounts_payable" ON public.accounts_payable;
CREATE POLICY "Approved users can update accounts_payable" ON public.accounts_payable
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- accounts_receivable
DROP POLICY IF EXISTS "Approved users can update accounts_receivable" ON public.accounts_receivable;
CREATE POLICY "Approved users can update accounts_receivable" ON public.accounts_receivable
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- bank_accounts
DROP POLICY IF EXISTS "Approved users can update bank_accounts" ON public.bank_accounts;
CREATE POLICY "Approved users can update bank_accounts" ON public.bank_accounts
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- baus
DROP POLICY IF EXISTS "Approved users can update baus" ON public.baus;
CREATE POLICY "Approved users can update baus" ON public.baus
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- bin_locations
DROP POLICY IF EXISTS "Approved users can update bin_locations" ON public.bin_locations;
CREATE POLICY "Approved users can update bin_locations" ON public.bin_locations
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- bom_operations
DROP POLICY IF EXISTS "Approved users can update bom_operations" ON public.bom_operations;
CREATE POLICY "Approved users can update bom_operations" ON public.bom_operations
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- bom_versions
DROP POLICY IF EXISTS "Approved users can update bom_versions" ON public.bom_versions;
CREATE POLICY "Approved users can update bom_versions" ON public.bom_versions
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- box_types
DROP POLICY IF EXISTS "Approved users can update box_types" ON public.box_types;
CREATE POLICY "Approved users can update box_types" ON public.box_types
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- budgets
DROP POLICY IF EXISTS "Approved users can update budgets" ON public.budgets;
CREATE POLICY "Approved users can update budgets" ON public.budgets
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- chart_of_accounts
DROP POLICY IF EXISTS "Approved users can update chart_of_accounts" ON public.chart_of_accounts;
CREATE POLICY "Approved users can update chart_of_accounts" ON public.chart_of_accounts
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- clients
DROP POLICY IF EXISTS "Approved users can update clients" ON public.clients;
CREATE POLICY "Approved users can update clients" ON public.clients
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- colors
DROP POLICY IF EXISTS "Approved users can update colors" ON public.colors;
CREATE POLICY "Approved users can update colors" ON public.colors
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- component_sheets
DROP POLICY IF EXISTS "Approved users can update component_sheets" ON public.component_sheets;
CREATE POLICY "Approved users can update component_sheets" ON public.component_sheets
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- contractors
DROP POLICY IF EXISTS "Approved users can update contractors" ON public.contractors;
CREATE POLICY "Approved users can update contractors" ON public.contractors
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- cost_centers
DROP POLICY IF EXISTS "Approved users can update cost_centers" ON public.cost_centers;
CREATE POLICY "Approved users can update cost_centers" ON public.cost_centers
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- cost_policies
DROP POLICY IF EXISTS "Approved users can update cost_policies" ON public.cost_policies;
CREATE POLICY "Approved users can update cost_policies" ON public.cost_policies
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- cycle_count_items
DROP POLICY IF EXISTS "Approved users can update cycle_count_items" ON public.cycle_count_items;
CREATE POLICY "Approved users can update cycle_count_items" ON public.cycle_count_items
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- cycle_counts
DROP POLICY IF EXISTS "Approved users can update cycle_counts" ON public.cycle_counts;
CREATE POLICY "Approved users can update cycle_counts" ON public.cycle_counts
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- economic_groups
DROP POLICY IF EXISTS "Approved users can update economic_groups" ON public.economic_groups;
CREATE POLICY "Approved users can update economic_groups" ON public.economic_groups
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- employee_advances (keep only the properly named one)
DROP POLICY IF EXISTS "Approved users can update employee_advances" ON public.employee_advances;
CREATE POLICY "Approved users can update employee_advances" ON public.employee_advances
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- employees
DROP POLICY IF EXISTS "Approved users can update employees" ON public.employees;
CREATE POLICY "Approved users can update employees" ON public.employees
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- financial_entries
DROP POLICY IF EXISTS "Approved users can update financial_entries" ON public.financial_entries;
CREATE POLICY "Approved users can update financial_entries" ON public.financial_entries
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- finished_goods_receipts
DROP POLICY IF EXISTS "Approved users can update finished_goods_receipts" ON public.finished_goods_receipts;
CREATE POLICY "Approved users can update finished_goods_receipts" ON public.finished_goods_receipts
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- fiscal_config
DROP POLICY IF EXISTS "Approved users can update fiscal_config" ON public.fiscal_config;
CREATE POLICY "Approved users can update fiscal_config" ON public.fiscal_config
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- goods_issue_items
DROP POLICY IF EXISTS "Approved users can update goods_issue_items" ON public.goods_issue_items;
CREATE POLICY "Approved users can update goods_issue_items" ON public.goods_issue_items
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- goods_issues
DROP POLICY IF EXISTS "Approved users can update goods_issues" ON public.goods_issues;
CREATE POLICY "Approved users can update goods_issues" ON public.goods_issues
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- group_supplier_materials
DROP POLICY IF EXISTS "Approved users can update group_supplier_materials" ON public.group_supplier_materials;
CREATE POLICY "Approved users can update group_supplier_materials" ON public.group_supplier_materials
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- group_suppliers
DROP POLICY IF EXISTS "Approved users can update group_suppliers" ON public.group_suppliers;
CREATE POLICY "Approved users can update group_suppliers" ON public.group_suppliers
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- holidays
DROP POLICY IF EXISTS "Approved users can update holidays" ON public.holidays;
CREATE POLICY "Approved users can update holidays" ON public.holidays
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- invoice_items
DROP POLICY IF EXISTS "Approved users can update invoice_items" ON public.invoice_items;
CREATE POLICY "Approved users can update invoice_items" ON public.invoice_items
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- invoices
DROP POLICY IF EXISTS "Approved users can update invoices" ON public.invoices;
CREATE POLICY "Approved users can update invoices" ON public.invoices
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- item_types
DROP POLICY IF EXISTS "Approved users can update item_types" ON public.item_types;
CREATE POLICY "Approved users can update item_types" ON public.item_types
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- labor_costs
DROP POLICY IF EXISTS "Approved users can update labor_costs" ON public.labor_costs;
CREATE POLICY "Approved users can update labor_costs" ON public.labor_costs
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- lot_tracking
DROP POLICY IF EXISTS "Approved users can update lot_tracking" ON public.lot_tracking;
CREATE POLICY "Approved users can update lot_tracking" ON public.lot_tracking
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- material_reservations
DROP POLICY IF EXISTS "Approved users can update material_reservations" ON public.material_reservations;
CREATE POLICY "Approved users can update material_reservations" ON public.material_reservations
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- mrp_suggestions
DROP POLICY IF EXISTS "Approved users can update mrp_suggestions" ON public.mrp_suggestions;
CREATE POLICY "Approved users can update mrp_suggestions" ON public.mrp_suggestions
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- nfe_emitidas
DROP POLICY IF EXISTS "Approved users can update nfe_emitidas" ON public.nfe_emitidas;
CREATE POLICY "Approved users can update nfe_emitidas" ON public.nfe_emitidas
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- order_stages
DROP POLICY IF EXISTS "Approved users can update order_stages" ON public.order_stages;
CREATE POLICY "Approved users can update order_stages" ON public.order_stages
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- orders
DROP POLICY IF EXISTS "Approved users can update orders" ON public.orders;
CREATE POLICY "Approved users can update orders" ON public.orders
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- overhead_allocations
DROP POLICY IF EXISTS "Approved users can update overhead_allocations" ON public.overhead_allocations;
CREATE POLICY "Approved users can update overhead_allocations" ON public.overhead_allocations
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- packaging_configs
DROP POLICY IF EXISTS "Approved users can update packaging_configs" ON public.packaging_configs;
CREATE POLICY "Approved users can update packaging_configs" ON public.packaging_configs
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- picking_list_items
DROP POLICY IF EXISTS "Approved users can update picking_list_items" ON public.picking_list_items;
CREATE POLICY "Approved users can update picking_list_items" ON public.picking_list_items
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- picking_lists
DROP POLICY IF EXISTS "Approved users can update picking_lists" ON public.picking_lists;
CREATE POLICY "Approved users can update picking_lists" ON public.picking_lists
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- product_groups
DROP POLICY IF EXISTS "Approved users can update product_groups" ON public.product_groups;
CREATE POLICY "Approved users can update product_groups" ON public.product_groups
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- production_consumptions
DROP POLICY IF EXISTS "Approved users can update production_consumptions" ON public.production_consumptions;
CREATE POLICY "Approved users can update production_consumptions" ON public.production_consumptions
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- products
DROP POLICY IF EXISTS "Approved users can update products" ON public.products;
CREATE POLICY "Approved users can update products" ON public.products
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- profiles: keep existing separate policies (own + admin)
DROP POLICY IF EXISTS "Approved users can update profiles" ON public.profiles;
-- "Users can update own profile" and "Admins can update any profile" already exist, add WITH CHECK
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile" ON public.profiles
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- purchase_order_items
DROP POLICY IF EXISTS "Approved users can update purchase_order_items" ON public.purchase_order_items;
CREATE POLICY "Approved users can update purchase_order_items" ON public.purchase_order_items
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- purchase_orders
DROP POLICY IF EXISTS "Approved users can update purchase_orders" ON public.purchase_orders;
CREATE POLICY "Approved users can update purchase_orders" ON public.purchase_orders
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- quality_records
DROP POLICY IF EXISTS "Approved users can update quality_records" ON public.quality_records;
CREATE POLICY "Approved users can update quality_records" ON public.quality_records
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- quarantine_stock
DROP POLICY IF EXISTS "Approved users can update quarantine_stock" ON public.quarantine_stock;
CREATE POLICY "Approved users can update quarantine_stock" ON public.quarantine_stock
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- ready_stock
DROP POLICY IF EXISTS "Approved users can update ready_stock" ON public.ready_stock;
CREATE POLICY "Approved users can update ready_stock" ON public.ready_stock
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- reference_color_variants
DROP POLICY IF EXISTS "Approved users can update reference_color_variants" ON public.reference_color_variants;
CREATE POLICY "Approved users can update reference_color_variants" ON public.reference_color_variants
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- reference_materials
DROP POLICY IF EXISTS "Approved users can update reference_materials" ON public.reference_materials;
CREATE POLICY "Approved users can update reference_materials" ON public.reference_materials
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- representatives
DROP POLICY IF EXISTS "Approved users can update representatives" ON public.representatives;
CREATE POLICY "Approved users can update representatives" ON public.representatives
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- reservation_batches
DROP POLICY IF EXISTS "Approved users can update reservation_batches" ON public.reservation_batches;
CREATE POLICY "Approved users can update reservation_batches" ON public.reservation_batches
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- sale_order_items
DROP POLICY IF EXISTS "Approved users can update sale_order_items" ON public.sale_order_items;
CREATE POLICY "Approved users can update sale_order_items" ON public.sale_order_items
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- sale_orders
DROP POLICY IF EXISTS "Approved users can update sale_orders" ON public.sale_orders;
CREATE POLICY "Approved users can update sale_orders" ON public.sale_orders
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- service_orders
DROP POLICY IF EXISTS "Approved users can update service_orders" ON public.service_orders;
CREATE POLICY "Approved users can update service_orders" ON public.service_orders
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- sheet_materials
DROP POLICY IF EXISTS "Approved users can update sheet_materials" ON public.sheet_materials;
CREATE POLICY "Approved users can update sheet_materials" ON public.sheet_materials
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- stock_movements
DROP POLICY IF EXISTS "Approved users can update stock_movements" ON public.stock_movements;
CREATE POLICY "Approved users can update stock_movements" ON public.stock_movements
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- suppliers
DROP POLICY IF EXISTS "Approved users can update suppliers" ON public.suppliers;
CREATE POLICY "Approved users can update suppliers" ON public.suppliers
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- technical_sheets
DROP POLICY IF EXISTS "Approved users can update technical_sheets" ON public.technical_sheets;
CREATE POLICY "Approved users can update technical_sheets" ON public.technical_sheets
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- time_records
DROP POLICY IF EXISTS "Approved users can update time_records" ON public.time_records;
CREATE POLICY "Approved users can update time_records" ON public.time_records
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- transport_companies
DROP POLICY IF EXISTS "Approved users can update transport_companies" ON public.transport_companies;
CREATE POLICY "Approved users can update transport_companies" ON public.transport_companies
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- transport_company_rates
DROP POLICY IF EXISTS "Approved users can update transport_company_rates" ON public.transport_company_rates;
CREATE POLICY "Approved users can update transport_company_rates" ON public.transport_company_rates
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- wip_ledger
DROP POLICY IF EXISTS "Approved users can update wip_ledger" ON public.wip_ledger;
CREATE POLICY "Approved users can update wip_ledger" ON public.wip_ledger
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- work_schedules
DROP POLICY IF EXISTS "Approved users can update work_schedules" ON public.work_schedules;
CREATE POLICY "Approved users can update work_schedules" ON public.work_schedules
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- cost_variance_reports
DROP POLICY IF EXISTS "Approved users can update cost_variance_reports" ON public.cost_variance_reports;
CREATE POLICY "Approved users can update cost_variance_reports" ON public.cost_variance_reports
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- cogs_entries
DROP POLICY IF EXISTS "Approved users can update cogs_entries" ON public.cogs_entries;
CREATE POLICY "Approved users can update cogs_entries" ON public.cogs_entries
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- label_templates
DROP POLICY IF EXISTS "Approved users can update label_templates" ON public.label_templates;
CREATE POLICY "Approved users can update label_templates" ON public.label_templates
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- print_jobs
DROP POLICY IF EXISTS "Approved users can update print_jobs" ON public.print_jobs;
CREATE POLICY "Approved users can update print_jobs" ON public.print_jobs
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- care_instructions
DROP POLICY IF EXISTS "Approved users can update care_instructions" ON public.care_instructions;
CREATE POLICY "Approved users can update care_instructions" ON public.care_instructions
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

-- product_references
DROP POLICY IF EXISTS "Approved users can update product_references" ON public.product_references;
CREATE POLICY "Approved users can update product_references" ON public.product_references
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());

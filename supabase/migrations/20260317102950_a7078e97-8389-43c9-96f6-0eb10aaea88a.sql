-- 1) Create a SECURITY DEFINER function to check if current user is approved
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND approved = true
  )
$$;

-- 2) Drop and recreate all permissive INSERT/UPDATE/DELETE policies

-- === accounts_payable ===
DROP POLICY IF EXISTS "Auth users can insert accounts_payable" ON public.accounts_payable;
DROP POLICY IF EXISTS "Auth users can update accounts_payable" ON public.accounts_payable;
DROP POLICY IF EXISTS "Auth users can delete accounts_payable" ON public.accounts_payable;
CREATE POLICY "Approved users can insert accounts_payable" ON public.accounts_payable FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update accounts_payable" ON public.accounts_payable FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete accounts_payable" ON public.accounts_payable FOR DELETE TO authenticated USING (public.is_approved_user());

-- === accounts_receivable ===
DROP POLICY IF EXISTS "Auth users can insert accounts_receivable" ON public.accounts_receivable;
DROP POLICY IF EXISTS "Auth users can update accounts_receivable" ON public.accounts_receivable;
DROP POLICY IF EXISTS "Auth users can delete accounts_receivable" ON public.accounts_receivable;
CREATE POLICY "Approved users can insert accounts_receivable" ON public.accounts_receivable FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update accounts_receivable" ON public.accounts_receivable FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete accounts_receivable" ON public.accounts_receivable FOR DELETE TO authenticated USING (public.is_approved_user());

-- === audit_logs ===
DROP POLICY IF EXISTS "Auth users can insert audit_logs" ON public.audit_logs;
CREATE POLICY "Approved users can insert audit_logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());

-- === bank_accounts ===
DROP POLICY IF EXISTS "Auth users can insert bank_accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "Auth users can update bank_accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "Auth users can delete bank_accounts" ON public.bank_accounts;
CREATE POLICY "Approved users can insert bank_accounts" ON public.bank_accounts FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update bank_accounts" ON public.bank_accounts FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete bank_accounts" ON public.bank_accounts FOR DELETE TO authenticated USING (public.is_approved_user());

-- === baus ===
DROP POLICY IF EXISTS "Auth users can insert baus" ON public.baus;
DROP POLICY IF EXISTS "Auth users can update baus" ON public.baus;
DROP POLICY IF EXISTS "Auth users can delete baus" ON public.baus;
CREATE POLICY "Approved users can insert baus" ON public.baus FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update baus" ON public.baus FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete baus" ON public.baus FOR DELETE TO authenticated USING (public.is_approved_user());

-- === bom_operations ===
DROP POLICY IF EXISTS "Auth users can insert bom_operations" ON public.bom_operations;
DROP POLICY IF EXISTS "Auth users can update bom_operations" ON public.bom_operations;
DROP POLICY IF EXISTS "Auth users can delete bom_operations" ON public.bom_operations;
CREATE POLICY "Approved users can insert bom_operations" ON public.bom_operations FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update bom_operations" ON public.bom_operations FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete bom_operations" ON public.bom_operations FOR DELETE TO authenticated USING (public.is_approved_user());

-- === bom_versions ===
DROP POLICY IF EXISTS "Auth users can insert bom_versions" ON public.bom_versions;
DROP POLICY IF EXISTS "Auth users can update bom_versions" ON public.bom_versions;
DROP POLICY IF EXISTS "Auth users can delete bom_versions" ON public.bom_versions;
CREATE POLICY "Approved users can insert bom_versions" ON public.bom_versions FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update bom_versions" ON public.bom_versions FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete bom_versions" ON public.bom_versions FOR DELETE TO authenticated USING (public.is_approved_user());

-- === box_types ===
DROP POLICY IF EXISTS "Auth users can insert box_types" ON public.box_types;
DROP POLICY IF EXISTS "Auth users can update box_types" ON public.box_types;
DROP POLICY IF EXISTS "Auth users can delete box_types" ON public.box_types;
CREATE POLICY "Approved users can insert box_types" ON public.box_types FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update box_types" ON public.box_types FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete box_types" ON public.box_types FOR DELETE TO authenticated USING (public.is_approved_user());

-- === budgets ===
DROP POLICY IF EXISTS "Auth users can insert budgets" ON public.budgets;
DROP POLICY IF EXISTS "Auth users can update budgets" ON public.budgets;
DROP POLICY IF EXISTS "Auth users can delete budgets" ON public.budgets;
CREATE POLICY "Approved users can insert budgets" ON public.budgets FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update budgets" ON public.budgets FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete budgets" ON public.budgets FOR DELETE TO authenticated USING (public.is_approved_user());

-- === chart_of_accounts ===
DROP POLICY IF EXISTS "Auth users can insert chart_of_accounts" ON public.chart_of_accounts;
DROP POLICY IF EXISTS "Auth users can update chart_of_accounts" ON public.chart_of_accounts;
DROP POLICY IF EXISTS "Auth users can delete chart_of_accounts" ON public.chart_of_accounts;
CREATE POLICY "Approved users can insert chart_of_accounts" ON public.chart_of_accounts FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update chart_of_accounts" ON public.chart_of_accounts FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete chart_of_accounts" ON public.chart_of_accounts FOR DELETE TO authenticated USING (public.is_approved_user());

-- === client_representatives ===
DROP POLICY IF EXISTS "Auth users can insert client_representatives" ON public.client_representatives;
DROP POLICY IF EXISTS "Auth users can delete client_representatives" ON public.client_representatives;
CREATE POLICY "Approved users can insert client_representatives" ON public.client_representatives FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can delete client_representatives" ON public.client_representatives FOR DELETE TO authenticated USING (public.is_approved_user());

-- === clients ===
DROP POLICY IF EXISTS "Auth users can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Auth users can update clients" ON public.clients;
DROP POLICY IF EXISTS "Auth users can delete clients" ON public.clients;
CREATE POLICY "Approved users can insert clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update clients" ON public.clients FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete clients" ON public.clients FOR DELETE TO authenticated USING (public.is_approved_user());

-- === component_sheets ===
DROP POLICY IF EXISTS "Auth users can insert component_sheets" ON public.component_sheets;
DROP POLICY IF EXISTS "Auth users can update component_sheets" ON public.component_sheets;
DROP POLICY IF EXISTS "Auth users can delete component_sheets" ON public.component_sheets;
CREATE POLICY "Approved users can insert component_sheets" ON public.component_sheets FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update component_sheets" ON public.component_sheets FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete component_sheets" ON public.component_sheets FOR DELETE TO authenticated USING (public.is_approved_user());

-- === contractors ===
DROP POLICY IF EXISTS "Auth users can insert contractors" ON public.contractors;
DROP POLICY IF EXISTS "Auth users can update contractors" ON public.contractors;
DROP POLICY IF EXISTS "Auth users can delete contractors" ON public.contractors;
CREATE POLICY "Approved users can insert contractors" ON public.contractors FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update contractors" ON public.contractors FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete contractors" ON public.contractors FOR DELETE TO authenticated USING (public.is_approved_user());

-- === cost_centers ===
DROP POLICY IF EXISTS "Auth users can insert cost_centers" ON public.cost_centers;
DROP POLICY IF EXISTS "Auth users can update cost_centers" ON public.cost_centers;
DROP POLICY IF EXISTS "Auth users can delete cost_centers" ON public.cost_centers;
CREATE POLICY "Approved users can insert cost_centers" ON public.cost_centers FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update cost_centers" ON public.cost_centers FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete cost_centers" ON public.cost_centers FOR DELETE TO authenticated USING (public.is_approved_user());

-- === cost_policies ===
DROP POLICY IF EXISTS "Auth users can insert cost_policies" ON public.cost_policies;
DROP POLICY IF EXISTS "Auth users can update cost_policies" ON public.cost_policies;
DROP POLICY IF EXISTS "Auth users can delete cost_policies" ON public.cost_policies;
CREATE POLICY "Approved users can insert cost_policies" ON public.cost_policies FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update cost_policies" ON public.cost_policies FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete cost_policies" ON public.cost_policies FOR DELETE TO authenticated USING (public.is_approved_user());

-- === economic_group_representatives ===
DROP POLICY IF EXISTS "Auth users can insert economic_group_representatives" ON public.economic_group_representatives;
DROP POLICY IF EXISTS "Auth users can delete economic_group_representatives" ON public.economic_group_representatives;
CREATE POLICY "Approved users can insert economic_group_representatives" ON public.economic_group_representatives FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can delete economic_group_representatives" ON public.economic_group_representatives FOR DELETE TO authenticated USING (public.is_approved_user());

-- === economic_groups ===
DROP POLICY IF EXISTS "Auth users can insert economic_groups" ON public.economic_groups;
DROP POLICY IF EXISTS "Auth users can update economic_groups" ON public.economic_groups;
DROP POLICY IF EXISTS "Auth users can delete economic_groups" ON public.economic_groups;
CREATE POLICY "Approved users can insert economic_groups" ON public.economic_groups FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update economic_groups" ON public.economic_groups FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete economic_groups" ON public.economic_groups FOR DELETE TO authenticated USING (public.is_approved_user());

-- === employee_advances ===
DROP POLICY IF EXISTS "Auth users can insert employee_advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Auth users can update employee_advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Auth users can delete employee_advances" ON public.employee_advances;
CREATE POLICY "Approved users can insert employee_advances" ON public.employee_advances FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update employee_advances" ON public.employee_advances FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete employee_advances" ON public.employee_advances FOR DELETE TO authenticated USING (public.is_approved_user());

-- === employees ===
DROP POLICY IF EXISTS "Auth users can insert employees" ON public.employees;
DROP POLICY IF EXISTS "Auth users can update employees" ON public.employees;
DROP POLICY IF EXISTS "Auth users can delete employees" ON public.employees;
CREATE POLICY "Approved users can insert employees" ON public.employees FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update employees" ON public.employees FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete employees" ON public.employees FOR DELETE TO authenticated USING (public.is_approved_user());

-- === financial_entries ===
DROP POLICY IF EXISTS "Auth users can insert financial_entries" ON public.financial_entries;
DROP POLICY IF EXISTS "Auth users can update financial_entries" ON public.financial_entries;
DROP POLICY IF EXISTS "Auth users can delete financial_entries" ON public.financial_entries;
CREATE POLICY "Approved users can insert financial_entries" ON public.financial_entries FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update financial_entries" ON public.financial_entries FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete financial_entries" ON public.financial_entries FOR DELETE TO authenticated USING (public.is_approved_user());

-- === fiscal_config ===
DROP POLICY IF EXISTS "Auth users can insert fiscal_config" ON public.fiscal_config;
DROP POLICY IF EXISTS "Auth users can update fiscal_config" ON public.fiscal_config;
DROP POLICY IF EXISTS "Auth users can delete fiscal_config" ON public.fiscal_config;
CREATE POLICY "Approved users can insert fiscal_config" ON public.fiscal_config FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update fiscal_config" ON public.fiscal_config FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete fiscal_config" ON public.fiscal_config FOR DELETE TO authenticated USING (public.is_approved_user());

-- === group_supplier_materials ===
DROP POLICY IF EXISTS "Auth users can insert group_supplier_materials" ON public.group_supplier_materials;
DROP POLICY IF EXISTS "Auth users can update group_supplier_materials" ON public.group_supplier_materials;
DROP POLICY IF EXISTS "Auth users can delete group_supplier_materials" ON public.group_supplier_materials;
CREATE POLICY "Approved users can insert group_supplier_materials" ON public.group_supplier_materials FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update group_supplier_materials" ON public.group_supplier_materials FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete group_supplier_materials" ON public.group_supplier_materials FOR DELETE TO authenticated USING (public.is_approved_user());

-- === group_suppliers ===
DROP POLICY IF EXISTS "Auth users can insert group_suppliers" ON public.group_suppliers;
DROP POLICY IF EXISTS "Auth users can update group_suppliers" ON public.group_suppliers;
DROP POLICY IF EXISTS "Auth users can delete group_suppliers" ON public.group_suppliers;
CREATE POLICY "Approved users can insert group_suppliers" ON public.group_suppliers FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update group_suppliers" ON public.group_suppliers FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete group_suppliers" ON public.group_suppliers FOR DELETE TO authenticated USING (public.is_approved_user());

-- === holidays ===
DROP POLICY IF EXISTS "Auth users can insert holidays" ON public.holidays;
DROP POLICY IF EXISTS "Auth users can update holidays" ON public.holidays;
DROP POLICY IF EXISTS "Auth users can delete holidays" ON public.holidays;
CREATE POLICY "Approved users can insert holidays" ON public.holidays FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update holidays" ON public.holidays FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete holidays" ON public.holidays FOR DELETE TO authenticated USING (public.is_approved_user());

-- === invoice_items ===
DROP POLICY IF EXISTS "Auth users can insert invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "Auth users can update invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "Auth users can delete invoice_items" ON public.invoice_items;
CREATE POLICY "Approved users can insert invoice_items" ON public.invoice_items FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update invoice_items" ON public.invoice_items FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete invoice_items" ON public.invoice_items FOR DELETE TO authenticated USING (public.is_approved_user());

-- === invoices ===
DROP POLICY IF EXISTS "Auth users can insert invoices" ON public.invoices;
DROP POLICY IF EXISTS "Auth users can update invoices" ON public.invoices;
DROP POLICY IF EXISTS "Auth users can delete invoices" ON public.invoices;
CREATE POLICY "Approved users can insert invoices" ON public.invoices FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update invoices" ON public.invoices FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete invoices" ON public.invoices FOR DELETE TO authenticated USING (public.is_approved_user());

-- === item_types ===
DROP POLICY IF EXISTS "Auth users can insert item_types" ON public.item_types;
DROP POLICY IF EXISTS "Auth users can update item_types" ON public.item_types;
DROP POLICY IF EXISTS "Auth users can delete item_types" ON public.item_types;
CREATE POLICY "Approved users can insert item_types" ON public.item_types FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update item_types" ON public.item_types FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete item_types" ON public.item_types FOR DELETE TO authenticated USING (public.is_approved_user());

-- === labor_costs ===
DROP POLICY IF EXISTS "Auth users can insert labor_costs" ON public.labor_costs;
DROP POLICY IF EXISTS "Auth users can update labor_costs" ON public.labor_costs;
DROP POLICY IF EXISTS "Auth users can delete labor_costs" ON public.labor_costs;
CREATE POLICY "Approved users can insert labor_costs" ON public.labor_costs FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update labor_costs" ON public.labor_costs FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete labor_costs" ON public.labor_costs FOR DELETE TO authenticated USING (public.is_approved_user());

-- === nfe_emitidas ===
DROP POLICY IF EXISTS "Auth users can insert nfe_emitidas" ON public.nfe_emitidas;
DROP POLICY IF EXISTS "Auth users can update nfe_emitidas" ON public.nfe_emitidas;
DROP POLICY IF EXISTS "Auth users can delete nfe_emitidas" ON public.nfe_emitidas;
CREATE POLICY "Approved users can insert nfe_emitidas" ON public.nfe_emitidas FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update nfe_emitidas" ON public.nfe_emitidas FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete nfe_emitidas" ON public.nfe_emitidas FOR DELETE TO authenticated USING (public.is_approved_user());

-- === order_stages ===
DROP POLICY IF EXISTS "Auth users can insert order_stages" ON public.order_stages;
DROP POLICY IF EXISTS "Auth users can update order_stages" ON public.order_stages;
DROP POLICY IF EXISTS "Auth users can delete order_stages" ON public.order_stages;
CREATE POLICY "Approved users can insert order_stages" ON public.order_stages FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update order_stages" ON public.order_stages FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete order_stages" ON public.order_stages FOR DELETE TO authenticated USING (public.is_approved_user());

-- === orders ===
DROP POLICY IF EXISTS "Auth users can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Auth users can update orders" ON public.orders;
DROP POLICY IF EXISTS "Auth users can delete orders" ON public.orders;
CREATE POLICY "Approved users can insert orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update orders" ON public.orders FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete orders" ON public.orders FOR DELETE TO authenticated USING (public.is_approved_user());

-- === overhead_allocations ===
DROP POLICY IF EXISTS "Auth users can insert overhead_allocations" ON public.overhead_allocations;
DROP POLICY IF EXISTS "Auth users can update overhead_allocations" ON public.overhead_allocations;
DROP POLICY IF EXISTS "Auth users can delete overhead_allocations" ON public.overhead_allocations;
CREATE POLICY "Approved users can insert overhead_allocations" ON public.overhead_allocations FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update overhead_allocations" ON public.overhead_allocations FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete overhead_allocations" ON public.overhead_allocations FOR DELETE TO authenticated USING (public.is_approved_user());

-- === product_groups ===
DROP POLICY IF EXISTS "Auth users can insert product_groups" ON public.product_groups;
DROP POLICY IF EXISTS "Auth users can update product_groups" ON public.product_groups;
DROP POLICY IF EXISTS "Auth users can delete product_groups" ON public.product_groups;
CREATE POLICY "Approved users can insert product_groups" ON public.product_groups FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update product_groups" ON public.product_groups FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete product_groups" ON public.product_groups FOR DELETE TO authenticated USING (public.is_approved_user());

-- === product_references ===
DROP POLICY IF EXISTS "Auth users can insert product_references" ON public.product_references;
DROP POLICY IF EXISTS "Auth users can update product_references" ON public.product_references;
DROP POLICY IF EXISTS "Auth users can delete product_references" ON public.product_references;
CREATE POLICY "Approved users can insert product_references" ON public.product_references FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update product_references" ON public.product_references FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete product_references" ON public.product_references FOR DELETE TO authenticated USING (public.is_approved_user());

-- === production_consumptions ===
DROP POLICY IF EXISTS "Auth users can insert production_consumptions" ON public.production_consumptions;
DROP POLICY IF EXISTS "Auth users can update production_consumptions" ON public.production_consumptions;
DROP POLICY IF EXISTS "Auth users can delete production_consumptions" ON public.production_consumptions;
CREATE POLICY "Approved users can insert production_consumptions" ON public.production_consumptions FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update production_consumptions" ON public.production_consumptions FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete production_consumptions" ON public.production_consumptions FOR DELETE TO authenticated USING (public.is_approved_user());

-- === products ===
DROP POLICY IF EXISTS "Auth users can insert products" ON public.products;
DROP POLICY IF EXISTS "Auth users can update products" ON public.products;
DROP POLICY IF EXISTS "Auth users can delete products" ON public.products;
CREATE POLICY "Approved users can insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update products" ON public.products FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete products" ON public.products FOR DELETE TO authenticated USING (public.is_approved_user());

-- === profiles ===
DROP POLICY IF EXISTS "Auth users can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Auth users can update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Auth users can delete profiles" ON public.profiles;
CREATE POLICY "Approved users can insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update profiles" ON public.profiles FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete profiles" ON public.profiles FOR DELETE TO authenticated USING (public.is_approved_user());

-- === purchase_order_items ===
DROP POLICY IF EXISTS "Auth users can insert purchase_order_items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Auth users can update purchase_order_items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Auth users can delete purchase_order_items" ON public.purchase_order_items;
CREATE POLICY "Approved users can insert purchase_order_items" ON public.purchase_order_items FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update purchase_order_items" ON public.purchase_order_items FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete purchase_order_items" ON public.purchase_order_items FOR DELETE TO authenticated USING (public.is_approved_user());

-- === purchase_orders ===
DROP POLICY IF EXISTS "Auth users can insert purchase_orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Auth users can update purchase_orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Auth users can delete purchase_orders" ON public.purchase_orders;
CREATE POLICY "Approved users can insert purchase_orders" ON public.purchase_orders FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update purchase_orders" ON public.purchase_orders FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete purchase_orders" ON public.purchase_orders FOR DELETE TO authenticated USING (public.is_approved_user());

-- === ready_stock ===
DROP POLICY IF EXISTS "Auth users can insert ready_stock" ON public.ready_stock;
DROP POLICY IF EXISTS "Auth users can update ready_stock" ON public.ready_stock;
DROP POLICY IF EXISTS "Auth users can delete ready_stock" ON public.ready_stock;
CREATE POLICY "Approved users can insert ready_stock" ON public.ready_stock FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update ready_stock" ON public.ready_stock FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete ready_stock" ON public.ready_stock FOR DELETE TO authenticated USING (public.is_approved_user());

-- === reference_color_variants ===
DROP POLICY IF EXISTS "Auth users can insert reference_color_variants" ON public.reference_color_variants;
DROP POLICY IF EXISTS "Auth users can update reference_color_variants" ON public.reference_color_variants;
DROP POLICY IF EXISTS "Auth users can delete reference_color_variants" ON public.reference_color_variants;
CREATE POLICY "Approved users can insert reference_color_variants" ON public.reference_color_variants FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update reference_color_variants" ON public.reference_color_variants FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete reference_color_variants" ON public.reference_color_variants FOR DELETE TO authenticated USING (public.is_approved_user());

-- === reference_materials ===
DROP POLICY IF EXISTS "Auth users can insert reference_materials" ON public.reference_materials;
DROP POLICY IF EXISTS "Auth users can update reference_materials" ON public.reference_materials;
DROP POLICY IF EXISTS "Auth users can delete reference_materials" ON public.reference_materials;
CREATE POLICY "Approved users can insert reference_materials" ON public.reference_materials FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update reference_materials" ON public.reference_materials FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete reference_materials" ON public.reference_materials FOR DELETE TO authenticated USING (public.is_approved_user());

-- === representatives ===
DROP POLICY IF EXISTS "Auth users can insert representatives" ON public.representatives;
DROP POLICY IF EXISTS "Auth users can update representatives" ON public.representatives;
DROP POLICY IF EXISTS "Auth users can delete representatives" ON public.representatives;
CREATE POLICY "Approved users can insert representatives" ON public.representatives FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update representatives" ON public.representatives FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete representatives" ON public.representatives FOR DELETE TO authenticated USING (public.is_approved_user());

-- === sale_order_items ===
DROP POLICY IF EXISTS "Auth users can insert sale_order_items" ON public.sale_order_items;
DROP POLICY IF EXISTS "Auth users can update sale_order_items" ON public.sale_order_items;
DROP POLICY IF EXISTS "Auth users can delete sale_order_items" ON public.sale_order_items;
CREATE POLICY "Approved users can insert sale_order_items" ON public.sale_order_items FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sale_order_items" ON public.sale_order_items FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sale_order_items" ON public.sale_order_items FOR DELETE TO authenticated USING (public.is_approved_user());

-- === sale_orders ===
DROP POLICY IF EXISTS "Auth users can insert sale_orders" ON public.sale_orders;
DROP POLICY IF EXISTS "Auth users can update sale_orders" ON public.sale_orders;
DROP POLICY IF EXISTS "Auth users can delete sale_orders" ON public.sale_orders;
CREATE POLICY "Approved users can insert sale_orders" ON public.sale_orders FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sale_orders" ON public.sale_orders FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sale_orders" ON public.sale_orders FOR DELETE TO authenticated USING (public.is_approved_user());

-- === service_orders ===
DROP POLICY IF EXISTS "Auth users can insert service_orders" ON public.service_orders;
DROP POLICY IF EXISTS "Auth users can update service_orders" ON public.service_orders;
DROP POLICY IF EXISTS "Auth users can delete service_orders" ON public.service_orders;
CREATE POLICY "Approved users can insert service_orders" ON public.service_orders FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update service_orders" ON public.service_orders FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete service_orders" ON public.service_orders FOR DELETE TO authenticated USING (public.is_approved_user());

-- === sheet_materials ===
DROP POLICY IF EXISTS "Auth users can insert sheet_materials" ON public.sheet_materials;
DROP POLICY IF EXISTS "Auth users can update sheet_materials" ON public.sheet_materials;
DROP POLICY IF EXISTS "Auth users can delete sheet_materials" ON public.sheet_materials;
CREATE POLICY "Approved users can insert sheet_materials" ON public.sheet_materials FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sheet_materials" ON public.sheet_materials FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sheet_materials" ON public.sheet_materials FOR DELETE TO authenticated USING (public.is_approved_user());

-- === stock_movements ===
DROP POLICY IF EXISTS "Auth users can insert stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "Auth users can update stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "Auth users can delete stock_movements" ON public.stock_movements;
CREATE POLICY "Approved users can insert stock_movements" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update stock_movements" ON public.stock_movements FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete stock_movements" ON public.stock_movements FOR DELETE TO authenticated USING (public.is_approved_user());

-- === suppliers ===
DROP POLICY IF EXISTS "Auth users can insert suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Auth users can update suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Auth users can delete suppliers" ON public.suppliers;
CREATE POLICY "Approved users can insert suppliers" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update suppliers" ON public.suppliers FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete suppliers" ON public.suppliers FOR DELETE TO authenticated USING (public.is_approved_user());

-- === technical_sheets ===
DROP POLICY IF EXISTS "Auth users can insert technical_sheets" ON public.technical_sheets;
DROP POLICY IF EXISTS "Auth users can update technical_sheets" ON public.technical_sheets;
DROP POLICY IF EXISTS "Auth users can delete technical_sheets" ON public.technical_sheets;
CREATE POLICY "Approved users can insert technical_sheets" ON public.technical_sheets FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update technical_sheets" ON public.technical_sheets FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete technical_sheets" ON public.technical_sheets FOR DELETE TO authenticated USING (public.is_approved_user());

-- === time_records ===
DROP POLICY IF EXISTS "Auth users can insert time_records" ON public.time_records;
DROP POLICY IF EXISTS "Auth users can update time_records" ON public.time_records;
DROP POLICY IF EXISTS "Auth users can delete time_records" ON public.time_records;
CREATE POLICY "Approved users can insert time_records" ON public.time_records FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update time_records" ON public.time_records FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete time_records" ON public.time_records FOR DELETE TO authenticated USING (public.is_approved_user());

-- === transport_companies ===
DROP POLICY IF EXISTS "Auth users can insert transport_companies" ON public.transport_companies;
DROP POLICY IF EXISTS "Auth users can update transport_companies" ON public.transport_companies;
DROP POLICY IF EXISTS "Auth users can delete transport_companies" ON public.transport_companies;
CREATE POLICY "Approved users can insert transport_companies" ON public.transport_companies FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update transport_companies" ON public.transport_companies FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete transport_companies" ON public.transport_companies FOR DELETE TO authenticated USING (public.is_approved_user());

-- === transport_company_rates ===
DROP POLICY IF EXISTS "Auth users can insert transport_company_rates" ON public.transport_company_rates;
DROP POLICY IF EXISTS "Auth users can update transport_company_rates" ON public.transport_company_rates;
DROP POLICY IF EXISTS "Auth users can delete transport_company_rates" ON public.transport_company_rates;
CREATE POLICY "Approved users can insert transport_company_rates" ON public.transport_company_rates FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update transport_company_rates" ON public.transport_company_rates FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete transport_company_rates" ON public.transport_company_rates FOR DELETE TO authenticated USING (public.is_approved_user());

-- === work_schedules ===
DROP POLICY IF EXISTS "Auth users can insert work_schedules" ON public.work_schedules;
DROP POLICY IF EXISTS "Auth users can update work_schedules" ON public.work_schedules;
DROP POLICY IF EXISTS "Auth users can delete work_schedules" ON public.work_schedules;
CREATE POLICY "Approved users can insert work_schedules" ON public.work_schedules FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update work_schedules" ON public.work_schedules FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete work_schedules" ON public.work_schedules FOR DELETE TO authenticated USING (public.is_approved_user());
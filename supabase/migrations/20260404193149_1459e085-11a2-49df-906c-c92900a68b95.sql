
-- Fix RLS: Restrict SELECT on sensitive tables to approved users only

-- clients
DROP POLICY IF EXISTS "Authenticated users can read clients" ON public.clients;
DROP POLICY IF EXISTS "Approved users can read clients" ON public.clients;
CREATE POLICY "Approved users can read clients" ON public.clients FOR SELECT TO authenticated USING (public.is_approved_user());

-- representatives
DROP POLICY IF EXISTS "Authenticated users can read representatives" ON public.representatives;
DROP POLICY IF EXISTS "Approved users can read representatives" ON public.representatives;
CREATE POLICY "Approved users can read representatives" ON public.representatives FOR SELECT TO authenticated USING (public.is_approved_user());

-- contractors
DROP POLICY IF EXISTS "Authenticated users can read contractors" ON public.contractors;
DROP POLICY IF EXISTS "Approved users can read contractors" ON public.contractors;
CREATE POLICY "Approved users can read contractors" ON public.contractors FOR SELECT TO authenticated USING (public.is_approved_user());

-- suppliers
DROP POLICY IF EXISTS "Authenticated users can read suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Approved users can read suppliers" ON public.suppliers;
CREATE POLICY "Approved users can read suppliers" ON public.suppliers FOR SELECT TO authenticated USING (public.is_approved_user());

-- employee_advances
DROP POLICY IF EXISTS "Authenticated users can read employee_advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Approved users can read employee_advances" ON public.employee_advances;
CREATE POLICY "Approved users can read employee_advances" ON public.employee_advances FOR SELECT TO authenticated USING (public.is_approved_user());

-- bank_accounts
DROP POLICY IF EXISTS "Authenticated users can read bank_accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "Approved users can read bank_accounts" ON public.bank_accounts;
CREATE POLICY "Approved users can read bank_accounts" ON public.bank_accounts FOR SELECT TO authenticated USING (public.is_approved_user());

-- accounts_payable
DROP POLICY IF EXISTS "Authenticated users can read accounts_payable" ON public.accounts_payable;
DROP POLICY IF EXISTS "Approved users can read accounts_payable" ON public.accounts_payable;
CREATE POLICY "Approved users can read accounts_payable" ON public.accounts_payable FOR SELECT TO authenticated USING (public.is_approved_user());

-- accounts_receivable
DROP POLICY IF EXISTS "Authenticated users can read accounts_receivable" ON public.accounts_receivable;
DROP POLICY IF EXISTS "Approved users can read accounts_receivable" ON public.accounts_receivable;
CREATE POLICY "Approved users can read accounts_receivable" ON public.accounts_receivable FOR SELECT TO authenticated USING (public.is_approved_user());

-- sale_orders
DROP POLICY IF EXISTS "Authenticated users can read sale_orders" ON public.sale_orders;
DROP POLICY IF EXISTS "Approved users can read sale_orders" ON public.sale_orders;
CREATE POLICY "Approved users can read sale_orders" ON public.sale_orders FOR SELECT TO authenticated USING (public.is_approved_user());

-- group_suppliers
DROP POLICY IF EXISTS "Authenticated users can read group_suppliers" ON public.group_suppliers;
DROP POLICY IF EXISTS "Approved users can read group_suppliers" ON public.group_suppliers;
CREATE POLICY "Approved users can read group_suppliers" ON public.group_suppliers FOR SELECT TO authenticated USING (public.is_approved_user());

-- transport_companies
DROP POLICY IF EXISTS "Authenticated users can read transport_companies" ON public.transport_companies;
DROP POLICY IF EXISTS "Approved users can read transport_companies" ON public.transport_companies;
CREATE POLICY "Approved users can read transport_companies" ON public.transport_companies FOR SELECT TO authenticated USING (public.is_approved_user());

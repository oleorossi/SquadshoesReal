
-- Remove overly permissive SELECT policies that override the restricted ones
DROP POLICY IF EXISTS "Auth users can view accounts_payable" ON public.accounts_payable;
DROP POLICY IF EXISTS "Auth users can view accounts_receivable" ON public.accounts_receivable;
DROP POLICY IF EXISTS "Auth users can view bank_accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "Auth users can view clients" ON public.clients;
DROP POLICY IF EXISTS "Auth users can view contractors" ON public.contractors;
DROP POLICY IF EXISTS "Auth users can view representatives" ON public.representatives;
DROP POLICY IF EXISTS "Auth users can view suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Auth users can view sale_orders" ON public.sale_orders;
DROP POLICY IF EXISTS "Auth users can view group_suppliers" ON public.group_suppliers;
DROP POLICY IF EXISTS "Auth users can view transport_companies" ON public.transport_companies;

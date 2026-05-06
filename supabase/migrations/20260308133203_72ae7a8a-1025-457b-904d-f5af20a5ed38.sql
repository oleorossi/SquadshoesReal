
-- Plano de Contas
CREATE TABLE public.chart_of_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'despesa', -- receita, despesa, ativo, passivo
  parent_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  level INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view chart_of_accounts" ON public.chart_of_accounts;
CREATE POLICY "Auth users can view chart_of_accounts" ON public.chart_of_accounts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert chart_of_accounts" ON public.chart_of_accounts;
CREATE POLICY "Auth users can insert chart_of_accounts" ON public.chart_of_accounts FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update chart_of_accounts" ON public.chart_of_accounts;
CREATE POLICY "Auth users can update chart_of_accounts" ON public.chart_of_accounts FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete chart_of_accounts" ON public.chart_of_accounts;
CREATE POLICY "Auth users can delete chart_of_accounts" ON public.chart_of_accounts FOR DELETE TO authenticated USING (true);

-- Centros de Custo
CREATE TABLE public.cost_centers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'producao', -- producao, comercial, administrativo, logistica
  description TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view cost_centers" ON public.cost_centers;
CREATE POLICY "Auth users can view cost_centers" ON public.cost_centers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert cost_centers" ON public.cost_centers;
CREATE POLICY "Auth users can insert cost_centers" ON public.cost_centers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update cost_centers" ON public.cost_centers;
CREATE POLICY "Auth users can update cost_centers" ON public.cost_centers FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete cost_centers" ON public.cost_centers;
CREATE POLICY "Auth users can delete cost_centers" ON public.cost_centers FOR DELETE TO authenticated USING (true);

-- Contas Bancárias
CREATE TABLE public.bank_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  bank_name TEXT NOT NULL DEFAULT '',
  agency TEXT DEFAULT '',
  account_number TEXT DEFAULT '',
  account_type TEXT NOT NULL DEFAULT 'corrente', -- corrente, poupanca, investimento
  initial_balance NUMERIC NOT NULL DEFAULT 0,
  current_balance NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view bank_accounts" ON public.bank_accounts;
CREATE POLICY "Auth users can view bank_accounts" ON public.bank_accounts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert bank_accounts" ON public.bank_accounts;
CREATE POLICY "Auth users can insert bank_accounts" ON public.bank_accounts FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update bank_accounts" ON public.bank_accounts;
CREATE POLICY "Auth users can update bank_accounts" ON public.bank_accounts FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete bank_accounts" ON public.bank_accounts;
CREATE POLICY "Auth users can delete bank_accounts" ON public.bank_accounts FOR DELETE TO authenticated USING (true);

-- Lançamentos Financeiros
CREATE TABLE public.financial_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  type TEXT NOT NULL DEFAULT 'despesa', -- receita, despesa, transferencia
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  reference_type TEXT DEFAULT '', -- nf, pedido, op, manual
  reference_id TEXT DEFAULT '',
  collection TEXT DEFAULT '', -- coleção
  sku TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente, conciliado, cancelado
  reconciled BOOLEAN NOT NULL DEFAULT false,
  reconciled_at TIMESTAMPTZ,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view financial_entries" ON public.financial_entries;
CREATE POLICY "Auth users can view financial_entries" ON public.financial_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert financial_entries" ON public.financial_entries;
CREATE POLICY "Auth users can insert financial_entries" ON public.financial_entries FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update financial_entries" ON public.financial_entries;
CREATE POLICY "Auth users can update financial_entries" ON public.financial_entries FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete financial_entries" ON public.financial_entries;
CREATE POLICY "Auth users can delete financial_entries" ON public.financial_entries FOR DELETE TO authenticated USING (true);

-- Custos de Mão de Obra
CREATE TABLE public.labor_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  operation_name TEXT NOT NULL,
  hour_cost NUMERIC NOT NULL DEFAULT 0,
  time_per_unit_minutes NUMERIC NOT NULL DEFAULT 0,
  cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.labor_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view labor_costs" ON public.labor_costs;
CREATE POLICY "Auth users can view labor_costs" ON public.labor_costs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert labor_costs" ON public.labor_costs;
CREATE POLICY "Auth users can insert labor_costs" ON public.labor_costs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update labor_costs" ON public.labor_costs;
CREATE POLICY "Auth users can update labor_costs" ON public.labor_costs FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete labor_costs" ON public.labor_costs;
CREATE POLICY "Auth users can delete labor_costs" ON public.labor_costs FOR DELETE TO authenticated USING (true);

-- Rateio de Custos Indiretos (Overhead)
CREATE TABLE public.overhead_allocations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period TEXT NOT NULL DEFAULT '', -- ex: 2026-03
  cost_type TEXT NOT NULL DEFAULT '', -- energia, aluguel, manutencao, depreciacao
  total_amount NUMERIC NOT NULL DEFAULT 0,
  allocation_base TEXT NOT NULL DEFAULT 'hora_maquina', -- hora_maquina, area, qty_produzida
  cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.overhead_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view overhead_allocations" ON public.overhead_allocations;
CREATE POLICY "Auth users can view overhead_allocations" ON public.overhead_allocations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert overhead_allocations" ON public.overhead_allocations;
CREATE POLICY "Auth users can insert overhead_allocations" ON public.overhead_allocations FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update overhead_allocations" ON public.overhead_allocations;
CREATE POLICY "Auth users can update overhead_allocations" ON public.overhead_allocations FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete overhead_allocations" ON public.overhead_allocations;
CREATE POLICY "Auth users can delete overhead_allocations" ON public.overhead_allocations FOR DELETE TO authenticated USING (true);

-- Orçamentos (Budget)
CREATE TABLE public.budgets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period TEXT NOT NULL DEFAULT '', -- ex: 2026-03
  cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  planned_amount NUMERIC NOT NULL DEFAULT 0,
  actual_amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view budgets" ON public.budgets;
CREATE POLICY "Auth users can view budgets" ON public.budgets FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert budgets" ON public.budgets;
CREATE POLICY "Auth users can insert budgets" ON public.budgets FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update budgets" ON public.budgets;
CREATE POLICY "Auth users can update budgets" ON public.budgets FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete budgets" ON public.budgets;
CREATE POLICY "Auth users can delete budgets" ON public.budgets FOR DELETE TO authenticated USING (true);

-- Add cost_center_id to existing tables
ALTER TABLE public.accounts_payable ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL;
ALTER TABLE public.accounts_payable ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.accounts_receivable ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL;
ALTER TABLE public.accounts_receivable ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS labor_cost NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS overhead_cost NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS material_cost NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_production_cost NUMERIC DEFAULT 0;

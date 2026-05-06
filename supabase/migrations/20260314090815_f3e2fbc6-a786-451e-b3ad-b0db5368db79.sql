
-- 1) BOM Operations: operações produtivas vinculadas à ficha técnica
CREATE TABLE public.bom_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  operation_name text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT '', -- corte, costura, montagem, acabamento, embalagem
  standard_time_minutes numeric NOT NULL DEFAULT 0,
  resource_name text DEFAULT '',
  cost_per_hour numeric NOT NULL DEFAULT 0,
  cost_per_pair numeric GENERATED ALWAYS AS (CASE WHEN cost_per_hour > 0 THEN (standard_time_minutes / 60.0) * cost_per_hour ELSE 0 END) STORED,
  sort_order integer NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bom_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view bom_operations" ON public.bom_operations;
CREATE POLICY "Auth users can view bom_operations" ON public.bom_operations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert bom_operations" ON public.bom_operations;
CREATE POLICY "Auth users can insert bom_operations" ON public.bom_operations FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update bom_operations" ON public.bom_operations;
CREATE POLICY "Auth users can update bom_operations" ON public.bom_operations FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete bom_operations" ON public.bom_operations;
CREATE POLICY "Auth users can delete bom_operations" ON public.bom_operations FOR DELETE TO authenticated USING (true);

-- 2) BOM Versions: snapshots de versões da ficha técnica
CREATE TABLE public.bom_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  version_number text NOT NULL DEFAULT 'v1',
  description text DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}', -- full snapshot of sheet data at time of version
  materials_snapshot jsonb DEFAULT '[]', -- snapshot of BOM materials
  operations_snapshot jsonb DEFAULT '[]', -- snapshot of operations
  status text NOT NULL DEFAULT 'draft', -- draft, pending_approval, approved, rejected
  approved_by text DEFAULT '',
  approved_at timestamptz,
  created_by text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bom_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view bom_versions" ON public.bom_versions;
CREATE POLICY "Auth users can view bom_versions" ON public.bom_versions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert bom_versions" ON public.bom_versions;
CREATE POLICY "Auth users can insert bom_versions" ON public.bom_versions FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update bom_versions" ON public.bom_versions;
CREATE POLICY "Auth users can update bom_versions" ON public.bom_versions FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete bom_versions" ON public.bom_versions;
CREATE POLICY "Auth users can delete bom_versions" ON public.bom_versions FOR DELETE TO authenticated USING (true);

-- 3) Production Consumptions: consumo real por OP (padrão vs real)
CREATE TABLE public.production_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id),
  component_type text NOT NULL DEFAULT 'bom', -- bom, spec, strap, operation
  component_name text DEFAULT '',
  standard_quantity numeric NOT NULL DEFAULT 0,
  actual_quantity numeric NOT NULL DEFAULT 0,
  standard_cost numeric NOT NULL DEFAULT 0,
  actual_cost numeric NOT NULL DEFAULT 0,
  variance_quantity numeric GENERATED ALWAYS AS (actual_quantity - standard_quantity) STORED,
  variance_cost numeric GENERATED ALWAYS AS (actual_cost - standard_cost) STORED,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.production_consumptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view production_consumptions" ON public.production_consumptions;
CREATE POLICY "Auth users can view production_consumptions" ON public.production_consumptions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert production_consumptions" ON public.production_consumptions;
CREATE POLICY "Auth users can insert production_consumptions" ON public.production_consumptions FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update production_consumptions" ON public.production_consumptions;
CREATE POLICY "Auth users can update production_consumptions" ON public.production_consumptions FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete production_consumptions" ON public.production_consumptions;
CREATE POLICY "Auth users can delete production_consumptions" ON public.production_consumptions FOR DELETE TO authenticated USING (true);

-- 4) Cost Policies: configurações globais de custeio
CREATE TABLE public.cost_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valuation_method text NOT NULL DEFAULT 'weighted_average', -- weighted_average, fifo
  overhead_rate_per_pair numeric NOT NULL DEFAULT 0,
  overhead_monthly_total numeric NOT NULL DEFAULT 0,
  monthly_production_target integer NOT NULL DEFAULT 0,
  freight_allocation_pct numeric NOT NULL DEFAULT 0,
  packaging_cost_per_pair numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cost_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view cost_policies" ON public.cost_policies;
CREATE POLICY "Auth users can view cost_policies" ON public.cost_policies FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert cost_policies" ON public.cost_policies;
CREATE POLICY "Auth users can insert cost_policies" ON public.cost_policies FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update cost_policies" ON public.cost_policies;
CREATE POLICY "Auth users can update cost_policies" ON public.cost_policies FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete cost_policies" ON public.cost_policies;
CREATE POLICY "Auth users can delete cost_policies" ON public.cost_policies FOR DELETE TO authenticated USING (true);

-- 5) Audit Logs: rastreabilidade de alterações
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL DEFAULT '', -- insert, update, delete
  old_data jsonb DEFAULT '{}',
  new_data jsonb DEFAULT '{}',
  user_id uuid,
  user_name text DEFAULT '',
  description text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view audit_logs" ON public.audit_logs;
CREATE POLICY "Auth users can view audit_logs" ON public.audit_logs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert audit_logs" ON public.audit_logs;
CREATE POLICY "Auth users can insert audit_logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- 6) Add standard/actual cost fields to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS standard_cost_per_pair numeric DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS actual_cost_per_pair numeric DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cost_variance numeric DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS mod_cost numeric DEFAULT 0;

-- 7) Insert default cost policy
INSERT INTO public.cost_policies (valuation_method, overhead_rate_per_pair, overhead_monthly_total, monthly_production_target, freight_allocation_pct, packaging_cost_per_pair)
VALUES ('weighted_average', 1.20, 24000, 20000, 2, 0.80);

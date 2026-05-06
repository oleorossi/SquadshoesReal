-- 1. Equipamentos
CREATE TABLE public.production_equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    category TEXT,
    purchase_date DATE,
    last_maintenance_date TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.production_equipment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved users can manage equipment"
  ON public.production_equipment FOR ALL TO authenticated
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
CREATE TRIGGER update_production_equipment_updated_at
  BEFORE UPDATE ON public.production_equipment
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Downtime
CREATE TABLE public.equipment_downtime (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id UUID REFERENCES public.production_equipment(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    impacted_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.equipment_downtime ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved users can manage downtime"
  ON public.equipment_downtime FOR ALL TO authenticated
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

-- 3. Checklists
CREATE TABLE public.quality_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    requirements JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.quality_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved users can manage checklists"
  ON public.quality_checklists FOR ALL TO authenticated
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

-- 4. Inspeções
CREATE TABLE public.quality_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    checklist_id UUID REFERENCES public.quality_checklists(id) ON DELETE SET NULL,
    inspector_id UUID NOT NULL,
    status TEXT DEFAULT 'pending',
    results JSONB,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.quality_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved users can manage inspections"
  ON public.quality_inspections FOR ALL TO authenticated
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

-- 5. Habilidades
CREATE TABLE public.employee_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
    skill_name TEXT NOT NULL,
    proficiency_level INTEGER CHECK (proficiency_level BETWEEN 1 AND 5),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.employee_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved users can manage skills"
  ON public.employee_skills FOR ALL TO authenticated
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

-- 6. Nível de habilidade na BOM
ALTER TABLE public.bom_operations 
ADD COLUMN IF NOT EXISTS required_skill_level INTEGER DEFAULT 1;

-- 7. Metas de Vendas
CREATE TABLE public.sales_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    representative_id UUID REFERENCES public.representatives(id) ON DELETE CASCADE,
    period_month INTEGER NOT NULL,
    period_year INTEGER NOT NULL,
    target_amount NUMERIC(15,2) NOT NULL,
    category TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(representative_id, period_month, period_year)
);
ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved users can manage sales targets"
  ON public.sales_targets FOR ALL TO authenticated
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

-- 8. View Ranking Fornecedores (corrigido: suppliers.name, não razao_social)
CREATE OR REPLACE VIEW public.vw_supplier_quality_rating
WITH (security_invoker = true) AS
SELECT 
    s.id as supplier_id,
    s.name as supplier_name,
    COUNT(fgr.id) as total_receipts,
    AVG(CASE WHEN fgr.inspection_status = 'passed' THEN 100 ELSE 0 END) as quality_score
FROM public.suppliers s
LEFT JOIN public.products p ON s.id = p.supplier_id
LEFT JOIN public.orders o ON o.reference_id IN (
    SELECT ts.id FROM public.technical_sheets ts
)
LEFT JOIN public.finished_goods_receipts fgr ON fgr.order_id = o.id
GROUP BY s.id, s.name;

-- 9. View Fluxo de Caixa Projetado
CREATE OR REPLACE VIEW public.vw_cash_flow_projection
WITH (security_invoker = true) AS
WITH entries AS (
    SELECT due_date, amount as inflow, 0::numeric as outflow, 'Receivable' as origin
    FROM public.accounts_receivable WHERE status != 'paid'
    UNION ALL
    SELECT due_date, 0::numeric as inflow, amount as outflow, 'Payable' as origin
    FROM public.accounts_payable WHERE status != 'paid'
    UNION ALL
    SELECT (CURRENT_DATE + interval '30 days')::DATE, 0::numeric, (quantity * unit_price)::numeric, 'MRP'
    FROM public.purchase_order_items
    WHERE purchase_order_id IN (SELECT id FROM public.purchase_orders WHERE status = 'pending')
)
SELECT 
    due_date,
    SUM(inflow) as total_inflow,
    SUM(outflow) as total_outflow,
    SUM(inflow - outflow) as daily_net
FROM entries
GROUP BY due_date
ORDER BY due_date;
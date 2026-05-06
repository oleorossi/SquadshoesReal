
-- 1. Enriquecer sheet_materials
ALTER TABLE public.sheet_materials
ADD COLUMN IF NOT EXISTS sector TEXT CHECK (sector IN ('corte', 'costura', 'forracao', 'palmilha', 'montagem', 'acabamento')),
ADD COLUMN IF NOT EXISTS consumption_type TEXT DEFAULT 'fixed',
ADD COLUMN IF NOT EXISTS wastage_percentage NUMERIC(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS part_name TEXT,
ADD COLUMN IF NOT EXISTS color_id UUID REFERENCES public.colors(id);

-- 2. Tabela de consumo graduado
CREATE TABLE IF NOT EXISTS public.sheet_material_grading (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_material_id UUID NOT NULL REFERENCES public.sheet_materials(id) ON DELETE CASCADE,
    size_number INTEGER NOT NULL,
    specific_consumption NUMERIC(12,4) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.sheet_material_grading ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sheet_material_grading' AND policyname = 'Approved users can manage grading') THEN
    DROP POLICY IF EXISTS "Approved users can manage grading" ON public.sheet_material_grading;
CREATE POLICY "Approved users can manage grading"
      ON public.sheet_material_grading FOR ALL TO authenticated
      USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
  END IF;
END $$;

-- 3. Views
DROP VIEW IF EXISTS public.vw_necessidade_corte CASCADE;
CREATE OR REPLACE VIEW public.vw_necessidade_corte
WITH (security_invoker = true) AS
SELECT 
    o.order_number,
    ts.name as modelo,
    sm.part_name,
    p.name as material,
    o.quantity as qty_pedido,
    sm.quantity_per_unit as consumo_unitario,
    sm.wastage_percentage,
    (o.quantity * sm.quantity_per_unit * (1 + COALESCE(sm.wastage_percentage, 0) / 100)) as total_necessario,
    COALESCE(p.production_unit, p.purchase_unit, 'un') as unidade
FROM public.orders o
JOIN public.technical_sheets ts ON ts.id = o.reference_id
JOIN public.sheet_materials sm ON sm.sheet_id = ts.id
JOIN public.products p ON p.id = sm.product_id
WHERE sm.sector = 'corte'
  AND o.status NOT IN ('Finalizada', 'Cancelada');

DROP VIEW IF EXISTS public.vw_necessidade_costura CASCADE;
CREATE OR REPLACE VIEW public.vw_necessidade_costura
WITH (security_invoker = true) AS
SELECT 
    o.order_number,
    ts.name as modelo,
    sm.part_name as operacao_costura,
    p.name as componente_a_costurar
FROM public.orders o
JOIN public.technical_sheets ts ON ts.id = o.reference_id
JOIN public.sheet_materials sm ON sm.sheet_id = ts.id
JOIN public.products p ON p.id = sm.product_id
WHERE sm.sector = 'costura' 
   OR p.requires_sewing = true;

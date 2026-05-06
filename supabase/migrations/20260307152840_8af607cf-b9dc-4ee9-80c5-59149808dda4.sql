
-- Technical sheets (fichas técnicas) as reusable templates
CREATE TABLE public.technical_sheets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  shoe_category TEXT DEFAULT '',
  sizes TEXT DEFAULT '33-41',
  status TEXT NOT NULL DEFAULT 'Ativo',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Materials linked to technical sheets
CREATE TABLE public.sheet_materials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_id UUID NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity_per_unit NUMERIC NOT NULL DEFAULT 0,
  color TEXT DEFAULT '',
  width TEXT DEFAULT '',
  weight TEXT DEFAULT '',
  supplier TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  sizes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Link references to technical sheets
ALTER TABLE public.product_references 
ADD COLUMN technical_sheet_id UUID REFERENCES public.technical_sheets(id);

-- RLS for technical_sheets
ALTER TABLE public.technical_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view technical_sheets" ON public.technical_sheets;
CREATE POLICY "Auth users can view technical_sheets" ON public.technical_sheets FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert technical_sheets" ON public.technical_sheets;
CREATE POLICY "Auth users can insert technical_sheets" ON public.technical_sheets FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update technical_sheets" ON public.technical_sheets;
CREATE POLICY "Auth users can update technical_sheets" ON public.technical_sheets FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete technical_sheets" ON public.technical_sheets;
CREATE POLICY "Auth users can delete technical_sheets" ON public.technical_sheets FOR DELETE TO authenticated USING (true);

-- RLS for sheet_materials
ALTER TABLE public.sheet_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view sheet_materials" ON public.sheet_materials;
CREATE POLICY "Auth users can view sheet_materials" ON public.sheet_materials FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert sheet_materials" ON public.sheet_materials;
CREATE POLICY "Auth users can insert sheet_materials" ON public.sheet_materials FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update sheet_materials" ON public.sheet_materials;
CREATE POLICY "Auth users can update sheet_materials" ON public.sheet_materials FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete sheet_materials" ON public.sheet_materials;
CREATE POLICY "Auth users can delete sheet_materials" ON public.sheet_materials FOR DELETE TO authenticated USING (true);

-- Updated_at trigger
CREATE TRIGGER update_technical_sheets_updated_at
  BEFORE UPDATE ON public.technical_sheets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

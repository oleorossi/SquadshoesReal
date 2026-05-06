
-- Technical References: validated specifications linked to technical sheets
CREATE TABLE public.technical_references (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_id UUID REFERENCES public.technical_sheets(id) ON DELETE CASCADE NOT NULL,
  reference_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  category TEXT NOT NULL DEFAULT 'custom',
  
  -- Final product dimensions
  final_length NUMERIC NOT NULL DEFAULT 0,
  final_width NUMERIC NOT NULL DEFAULT 0,
  final_height NUMERIC NOT NULL DEFAULT 0,
  dimensions_unit TEXT NOT NULL DEFAULT 'mm',
  tolerance NUMERIC NOT NULL DEFAULT 1,
  
  -- Status & validation
  status TEXT NOT NULL DEFAULT 'draft',
  is_valid BOOLEAN NOT NULL DEFAULT false,
  dimensional_check BOOLEAN NOT NULL DEFAULT false,
  material_availability BOOLEAN NOT NULL DEFAULT false,
  cost_calculated BOOLEAN NOT NULL DEFAULT false,
  estimated_cost NUMERIC DEFAULT 0,
  estimated_production_time NUMERIC DEFAULT 0,
  validation_errors JSONB DEFAULT '[]'::jsonb,
  validation_warnings JSONB DEFAULT '[]'::jsonb,
  last_validated_at TIMESTAMPTZ,
  
  validated_at TIMESTAMPTZ,
  validated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Materials for each technical reference
CREATE TABLE public.technical_reference_materials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  technical_reference_id UUID REFERENCES public.technical_references(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  sequence INTEGER NOT NULL DEFAULT 1,
  
  -- Usage specs
  quantity_needed NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'un',
  cut_length NUMERIC,
  cut_width NUMERIC,
  cut_thickness NUMERIC,
  cut_unit TEXT DEFAULT 'mm',
  notes TEXT,
  is_critical BOOLEAN NOT NULL DEFAULT false,
  
  -- Waste
  waste_factor NUMERIC NOT NULL DEFAULT 5,
  
  -- Alternatives (product IDs)
  alternative_products JSONB DEFAULT '[]'::jsonb,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.technical_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technical_reference_materials ENABLE ROW LEVEL SECURITY;

-- RLS policies: authenticated users can CRUD
DROP POLICY IF EXISTS "Authenticated users can view technical_references" ON public.technical_references;
CREATE POLICY "Authenticated users can view technical_references"
  ON public.technical_references FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can insert technical_references" ON public.technical_references;
CREATE POLICY "Authenticated users can insert technical_references"
  ON public.technical_references FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update technical_references" ON public.technical_references;
CREATE POLICY "Authenticated users can update technical_references"
  ON public.technical_references FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can delete technical_references" ON public.technical_references;
CREATE POLICY "Authenticated users can delete technical_references"
  ON public.technical_references FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view technical_reference_materials" ON public.technical_reference_materials;
CREATE POLICY "Authenticated users can view technical_reference_materials"
  ON public.technical_reference_materials FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can insert technical_reference_materials" ON public.technical_reference_materials;
CREATE POLICY "Authenticated users can insert technical_reference_materials"
  ON public.technical_reference_materials FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update technical_reference_materials" ON public.technical_reference_materials;
CREATE POLICY "Authenticated users can update technical_reference_materials"
  ON public.technical_reference_materials FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can delete technical_reference_materials" ON public.technical_reference_materials;
CREATE POLICY "Authenticated users can delete technical_reference_materials"
  ON public.technical_reference_materials FOR DELETE TO authenticated USING (true);

-- Indexes
CREATE INDEX idx_tech_ref_sheet ON public.technical_references(sheet_id);
CREATE INDEX idx_tech_ref_mat_ref ON public.technical_reference_materials(technical_reference_id);
CREATE INDEX idx_tech_ref_mat_product ON public.technical_reference_materials(product_id);

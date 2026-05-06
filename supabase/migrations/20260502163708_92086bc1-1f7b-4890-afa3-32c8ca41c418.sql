-- Migration 20260507170000: Harden and finalize technical sheet mappings

-- 1. Ensure Palmilha mapping table is perfect
ALTER TABLE public.technical_sheet_palmilha_colors 
ADD COLUMN IF NOT EXISTS palmilha_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS palmilha_group_id UUID REFERENCES public.product_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_palmilha_colors_sheet_id ON public.technical_sheet_palmilha_colors(sheet_id);

-- 2. Ensure Fachete consumption logic columns exist in technical_sheets
ALTER TABLE public.technical_sheets 
ADD COLUMN IF NOT EXISTS fachete_material TEXT,
ADD COLUMN IF NOT EXISTS fachete_consumption NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS fachete_consumption_per_size JSONB DEFAULT '{}'::jsonb;

-- 3. Standardize RLS policies
-- For technical_sheet_palmilha_colors
DROP POLICY IF EXISTS "Public read access for palmilha colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Authenticated users can manage palmilha colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Allow public read of palmilha mappings" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Allow authenticated manage of palmilha mappings" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_insole_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_insole_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can update technical_sheet_insole_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can view technical_sheet_insole_colors" ON public.technical_sheet_palmilha_colors;

ALTER TABLE public.technical_sheet_palmilha_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users on palmilha colors" ON public.technical_sheet_palmilha_colors FOR SELECT USING (true);
CREATE POLICY "Enable all access for authenticated users on palmilha colors" ON public.technical_sheet_palmilha_colors FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- For technical_sheet_lining_colors
DROP POLICY IF EXISTS "Anyone can view lining color mappings" ON public.technical_sheet_lining_colors;
DROP POLICY IF EXISTS "Anyone can insert/update lining color mappings" ON public.technical_sheet_lining_colors;

ALTER TABLE public.technical_sheet_lining_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users on lining colors" ON public.technical_sheet_lining_colors FOR SELECT USING (true);
CREATE POLICY "Enable all access for authenticated users on lining colors" ON public.technical_sheet_lining_colors FOR ALL TO authenticated USING (true) WITH CHECK (true);

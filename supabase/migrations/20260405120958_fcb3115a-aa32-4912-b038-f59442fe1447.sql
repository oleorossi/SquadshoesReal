
CREATE TABLE public.sheet_catalog_models (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_id UUID NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  strap_assignments JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.sheet_catalog_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage catalog models" ON public.sheet_catalog_models;
CREATE POLICY "Authenticated users can manage catalog models"
  ON public.sheet_catalog_models
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

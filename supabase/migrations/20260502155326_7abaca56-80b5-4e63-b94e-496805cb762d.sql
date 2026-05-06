ALTER TABLE public.technical_sheets 
ADD COLUMN IF NOT EXISTS fachete_material TEXT,
ADD COLUMN IF NOT EXISTS fachete_consumption_per_size JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS fachete_consumption NUMERIC DEFAULT 0;
ALTER TABLE public.component_sheets
ADD COLUMN IF NOT EXISTS yield_per_sole JSONB DEFAULT '{}'::jsonb;
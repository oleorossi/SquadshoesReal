ALTER TABLE public.technical_sheets 
ADD COLUMN IF NOT EXISTS lining_consumption_per_size JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS insole_consumption_per_size JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.technical_sheets.lining_consumption_per_size IS 'Lining consumption per shoe size in dm2/pair';
COMMENT ON COLUMN public.technical_sheets.insole_consumption_per_size IS 'Insole consumption per shoe size in dm2/pair';
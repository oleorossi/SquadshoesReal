ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS silk_capacity_per_day    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gluing_capacity_per_day  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS soling_capacity_per_day  integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.technical_sheets.silk_capacity_per_day   IS 'Pares/dia no setor Silk (serigrafia). 0 = não configurado.';
COMMENT ON COLUMN public.technical_sheets.gluing_capacity_per_day IS 'Pares/dia no setor Colagem. 0 = não configurado.';
COMMENT ON COLUMN public.technical_sheets.soling_capacity_per_day IS 'Pares/dia no setor Solagem. 0 = não configurado.';
ALTER TABLE public.default_lead_times
  ADD COLUMN IF NOT EXISTS mesa_daily_capacity      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS silk_capacity_per_day    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gluing_capacity_per_day  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS soling_capacity_per_day  integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.default_lead_times.mesa_daily_capacity      IS 'Pares/dia no setor Mesa.';
COMMENT ON COLUMN public.default_lead_times.silk_capacity_per_day    IS 'Pares/dia no setor Silk.';
COMMENT ON COLUMN public.default_lead_times.gluing_capacity_per_day  IS 'Pares/dia no setor Colagem.';
COMMENT ON COLUMN public.default_lead_times.soling_capacity_per_day  IS 'Pares/dia no setor Solagem.';
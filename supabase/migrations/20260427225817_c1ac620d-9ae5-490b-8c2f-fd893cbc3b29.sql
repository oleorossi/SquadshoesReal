ALTER TABLE public.artisanal_recipes
  ADD COLUMN IF NOT EXISTS base_time_minutes integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.artisanal_recipes.base_time_minutes IS
  'Tempo base estimado em minutos por metro de produto artesanal produzido (soma de separação, cola, enfeite e demais etapas manuais).';
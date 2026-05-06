
ALTER TABLE public.default_lead_times
  ADD COLUMN IF NOT EXISTS silk_capacity_per_day    integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gluing_capacity_per_day  integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS soling_capacity_per_day  integer DEFAULT NULL;

COMMENT ON TABLE public.default_lead_times IS
'Capacidades e lead times padrão por categoria de calçado. Fallback de computeSectorLeadTimeDays(). Prioridade: ficha > default_lead_times > constante hard-coded.';

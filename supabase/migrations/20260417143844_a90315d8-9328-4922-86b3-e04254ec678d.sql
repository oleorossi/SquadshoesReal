ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS lead_time_corte_dias INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS lead_time_costura_dias INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS lead_time_montagem_dias INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS lead_time_acabamento_dias INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lead_time_buffer_material_dias INT NOT NULL DEFAULT 2;

COMMENT ON COLUMN public.technical_sheets.lead_time_corte_dias IS 'Dias para o setor de Corte';
COMMENT ON COLUMN public.technical_sheets.lead_time_costura_dias IS 'Dias para Costura';
COMMENT ON COLUMN public.technical_sheets.lead_time_montagem_dias IS 'Dias para Montagem';
COMMENT ON COLUMN public.technical_sheets.lead_time_acabamento_dias IS 'Dias para Acabamento (inclui embalagem)';
COMMENT ON COLUMN public.technical_sheets.lead_time_buffer_material_dias IS 'Margem entre chegada do material e início do Corte';
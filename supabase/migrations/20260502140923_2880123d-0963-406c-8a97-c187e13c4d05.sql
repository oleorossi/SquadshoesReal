-- Adicionar colunas de lead time para technical_sheets
ALTER TABLE public.technical_sheets 
ADD COLUMN IF NOT EXISTS lead_time_silk_dias INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS lead_time_colagem_dias INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS lead_time_expedicao_dias INTEGER DEFAULT 2;

-- Adicionar colunas de lead time para default_lead_times
ALTER TABLE public.default_lead_times 
ADD COLUMN IF NOT EXISTS lead_time_silk_dias INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS lead_time_colagem_dias INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS lead_time_expedicao_dias INTEGER DEFAULT 2;

-- Comentários para documentação
COMMENT ON COLUMN public.technical_sheets.lead_time_silk_dias IS 'Lead time para o setor de Silk (dias)';
COMMENT ON COLUMN public.technical_sheets.lead_time_colagem_dias IS 'Lead time para o setor de Colagem (dias)';
COMMENT ON COLUMN public.technical_sheets.lead_time_expedicao_dias IS 'Lead time para o setor de Expedição (dias)';

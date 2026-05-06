-- Adiciona coluna para overhead customizado por ficha técnica
ALTER TABLE public.technical_sheets 
ADD COLUMN IF NOT EXISTS custom_overhead NUMERIC DEFAULT NULL;

COMMENT ON COLUMN public.technical_sheets.custom_overhead IS 'Overhead (GGF) específico para este modelo por par. Se nulo, utiliza o padrão global.';
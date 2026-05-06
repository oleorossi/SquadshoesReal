ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS handling_time_minutes integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.technical_sheets.handling_time_minutes IS
  'Tempo de manuseio das tiras em minutos por par: recebimento, conferência, separação e organização do material artesanal antes do setor Mesa. Aplicável somente quando has_straps = true.';
-- Folha por hora trabalhada (refocus do RH, 2026-06-01): colunas pra persistir
-- o breakdown normal x 1,5x. Nada e dropado — colunas antigas (HE/DSR/INSS/VR...)
-- ficam preservadas, so param de ser usadas pela tela.
-- Aplicada via Supabase MCP em 2026-06-01.
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS normal_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS normal_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hourly_rate numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payroll_runs.normal_minutes IS 'Folha por hora: minutos a 1,0x (dia util ate 18h).';
COMMENT ON COLUMN public.payroll_runs.premium_minutes IS 'Folha por hora: minutos a 1,5x (apos 18h / sabado / domingo / feriado).';
COMMENT ON COLUMN public.payroll_runs.normal_value IS 'Folha por hora: R$ das horas normais.';
COMMENT ON COLUMN public.payroll_runs.premium_value IS 'Folha por hora: R$ das horas 1,5x (ja com o multiplicador).';

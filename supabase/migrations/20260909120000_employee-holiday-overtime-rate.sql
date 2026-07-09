-- =============================================================================
-- Valor negociado da hora extra por funcionário — 2º valor (domingo/feriado)
-- =============================================================================
-- A HE da Squad Shoes é negociada funcionário a funcionário. Já existia a coluna
-- `overtime_hourly_rate` (migration 20260427140000) para um valor fixo de HE.
-- O acordo distingue DOIS valores:
--   • overtime_hourly_rate          → HE de DIA ÚTIL (50%)      — já existe
--   • overtime_holiday_hourly_rate  → HE de DOMINGO/FERIADO (100%) — NOVO
-- Em ambos: NULL = usa o cálculo automático sobre o salário (salário/220 ×
-- multiplicador). Preenchido = usa o valor por hora negociado direto.
-- O cálculo em si é 100% client-side (computePeriodFolha em salaryPayroll.ts);
-- esta migration só cria a coluna. Idempotente.
-- =============================================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS overtime_holiday_hourly_rate numeric DEFAULT NULL;

COMMENT ON COLUMN public.employees.overtime_holiday_hourly_rate IS
  'Valor fixo negociado da hora extra em domingo/feriado (100%), R$/h. NULL = usa salário/220 × multiplicador de feriado. Par de overtime_hourly_rate (dia útil, 50%).';

COMMENT ON COLUMN public.employees.overtime_hourly_rate IS
  'Valor fixo negociado da hora extra em DIA ÚTIL (50%), R$/h. NULL = usa salário/220 × 1,5. Par de overtime_holiday_hourly_rate (domingo/feriado, 100%).';

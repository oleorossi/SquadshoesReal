-- RH — Reforma da Gestão de Pessoas (spec: specs/gestao-de-pessoas.md)
-- Fase 1 (aditiva, não-destrutiva): valores de hora extra POR FUNCIONÁRIO.
--
-- Decisão do dono (2026-07-09): funcionários NÃO são CLT; cada hora extra é
-- negociada individualmente e informada como VALOR ABSOLUTO em R$/hora (não um
-- multiplicador, não derivado do salário). São apenas DOIS valores:
--   • he_normal_rate            → HE dia útil / sábado / noturna (mesma taxa)
--   • he_sunday_holiday_rate    → HE domingo / feriado
--
-- Os campos legados de HE (overtime_hourly_rate, overtime_50_pct,
-- overtime_100_pct, night_bonus_pct) ficam parados aqui — são removidos na
-- limpeza final da reforma, depois que o motor novo estiver 100% no ar.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS he_normal_rate numeric,
  ADD COLUMN IF NOT EXISTS he_sunday_holiday_rate numeric;

COMMENT ON COLUMN public.employees.he_normal_rate IS
  'R$/hora extra em dia útil, sábado e noturno (valor absoluto negociado por funcionário — não-CLT). NULL = sem HE cadastrada.';
COMMENT ON COLUMN public.employees.he_sunday_holiday_rate IS
  'R$/hora extra em domingo/feriado (valor absoluto negociado por funcionário — não-CLT). NULL = usa he_normal_rate como fallback.';

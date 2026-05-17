-- Multiplicadores de HE por funcionário — regime de contrato (não-CLT).
--
-- Cada profissional é contratado via contrato próprio. O multiplicador da HE
-- pode variar (alguns pagam hora simples, outros 50%, outros 100%). Antes
-- ficava hardcoded em benefits_config (global) — agora cada employee pode
-- ter seu próprio.
--
-- Defaults em 0 = hora simples (sem adicional). Quem quiser CLT-like seta
-- 50/100/20. Quem trabalha por contrato sem adicional deixa zerado.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS overtime_50_pct  numeric NOT NULL DEFAULT 0
    CHECK (overtime_50_pct  BETWEEN 0 AND 500),
  ADD COLUMN IF NOT EXISTS overtime_100_pct numeric NOT NULL DEFAULT 0
    CHECK (overtime_100_pct BETWEEN 0 AND 500),
  ADD COLUMN IF NOT EXISTS night_bonus_pct  numeric NOT NULL DEFAULT 0
    CHECK (night_bonus_pct  BETWEEN 0 AND 100);

COMMENT ON COLUMN public.employees.overtime_50_pct IS
  '% adicional na HE em dia útil. 0 = hora simples; 50 = adicional CLT mínimo.';
COMMENT ON COLUMN public.employees.overtime_100_pct IS
  '% adicional na HE em domingo/feriado. 0 = hora simples; 100 = adicional CLT mínimo.';
COMMENT ON COLUMN public.employees.night_bonus_pct IS
  '% adicional pelo trabalho em horário noturno (22h-5h). 0 = sem adicional; 20 = CLT.';

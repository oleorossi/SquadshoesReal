-- Adiciona coluna termination_date pros funcionários.
--
-- Usada pelo Timesheet pra cortar o cálculo de horas esperadas no fim
-- (mesmo padrão de admission_date no início). Sem isso, funcionários
-- demitidos no meio do batch ainda recebiam expected fantasma pros dias
-- após a saída.
--
-- Nullable: empregado ativo deixa NULL. Quando preenchida, sistema:
--   - Para de calcular expected após essa data no relatório de ponto
--   - Pode opcionalmente filtrar/marcar empregado em outras telas
--
-- Convenção CLT: data de demissão = último dia trabalhado. Dia seguinte
-- já é "fora do contrato". Por isso o cálculo usa `<= termination_date`.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS termination_date date;

COMMENT ON COLUMN public.employees.termination_date IS
  'Data de demissão (último dia trabalhado). NULL = funcionário ativo. ' ||
  'Usado pelo Timesheet pra parar de calcular horas esperadas após essa data.';

-- Backfill defensivo: garante consistência active vs termination_date.
-- Se funcionário inativo já tem termination_date setada, não mexe.
-- Se inativo SEM termination_date, NÃO seta nada (operador define quando souber).
-- Se ativo COM termination_date no passado, marca como inativo automaticamente.
UPDATE public.employees
   SET active = false
 WHERE active = true
   AND termination_date IS NOT NULL
   AND termination_date < CURRENT_DATE;

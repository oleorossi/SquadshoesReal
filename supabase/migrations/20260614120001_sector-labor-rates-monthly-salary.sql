-- ════════════════════════════════════════════════════════════════════════
-- sector_labor_rates — base passa a ser o SALÁRIO DO SETOR (não o valor-hora cru)
--
-- Correção pedida pelo dono: o custo de mão de obra por referência deve sair do
-- SALÁRIO do setor, derivando o custo-hora = salário ÷ 220 (mesma base que a
-- folha deste sistema usa pro valor-hora — SALARY_HOUR_DIVISOR em
-- src/lib/salaryPayroll.ts). SEM ENCARGOS.
--
--   custo_hora_setor   = monthly_salary / 220
--   custo_mo_referência = Σ (custo_hora_setor × tempo_horas)
--
-- hourly_rate continua existindo, mas vira DERIVADO (= monthly_salary / 220) e é
-- persistido junto pra compat com o cálculo e com os snapshots salvos em
-- labor_cost_results. 220 = 44h/semana CLT.
-- ════════════════════════════════════════════════════════════════════════

alter table public.sector_labor_rates
  add column if not exists monthly_salary numeric not null default 0;

comment on column public.sector_labor_rates.monthly_salary is
  'Salário mensal do setor (R$/mês). Base da calculadora de MO: custo-hora = monthly_salary / 220 (sem encargos, mesma base da folha). hourly_rate é derivado e persistido pra compat.';

-- Backfill: onde já existia valor-hora cadastrado à mão, deriva o salário
-- equivalente (× 220) pra não perder o que estava configurado.
update public.sector_labor_rates
   set monthly_salary = round(hourly_rate * 220, 2)
 where coalesce(monthly_salary, 0) = 0
   and coalesce(hourly_rate, 0) > 0;

-- Reconciliação HE folha × banco de horas (auditoria 2026-07-04, achado #2).
--
-- PROBLEMA: existem DOIS livros de hora-extra independentes, sem cruzamento:
--   1. FOLHA (salaryPayroll/computePeriodFolha): AUTO-paga o excedente diário
--      (worked − expected) × valor-hora × 1,5 — gravado em
--      payroll_runs.overtime_amount / overtime_50_minutes.
--   2. BANCO DE HORAS (calculate_employee_bank_balance): a MESMA hora, derivada
--      das MESMAS batidas, vira crédito compensável/pagável (bank_hours_balance
--      .timesheet_min). O pay_bank_hours paga por horas × rate SEM 1,5×.
-- Nada liga os dois: a mesma hora pode ser PAGA na folha (1,5×) E continuar como
-- crédito no banco pra ser paga/compensada de novo. A única trava é o lock por
-- período no pay_bank_hours ("folha já aprovada").
--
-- ESTA MIGRATION NÃO MUDA NENHUM VALOR PAGO. Só cria uma VIEW de VISIBILIDADE que
-- sinaliza os funcionários com HE paga na folha E saldo de banco ainda positivo —
-- pro RH revisar antes de pagar/compensar duas vezes. A decisão de POLÍTICA (a HE
-- é da folha OU do banco? qual multiplicador?) continua ABERTA e é do dono —
-- mexer nela altera saldo histórico/legal e não pode ser feito no escuro.
create or replace view public.v_overtime_reconciliation as
select
  e.id                                  as employee_id,
  e.name                                as employee_name,
  coalesce(f.folha_he_minutes, 0)       as folha_he_minutes,   -- HE paga na folha (min)
  coalesce(f.folha_he_value, 0)         as folha_he_value,     -- HE paga na folha (R$)
  coalesce(f.finalized_runs, 0)         as finalized_runs_with_he,
  coalesce(b.balance_min, 0)            as bank_balance_min,    -- saldo total do banco (min)
  coalesce(b.timesheet_min, 0)          as bank_timesheet_min,  -- HE do banco vinda das MESMAS batidas
  -- Overlap: HE já paga na folha E banco ainda com crédito (mesma origem) = revisar.
  (coalesce(f.folha_he_minutes, 0) > 0 and coalesce(b.balance_min, 0) > 0) as double_pay_risk
from public.employees e
left join (
  select employee_id,
         sum(coalesce(overtime_50_minutes, 0)) as folha_he_minutes,
         sum(coalesce(overtime_amount, 0))     as folha_he_value,
         count(*) filter (where coalesce(overtime_amount, 0) > 0) as finalized_runs
  from public.payroll_runs
  where status in ('aprovado', 'pago')
  group by employee_id
) f on f.employee_id = e.id
left join public.bank_hours_balance b on b.employee_id = e.id
where e.active = true;

grant select on public.v_overtime_reconciliation to authenticated;

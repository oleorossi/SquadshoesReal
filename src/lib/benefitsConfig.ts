/**
 * Shape da tabela `benefits_config` (singleton de configuração de benefícios/HE).
 *
 * Extraído de `payrollCalc.ts` em 2026-07-04, quando aquele motor CLT (INSS/IRRF/
 * DSR/VR — código morto, não chamado por nenhuma tela) foi removido. O único
 * símbolo que o resto do app consumia era este tipo (via `useRH`), então ele
 * mora aqui agora. NÃO reintroduzir o motor: a folha viva é `salaryPayroll.ts`
 * (salário − descontos + HE por-dia).
 */
export interface BenefitsConfig {
  vt_daily_value: number;
  vt_employee_discount_pct: number;
  vr_daily_value: number;
  va_monthly_value: number;
  health_plan_default: number;
  monthly_hours: number;
  overtime_50_pct: number;
  overtime_100_pct: number;
  night_bonus_pct: number;
  night_shift_start_min: number;
  night_shift_end_min: number;
}

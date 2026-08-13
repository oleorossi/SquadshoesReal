import {
  PAYROLL_RULE_VERSION,
  type SalaryPayrollResult,
} from '@/lib/salaryPayroll';

export interface PayrollSnapshotEmployee {
  id: string;
  name: string;
  external_id?: string | null;
  role?: string | null;
  department?: string | null;
  payment_type: SalaryPayrollResult['payment_type'];
  salary: number;
  he_normal_rate: number;
  he_sunday_holiday_rate: number;
}

export interface PayrollCalculationSnapshot {
  schema_version: 1;
  rule_version: string;
  calculated_at: string;
  period: { from: string; to: string };
  employee: PayrollSnapshotEmployee;
  schedule: Record<string, unknown> | null;
  result: SalaryPayrollResult;
}

export function buildPayrollSnapshot(params: {
  from: string;
  to: string;
  employee: PayrollSnapshotEmployee;
  schedule: Record<string, unknown> | null;
  result: SalaryPayrollResult;
}): PayrollCalculationSnapshot {
  return {
    schema_version: 1,
    rule_version: params.result.rule_version || PAYROLL_RULE_VERSION,
    calculated_at: new Date().toISOString(),
    period: { from: params.from, to: params.to },
    employee: params.employee,
    schedule: params.schedule,
    result: params.result,
  };
}

/** Leitura defensiva: folhas antigas não possuem snapshot e seguem no fallback. */
export function readPayrollSnapshot(value: unknown): PayrollCalculationSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Partial<PayrollCalculationSnapshot>;
  if (snapshot.schema_version !== 1 || !snapshot.result || !snapshot.employee || !snapshot.period) return null;
  if (!snapshot.rule_version || snapshot.result.rule_version !== snapshot.rule_version) return null;
  return snapshot as PayrollCalculationSnapshot;
}

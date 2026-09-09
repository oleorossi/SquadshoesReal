export const OPEN_EMPLOYEE_ADVANCE_STATUSES = ['pending', 'paid'] as const;

export type EmployeeAdvanceStatus =
  | typeof OPEN_EMPLOYEE_ADVANCE_STATUSES[number]
  | 'deducted'
  | 'baixado_externo'
  | 'cancelado';

export type EmployeeAdvanceStatusFilter = 'all' | 'open' | EmployeeAdvanceStatus;

export function createEmployeeAdvanceIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const value = Math.floor(Math.random() * 16);
    return (token === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export function isOpenEmployeeAdvance(status: string): boolean {
  return (OPEN_EMPLOYEE_ADVANCE_STATUSES as readonly string[]).includes(status);
}

export function matchesEmployeeAdvanceStatusFilter(
  status: string,
  filter: EmployeeAdvanceStatusFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'open') return isOpenEmployeeAdvance(status);
  return status === filter;
}

export function employeeAdvanceStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pendente · a descontar';
    case 'paid':
      return 'Entregue · a descontar';
    case 'deducted':
      return 'Descontado em folha';
    case 'baixado_externo':
      return 'Baixado fora da folha';
    case 'cancelado':
      return 'Cancelado';
    default:
      return status;
  }
}

export function isPayrollOwnedEmployeeAdvance(advance: {
  status: string;
  payroll_run_id?: string | null;
}): boolean {
  return advance.status === 'deducted' || Boolean(advance.payroll_run_id);
}

export function canManageOpenEmployeeAdvance(advance: {
  status: string;
  payroll_run_id?: string | null;
}): boolean {
  return isOpenEmployeeAdvance(advance.status) && !isPayrollOwnedEmployeeAdvance(advance);
}

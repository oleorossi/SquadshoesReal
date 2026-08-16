import type { Employee } from '@/hooks/useEmployees';

export type PayrollClosingCadence = 'quinzena' | 'mes';
export type PayrollHalf = 'primeira' | 'segunda';

export interface PayrollClosingSelection {
  cadence: PayrollClosingCadence;
  half: PayrollHalf;
  month: string;
  from: string;
  to: string;
}

export interface PayrollDateRange {
  from: string;
  to: string;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export function payrollMonthBounds(month: string): PayrollDateRange {
  if (!MONTH_RE.test(month)) return { from: '', to: '' };
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || monthNumber < 1 || monthNumber > 12) return { from: '', to: '' };
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function payrollClosingRange(
  month: string,
  cadence: PayrollClosingCadence,
  half: PayrollHalf = 'primeira',
): PayrollDateRange {
  const bounds = payrollMonthBounds(month);
  if (!bounds.from) return bounds;
  if (cadence === 'mes') return bounds;
  return half === 'primeira'
    ? { from: bounds.from, to: `${month}-15` }
    : { from: `${month}-16`, to: bounds.to };
}

/**
 * Reconhece somente os dois formatos aceitos pela folha salarial: mês completo
 * ou uma das duas quinzenas civis do mesmo mês. Intervalos livres são rejeitados
 * também no domínio, não apenas escondidos na interface.
 */
export function identifyPayrollClosing(range: PayrollDateRange): PayrollClosingSelection | null {
  if (!range.from || !range.to || range.from.slice(0, 7) !== range.to.slice(0, 7)) return null;
  const month = range.from.slice(0, 7);
  const bounds = payrollMonthBounds(month);
  if (!bounds.from) return null;
  if (range.from === bounds.from && range.to === bounds.to) {
    return { cadence: 'mes', half: 'primeira', month, ...range };
  }
  if (range.from === bounds.from && range.to === `${month}-15`) {
    return { cadence: 'quinzena', half: 'primeira', month, ...range };
  }
  if (range.from === `${month}-16` && range.to === bounds.to) {
    return { cadence: 'quinzena', half: 'segunda', month, ...range };
  }
  return null;
}

export function storedPayrollPeriodRange(period: string): PayrollDateRange | null {
  if (MONTH_RE.test(period)) {
    const bounds = payrollMonthBounds(period);
    return bounds.from ? bounds : null;
  }
  const match = period.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (!match || match[1] > match[2]) return null;
  return { from: match[1], to: match[2] };
}

export function payrollRangesOverlap(a: PayrollDateRange, b: PayrollDateRange): boolean {
  return a.from <= b.to && b.from <= a.to;
}

export function employeeUsesSalaryClosing(
  employee: Pick<Employee, 'payment_type'>,
): boolean {
  return String(employee.payment_type || 'mensalista').toLowerCase() !== 'producao';
}

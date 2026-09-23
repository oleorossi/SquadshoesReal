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

/**
 * Fecha o import pela faixa REAL de batidas quando ela cabe numa quinzena civil.
 * Evita o caso em que o parser/relógio declara o mês (ou a tela está no mês) e o
 * fim é truncado pra “hoje” no meio do mês — aí a prévia virava 01–23 com batidas
 * só até o dia 15 e acusava arquivo incompleto ao importar a 1ª quinzena.
 */
export function inferPayrollClosingFromPunchSpan(
  firstPunch: string,
  lastPunch: string,
): PayrollClosingSelection | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstPunch) || !/^\d{4}-\d{2}-\d{2}$/.test(lastPunch)) {
    return null;
  }
  if (firstPunch > lastPunch) return null;
  const exact = identifyPayrollClosing({ from: firstPunch, to: lastPunch });
  if (exact) return exact;
  if (firstPunch.slice(0, 7) !== lastPunch.slice(0, 7)) return null;
  const month = firstPunch.slice(0, 7);
  const q1 = payrollClosingRange(month, 'quinzena', 'primeira');
  const q2 = payrollClosingRange(month, 'quinzena', 'segunda');
  if (q1.from && firstPunch >= q1.from && lastPunch <= q1.to) {
    return identifyPayrollClosing(q1);
  }
  if (q2.from && firstPunch >= q2.from && lastPunch <= q2.to) {
    return identifyPayrollClosing(q2);
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

/**
 * HE e horas a descontar liquidam no fechamento escolhido (quinzena ou mês).
 * Relatórios de ponto/HE usam o mês civil (dia 1 → último) via `heBalanceRange`.
 */
export function heBalanceRange(closing: Pick<PayrollClosingSelection, 'month'> | string): PayrollDateRange {
  const month = typeof closing === 'string' ? closing : closing.month;
  return payrollMonthBounds(month);
}

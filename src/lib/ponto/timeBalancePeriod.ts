/**
 * Período do espelho de ponto: helpers de intervalo + agregação mês a mês.
 *
 * Fechamento pagável (HE × atraso) continua por mês civil. Intervalo longo só
 * soma os fechamentos — nunca um único computePeriodFolha atravessando meses.
 */
import {
  computeComparativoRows,
  type ComparativoArgs,
} from '@/lib/payrollComparativo';
import type { TimeBalanceEmployeeInput } from '@/lib/ponto/timeBalanceReports';

export const TIME_BALANCE_MAX_MONTHS = 6;

export interface DateRange {
  from: string;
  to: string;
}

export interface CivilMonthSlice {
  period: string;
  from: string;
  to: string;
}

export interface MonthHeBreakdown {
  period: string;
  from: string;
  to: string;
  payableOvertimeMinutes: number;
  payableDebitMinutes: number;
  overtimeValue: number;
}

export interface EmployeeMonthHeBreakdown extends MonthHeBreakdown {
  employeeId: string;
}

export interface TimeBalancePeriodBuildResult {
  inputs: TimeBalanceEmployeeInput[];
  /** Preenchido só quando o intervalo é feito de meses civis completos. */
  monthBreakdown: MonthHeBreakdown[] | null;
  isCompleteCivilMonths: boolean;
}

function parseIsoParts(iso: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

export function monthBoundsFromPeriod(period: string): DateRange {
  const [year, monthNumber] = period.split('-').map(Number);
  if (!year || !monthNumber) return { from: '', to: '' };
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    from: `${period}-01`,
    to: `${period}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Meses civis de `from` a `to` (inclusive), pela âncora YYYY-MM de cada ponta. */
export function listCivilMonthsInRange(from: string, to: string): CivilMonthSlice[] {
  const start = parseIsoParts(from);
  const end = parseIsoParts(to);
  if (!start || !end || from > to) return [];
  const out: CivilMonthSlice[] = [];
  let y = start.y;
  let m = start.m;
  while (y < end.y || (y === end.y && m <= end.m)) {
    const period = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ period, ...monthBoundsFromPeriod(period) });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function isCompleteCivilMonths(from: string, to: string): boolean {
  const months = listCivilMonthsInRange(from, to);
  if (months.length === 0) return false;
  return months[0].from === from && months[months.length - 1].to === to;
}

/** Contagem inclusiva de meses civis tocados pelo intervalo. */
export function civilMonthSpan(from: string, to: string): number {
  return listCivilMonthsInRange(from, to).length;
}

export function maxMonthsOk(from: string, to: string, max = TIME_BALANCE_MAX_MONTHS): boolean {
  if (!from || !to || from > to) return false;
  return civilMonthSpan(from, to) <= max;
}

/** Soma meses em uma data ISO, preservando o dia quando o mês destino tem esse dia. */
export function addMonthsToIsoDate(iso: string, amount: number): string {
  const parts = parseIsoParts(iso);
  if (!parts) return iso;
  const probe = new Date(parts.y, parts.m - 1 + amount, 1);
  const lastDay = new Date(probe.getFullYear(), probe.getMonth() + 1, 0).getDate();
  const day = Math.min(parts.d, lastDay);
  const y = probe.getFullYear();
  const m = String(probe.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-${String(day).padStart(2, '0')}`;
}

/** Desloca as duas pontas do intervalo em N meses (preserva a duração civil). */
export function shiftDateRangeByMonths(range: DateRange, amount: number): DateRange {
  if (!range.from || !range.to) return range;
  return {
    from: addMonthsToIsoDate(range.from, amount),
    to: addMonthsToIsoDate(range.to, amount),
  };
}

function emptyAgg(row: {
  id: string;
  name: string;
  department?: string | null;
  paymentType?: string | null;
  active?: boolean;
}): TimeBalanceEmployeeInput & { monthBreakdown: MonthHeBreakdown[] } {
  return {
    id: row.id,
    name: row.name,
    department: row.department,
    paymentType: row.paymentType,
    active: row.active,
    ledger: [],
    rawCreditMinutes: 0,
    rawDebitMinutes: 0,
    compensatedMinutes: 0,
    payableOvertimeMinutes: 0,
    payableDebitMinutes: 0,
    overtimeValue: 0,
    overtimeRateMissing: false,
    monthBreakdown: [],
  };
}

type BuildArgs = Omit<ComparativoArgs, 'range' | 'period'> & {
  range: DateRange;
  employeeMeta: Map<string, {
    department?: string | null;
    paymentType?: string | null;
    active?: boolean;
  }>;
};

function rowsToInputs(
  calculated: ReturnType<typeof computeComparativoRows>,
  employeeMeta: BuildArgs['employeeMeta'],
): TimeBalanceEmployeeInput[] {
  return calculated.rows.map(row => {
    const meta = employeeMeta.get(row.id);
    return {
      id: row.id,
      name: row.name,
      department: meta?.department,
      paymentType: meta?.paymentType,
      active: meta?.active !== false,
      ledger: row.result.day_ledger,
      rawCreditMinutes: row.result.raw_credit_minutes,
      rawDebitMinutes: row.result.raw_delay_minutes,
      compensatedMinutes: row.result.compensated_minutes,
      payableOvertimeMinutes: row.result.he_minutes,
      payableDebitMinutes: row.result.atraso_minutes,
      overtimeValue: row.result.he_value,
      overtimeRateMissing: row.result.he_rate_missing,
    };
  });
}

/**
 * Monta inputs do espelho para o intervalo.
 * Meses civis completos → um computeComparativoRows por mês e soma.
 * Recorte parcial → uma chamada no slice, sem breakdown mensal.
 */
export function buildTimeBalanceReportInputsForRange(args: BuildArgs): TimeBalancePeriodBuildResult {
  const { range, employeeMeta, ...shared } = args;
  if (!range.from || !range.to || range.from > range.to) {
    return { inputs: [], monthBreakdown: null, isCompleteCivilMonths: false };
  }

  const complete = isCompleteCivilMonths(range.from, range.to);

  if (!complete) {
    const calculated = computeComparativoRows({
      ...shared,
      range,
      period: range.from.slice(0, 7),
    });
    return {
      inputs: rowsToInputs(calculated, employeeMeta),
      monthBreakdown: null,
      isCompleteCivilMonths: false,
    };
  }

  const months = listCivilMonthsInRange(range.from, range.to);
  const byEmployee = new Map<string, TimeBalanceEmployeeInput & { monthBreakdown: MonthHeBreakdown[] }>();
  const totalsByMonth: MonthHeBreakdown[] = [];

  for (const month of months) {
    const calculated = computeComparativoRows({
      ...shared,
      range: { from: month.from, to: month.to },
      period: month.period,
    });
    const monthTotal: MonthHeBreakdown = {
      period: month.period,
      from: month.from,
      to: month.to,
      payableOvertimeMinutes: 0,
      payableDebitMinutes: 0,
      overtimeValue: 0,
    };

    for (const row of calculated.rows) {
      const meta = employeeMeta.get(row.id);
      let agg = byEmployee.get(row.id);
      if (!agg) {
        agg = emptyAgg({
          id: row.id,
          name: row.name,
          department: meta?.department,
          paymentType: meta?.paymentType,
          active: meta?.active !== false,
        });
        byEmployee.set(row.id, agg);
      }

      const he = Number(row.result.he_minutes) || 0;
      const atraso = Number(row.result.atraso_minutes) || 0;
      const heValue = Number(row.result.he_value) || 0;

      agg.ledger = [...(agg.ledger || []), ...(row.result.day_ledger || [])];
      agg.rawCreditMinutes = (Number(agg.rawCreditMinutes) || 0) + (Number(row.result.raw_credit_minutes) || 0);
      agg.rawDebitMinutes = (Number(agg.rawDebitMinutes) || 0) + (Number(row.result.raw_delay_minutes) || 0);
      agg.compensatedMinutes = (Number(agg.compensatedMinutes) || 0) + (Number(row.result.compensated_minutes) || 0);
      agg.payableOvertimeMinutes = (Number(agg.payableOvertimeMinutes) || 0) + he;
      agg.payableDebitMinutes = (Number(agg.payableDebitMinutes) || 0) + atraso;
      agg.overtimeValue = (Number(agg.overtimeValue) || 0) + heValue;
      agg.overtimeRateMissing = agg.overtimeRateMissing === true || row.result.he_rate_missing === true;
      agg.monthBreakdown.push({
        period: month.period,
        from: month.from,
        to: month.to,
        payableOvertimeMinutes: he,
        payableDebitMinutes: atraso,
        overtimeValue: heValue,
      });

      monthTotal.payableOvertimeMinutes += he;
      monthTotal.payableDebitMinutes += atraso;
      monthTotal.overtimeValue += heValue;
    }

    totalsByMonth.push(monthTotal);
  }

  return {
    inputs: [...byEmployee.values()],
    monthBreakdown: totalsByMonth,
    isCompleteCivilMonths: true,
  };
}

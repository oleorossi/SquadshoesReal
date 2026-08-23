import type { SalaryDayLedger, SalaryDayLedgerStatus } from '@/lib/salaryPayroll';
import { getISOWeekKey, getWeekMonday, getWeekSunday } from '@/lib/weeklyTimeCalculation';

export type TimeBalanceReportKind = 'overtime' | 'deficit';

export interface TimeBalanceEmployeeInput {
  id: string;
  name: string;
  department?: string | null;
  paymentType?: string | null;
  ledger?: SalaryDayLedger[] | null;
  rawCreditMinutes?: number | null;
  rawDebitMinutes?: number | null;
  compensatedMinutes?: number | null;
  payableOvertimeMinutes?: number | null;
  payableDebitMinutes?: number | null;
  overtimeValue?: number | null;
  overtimeRateMissing?: boolean | null;
}

export interface TimeBalanceDay {
  date: string;
  dayOfWeek: number;
  punches: string[];
  expectedMinutes: number;
  workedMinutes: number;
  balanceMinutes: number;
  status: SalaryDayLedgerStatus;
  isHoliday: boolean;
}

export interface TimeBalanceWeek {
  key: string;
  startDate: string;
  endDate: string;
  expectedMinutes: number;
  workedMinutes: number;
  balanceMinutes: number;
  overtimeMinutes: number;
  deficitMinutes: number;
  hasPendingPunches: boolean;
  days: TimeBalanceDay[];
}

export interface EmployeeTimeBalanceReport {
  id: string;
  name: string;
  department: string;
  paymentType: string;
  weeks: TimeBalanceWeek[];
  totalExpectedMinutes: number;
  totalWorkedMinutes: number;
  totalOvertimeMinutes: number;
  totalDeficitMinutes: number;
  overtimeWeeks: number;
  deficitWeeks: number;
  pendingPunchDays: number;
  totalRawCreditMinutes: number;
  totalRawDebitMinutes: number;
  totalCompensatedMinutes: number;
  totalPayableOvertimeMinutes: number;
  totalPayableDebitMinutes: number;
  finalPayableBalanceMinutes: number;
  overtimeValue: number;
  overtimeRateMissing: boolean;
}

function effectiveExpectedMinutes(day: SalaryDayLedger): number {
  // Dia abonado ou sem cobertura não reduz a meta semanal. A folha já os marca
  // no ledger; o relatório apenas respeita essa decisão, sem recalcular batidas.
  if (day.status === 'neutral' || day.status === 'excused') return 0;
  return Math.max(0, Number(day.expected_minutes) || 0);
}

function effectiveWorkedMinutes(day: TimeBalanceDay): number {
  // Abono neutraliza o dia inteiro no fechamento semanal. Se houve uma batida
  // parcial no mesmo dia, ela continua visível no calendário, mas não vira HE
  // artificial só porque a meta foi abonada.
  if (day.status === 'neutral' || day.status === 'excused') return 0;
  return day.workedMinutes;
}

function toReportDay(day: SalaryDayLedger): TimeBalanceDay {
  const expectedMinutes = effectiveExpectedMinutes(day);
  const workedMinutes = Math.max(0, Number(day.worked_minutes) || 0);
  const ignoredInWeeklyBalance = day.status === 'neutral' || day.status === 'excused';
  return {
    date: day.date,
    dayOfWeek: day.day_of_week,
    punches: Array.isArray(day.punches) ? day.punches : [],
    expectedMinutes,
    workedMinutes,
    balanceMinutes: ignoredInWeeklyBalance ? 0 : workedMinutes - expectedMinutes,
    status: day.status,
    isHoliday: !!day.is_holiday,
  };
}

/**
 * Deriva os dois relatórios do extrato diário CANÔNICO da folha.
 *
 * A unidade de fechamento é a semana ISO (segunda a domingo): horas positivas
 * e negativas se compensam somente dentro da mesma semana. Assim, o relatório
 * de pendências inclui exclusivamente quem não cumpriu a meta semanal; uma
 * semana superavitária não apaga o débito de outra.
 */
export function buildEmployeeTimeBalanceReport(input: TimeBalanceEmployeeInput): EmployeeTimeBalanceReport {
  const weekMap = new Map<string, TimeBalanceDay[]>();
  const sortedLedger = [...(input.ledger || [])].sort((a, b) => a.date.localeCompare(b.date));

  for (const ledgerDay of sortedLedger) {
    const day = toReportDay(ledgerDay);
    const key = getISOWeekKey(day.date);
    const list = weekMap.get(key) || [];
    list.push(day);
    weekMap.set(key, list);
  }

  const weeks = [...weekMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, days]) => {
    const expectedMinutes = days.reduce((sum, day) => sum + day.expectedMinutes, 0);
    const workedMinutes = days.reduce((sum, day) => sum + effectiveWorkedMinutes(day), 0);
    const balanceMinutes = workedMinutes - expectedMinutes;
    return {
      key,
      startDate: getWeekMonday(days[0].date),
      endDate: getWeekSunday(days[days.length - 1].date),
      expectedMinutes,
      workedMinutes,
      balanceMinutes,
      overtimeMinutes: Math.max(0, balanceMinutes),
      deficitMinutes: Math.max(0, -balanceMinutes),
      hasPendingPunches: days.some(day => day.status === 'pending'),
      days,
    } satisfies TimeBalanceWeek;
  });

  const totalRawCreditMinutes = input.rawCreditMinutes
    ?? sortedLedger.reduce((sum, day) => sum + (Number(day.raw_credit_minutes) || 0), 0);
  const totalRawDebitMinutes = input.rawDebitMinutes
    ?? sortedLedger.reduce((sum, day) => sum + (Number(day.raw_delay_minutes) || 0), 0);
  const totalCompensatedMinutes = input.compensatedMinutes
    ?? Math.min(totalRawCreditMinutes, totalRawDebitMinutes);
  const totalPayableOvertimeMinutes = input.payableOvertimeMinutes
    ?? sortedLedger.reduce((sum, day) => sum + (Number(day.payable_overtime_minutes) || 0), 0);
  const totalPayableDebitMinutes = input.payableDebitMinutes
    ?? sortedLedger.reduce((sum, day) => sum + (Number(day.payable_delay_minutes) || 0), 0);

  return {
    id: input.id,
    name: input.name,
    department: input.department?.trim() || 'Sem setor',
    paymentType: input.paymentType || 'mensalista',
    weeks,
    totalExpectedMinutes: weeks.reduce((sum, week) => sum + week.expectedMinutes, 0),
    totalWorkedMinutes: weeks.reduce((sum, week) => sum + week.workedMinutes, 0),
    totalOvertimeMinutes: weeks.reduce((sum, week) => sum + week.overtimeMinutes, 0),
    totalDeficitMinutes: weeks.reduce((sum, week) => sum + week.deficitMinutes, 0),
    overtimeWeeks: weeks.filter(week => week.overtimeMinutes > 0).length,
    deficitWeeks: weeks.filter(week => week.deficitMinutes > 0).length,
    pendingPunchDays: weeks.reduce((sum, week) => sum + week.days.filter(day => day.status === 'pending').length, 0),
    totalRawCreditMinutes,
    totalRawDebitMinutes,
    totalCompensatedMinutes,
    totalPayableOvertimeMinutes,
    totalPayableDebitMinutes,
    finalPayableBalanceMinutes: totalPayableOvertimeMinutes - totalPayableDebitMinutes,
    overtimeValue: Math.max(0, Number(input.overtimeValue) || 0),
    overtimeRateMissing: input.overtimeRateMissing === true,
  };
}

export function buildTimeBalanceReports(inputs: TimeBalanceEmployeeInput[]): EmployeeTimeBalanceReport[] {
  return inputs
    // Remoto, diarista e produção têm regras próprias e não são avaliados por
    // meta semanal de ponto. O ledger desses regimes é neutro por definição.
    .filter(input => (input.paymentType || 'mensalista') === 'mensalista')
    .map(buildEmployeeTimeBalanceReport)
    .filter(report => report.weeks.some(week => week.expectedMinutes > 0 || week.workedMinutes > 0))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function reportsForKind(
  reports: EmployeeTimeBalanceReport[],
  kind: TimeBalanceReportKind,
): EmployeeTimeBalanceReport[] {
  return reports.filter(report => kind === 'overtime'
    ? report.totalOvertimeMinutes > 0
    : report.totalDeficitMinutes > 0);
}

export function formatBalanceMinutes(minutes: number, showPlus = true): string {
  const rounded = Math.round(Number(minutes) || 0);
  const sign = rounded < 0 ? '−' : rounded > 0 && showPlus ? '+' : '';
  const absolute = Math.abs(rounded);
  return `${sign}${Math.floor(absolute / 60)}h${String(absolute % 60).padStart(2, '0')}`;
}

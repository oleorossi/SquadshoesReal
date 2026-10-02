import { describe, expect, it, vi } from 'vitest';
import type { ComparativoResult } from '@/lib/payrollComparativo';
import type { SalaryPayrollResult } from '@/lib/salaryPayroll';

vi.mock('@/lib/payrollComparativo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payrollComparativo')>('@/lib/payrollComparativo');
  return {
    ...actual,
    computeComparativoRows: vi.fn(),
  };
});

import { computeComparativoRows } from '@/lib/payrollComparativo';
import {
  addMonthsToIsoDate,
  buildTimeBalanceReportInputsForRange,
  civilMonthSpan,
  isCompleteCivilMonths,
  listCivilMonthsInRange,
  maxMonthsOk,
  monthBoundsFromPeriod,
  shiftDateRangeByMonths,
} from './timeBalancePeriod';

const mockedCompute = vi.mocked(computeComparativoRows);

function fakeResult(heMinutes: number, heValue: number, from: string, to: string): ComparativoResult {
  const ledgerDates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    ledgerDates.push(cursor);
    const d = new Date(`${cursor}T12:00:00`);
    d.setDate(d.getDate() + 1);
    cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (ledgerDates.length > 40) break;
  }
  const day_ledger = ledgerDates.slice(0, 3).map((date, index) => ({
    date,
    day_of_week: new Date(`${date}T12:00:00`).getDay(),
    punches: ['08:00', '18:00'],
    is_holiday: false,
    is_workday: true,
    expected_minutes: 480,
    worked_minutes: 480 + (index === 0 ? heMinutes : 0),
    raw_balance_minutes: index === 0 ? heMinutes : 0,
    raw_credit_minutes: index === 0 ? Math.max(0, heMinutes) : 0,
    raw_delay_minutes: index === 0 ? Math.max(0, -heMinutes) : 0,
    compensated_credit_minutes: 0,
    compensated_delay_minutes: 0,
    payable_overtime_minutes: index === 0 ? Math.max(0, heMinutes) : 0,
    payable_delay_minutes: index === 0 ? Math.max(0, -heMinutes) : 0,
    discarded_tolerance_minutes: 0,
    status: 'normal' as const,
  }));

  const result = {
    he_minutes: Math.max(0, heMinutes),
    atraso_minutes: Math.max(0, -heMinutes),
    he_value: heValue,
    he_rate_missing: false,
    raw_credit_minutes: Math.max(0, heMinutes),
    raw_delay_minutes: Math.max(0, -heMinutes),
    compensated_minutes: 0,
    day_ledger,
  } as unknown as SalaryPayrollResult;

  return {
    rows: [{
      id: 'emp-1',
      name: 'Marcio',
      result,
      q1: result,
      q2: result,
      matchedDays: 3,
      advMes: 0,
      sit: { txt: 'OK', tone: 'green' },
      printData: {} as ComparativoResult['rows'][0]['printData'],
    }],
    totals: { salarios: 0, mes: 0, q1: 0, q2: 0, advMes: 0 },
    monthDays: 30,
  };
}

describe('timeBalancePeriod — helpers de intervalo', () => {
  it('reconhecimento de meses civis completos', () => {
    expect(isCompleteCivilMonths('2026-01-01', '2026-06-30')).toBe(true);
    expect(isCompleteCivilMonths('2026-05-01', '2026-05-31')).toBe(true);
    expect(isCompleteCivilMonths('2026-02-15', '2026-03-15')).toBe(false);
    expect(isCompleteCivilMonths('2026-01-01', '2026-06-15')).toBe(false);
  });

  it('lista e limita a 6 meses', () => {
    expect(listCivilMonthsInRange('2026-01-01', '2026-06-30')).toHaveLength(6);
    expect(civilMonthSpan('2026-01-01', '2026-07-31')).toBe(7);
    expect(maxMonthsOk('2026-01-01', '2026-06-30')).toBe(true);
    expect(maxMonthsOk('2026-01-01', '2026-07-01')).toBe(false);
  });

  it('desloca o intervalo inteiro em meses', () => {
    expect(addMonthsToIsoDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftDateRangeByMonths({ from: '2026-02-15', to: '2026-03-15' }, 1)).toEqual({
      from: '2026-03-15',
      to: '2026-04-15',
    });
    expect(monthBoundsFromPeriod('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('timeBalancePeriod — agregação mês a mês', () => {
  it('soma HE de dois meses sem um único fechamento cruzado', () => {
    mockedCompute.mockReset();
    mockedCompute
      .mockImplementationOnce(() => fakeResult(60, 50, '2026-01-01', '2026-01-31'))
      .mockImplementationOnce(() => fakeResult(30, 25, '2026-02-01', '2026-02-28'));

    const built = buildTimeBalanceReportInputsForRange({
      employees: [{ id: 'emp-1', name: 'Marcio' }],
      schedules: [],
      defaultSchedule: null,
      holidaysSet: new Set(),
      timeRecords: [],
      advancesList: [],
      range: { from: '2026-01-01', to: '2026-02-28' },
      employeeMeta: new Map([['emp-1', { department: 'Colagem', paymentType: 'mensalista', active: true }]]),
    });

    expect(mockedCompute).toHaveBeenCalledTimes(2);
    expect(mockedCompute.mock.calls[0][0].range).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(mockedCompute.mock.calls[1][0].range).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(built.isCompleteCivilMonths).toBe(true);
    expect(built.monthBreakdown).toHaveLength(2);
    expect(built.inputs).toHaveLength(1);
    expect(built.inputs[0].payableOvertimeMinutes).toBe(90);
    expect(built.inputs[0].overtimeValue).toBe(75);
    expect(built.inputs[0].monthBreakdown?.map(m => m.overtimeValue)).toEqual([50, 25]);
  });

  it('recorte parcial faz uma única chamada e não gera breakdown', () => {
    mockedCompute.mockReset();
    mockedCompute.mockImplementationOnce(() => fakeResult(20, 10, '2026-02-15', '2026-03-15'));

    const built = buildTimeBalanceReportInputsForRange({
      employees: [{ id: 'emp-1', name: 'Marcio' }],
      schedules: [],
      defaultSchedule: null,
      holidaysSet: new Set(),
      timeRecords: [],
      advancesList: [],
      range: { from: '2026-02-15', to: '2026-03-15' },
      employeeMeta: new Map([['emp-1', { paymentType: 'mensalista', active: true }]]),
    });

    expect(mockedCompute).toHaveBeenCalledTimes(1);
    expect(mockedCompute.mock.calls[0][0].range).toEqual({ from: '2026-02-15', to: '2026-03-15' });
    expect(built.isCompleteCivilMonths).toBe(false);
    expect(built.monthBreakdown).toBeNull();
    expect(built.inputs[0].payableOvertimeMinutes).toBe(20);
  });
});

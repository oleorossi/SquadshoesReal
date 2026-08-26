import { describe, expect, it } from 'vitest';
import type { SalaryDayLedger, SalaryDayLedgerStatus } from '@/lib/salaryPayroll';
import {
  buildEmployeeTimeBalanceReport,
  buildTimeBalanceReports,
  formatBalanceMinutes,
  reportsForKind,
} from './timeBalanceReports';

function ledgerDay(
  date: string,
  expected: number,
  worked: number,
  status: SalaryDayLedgerStatus = worked > expected ? 'credit' : worked < expected ? 'debit' : 'normal',
): SalaryDayLedger {
  const dow = new Date(`${date}T12:00:00`).getDay();
  return {
    date,
    day_of_week: dow,
    punches: worked > 0 ? ['08:00', '18:00'] : [],
    is_holiday: false,
    is_workday: expected > 0,
    expected_minutes: expected,
    worked_minutes: worked,
    raw_balance_minutes: worked - expected,
    raw_credit_minutes: Math.max(0, worked - expected),
    raw_delay_minutes: Math.max(0, expected - worked),
    compensated_credit_minutes: 0,
    compensated_delay_minutes: 0,
    payable_overtime_minutes: Math.max(0, worked - expected),
    payable_delay_minutes: Math.max(0, expected - worked),
    discarded_tolerance_minutes: 0,
    status,
  };
}

describe('timeBalanceReports — fechamento semanal', () => {
  it('reduz a meta somente pelos minutos de abono parcial aplicados no ledger', () => {
    const partial = {
      ...ledgerDay('2026-06-01', 540, 0, 'debit'),
      excused_minutes: 240,
      raw_balance_minutes: -300,
      raw_delay_minutes: 300,
      payable_delay_minutes: 300,
    };
    const report = buildEmployeeTimeBalanceReport({
      id: 'ana',
      name: 'Ana',
      ledger: [partial],
    });

    expect(report.totalExpectedMinutes).toBe(300);
    expect(report.totalDeficitMinutes).toBe(300);
  });

  it('compensa +40min e −1h dentro da semana e gera débito de 20min', () => {
    const report = buildEmployeeTimeBalanceReport({
      id: 'ana',
      name: 'Ana',
      ledger: [
        ledgerDay('2026-06-01', 480, 520),
        ledgerDay('2026-06-02', 480, 420),
        ledgerDay('2026-06-03', 480, 480),
        ledgerDay('2026-06-04', 480, 480),
        ledgerDay('2026-06-05', 480, 480),
      ],
    });

    expect(report.weeks).toHaveLength(1);
    expect(report.weeks[0].balanceMinutes).toBe(-20);
    expect(report.totalDeficitMinutes).toBe(20);
    expect(report.totalOvertimeMinutes).toBe(0);
  });

  it('não compensa o débito de uma semana com a hora extra de outra', () => {
    const report = buildEmployeeTimeBalanceReport({
      id: 'bia',
      name: 'Bia',
      ledger: [
        ledgerDay('2026-06-01', 480, 420), // semana 23: −1h
        ledgerDay('2026-06-08', 480, 570), // semana 24: +1h30
      ],
    });

    expect(report.totalDeficitMinutes).toBe(60);
    expect(report.totalOvertimeMinutes).toBe(90);
    expect(report.deficitWeeks).toBe(1);
    expect(report.overtimeWeeks).toBe(1);
  });

  it('expõe pendência, hora extra e saldo final exatamente como a folha compensa o período', () => {
    const report = buildEmployeeTimeBalanceReport({
      id: 'gerencia',
      name: 'Gerência',
      ledger: [],
      rawDebitMinutes: 360,
      rawCreditMinutes: 300,
      compensatedMinutes: 300,
      payableDebitMinutes: 60,
      payableOvertimeMinutes: 0,
      overtimeValue: 0,
    });

    expect(report.totalRawDebitMinutes).toBe(360);
    expect(report.totalRawCreditMinutes).toBe(300);
    expect(report.totalCompensatedMinutes).toBe(300);
    expect(report.finalPayableBalanceMinutes).toBe(-60);
  });

  it('não cria débito em dia abonado ou sem cobertura', () => {
    const report = buildEmployeeTimeBalanceReport({
      id: 'carla',
      name: 'Carla',
      ledger: [
        ledgerDay('2026-06-01', 480, 240, 'excused'),
        ledgerDay('2026-06-02', 480, 0, 'neutral'),
        ledgerDay('2026-06-03', 480, 480),
      ],
    });

    expect(report.totalExpectedMinutes).toBe(480);
    expect(report.totalWorkedMinutes).toBe(480);
    expect(report.totalDeficitMinutes).toBe(0);
    expect(report.totalOvertimeMinutes).toBe(0);
    expect(report.weeks[0].days[0].balanceMinutes).toBe(0);
  });

  it('falta e batida incompleta mantêm a meta e habilitam a pendência', () => {
    const report = buildEmployeeTimeBalanceReport({
      id: 'dora',
      name: 'Dora',
      ledger: [
        ledgerDay('2026-06-01', 480, 0, 'absence'),
        ledgerDay('2026-06-02', 480, 0, 'pending'),
      ],
    });

    expect(report.totalExpectedMinutes).toBe(960);
    expect(report.totalDeficitMinutes).toBe(960);
    expect(report.pendingPunchDays).toBe(1);
  });

  it('filtra os dois relatórios e ignora regimes não controlados por meta semanal', () => {
    const reports = buildTimeBalanceReports([
      { id: 'extra', name: 'Extra', paymentType: 'mensalista', ledger: [ledgerDay('2026-06-01', 480, 540)] },
      { id: 'debito', name: 'Débito', paymentType: 'mensalista', ledger: [ledgerDay('2026-06-01', 480, 420)] },
      { id: 'remoto', name: 'Remoto', paymentType: 'remoto', ledger: [ledgerDay('2026-06-01', 480, 0)] },
      { id: 'producao', name: 'Produção', paymentType: 'producao', ledger: [ledgerDay('2026-06-01', 480, 0)] },
    ]);

    expect(reports.map(report => report.id)).toEqual(['debito', 'extra']);
    expect(reportsForKind(reports, 'overtime').map(report => report.id)).toEqual(['extra']);
    expect(reportsForKind(reports, 'deficit').map(report => report.id)).toEqual(['debito']);
  });
});

describe('timeBalanceReports — formatação', () => {
  it('formata sinais e minutos em linguagem operacional', () => {
    expect(formatBalanceMinutes(40)).toBe('+0h40');
    expect(formatBalanceMinutes(-60)).toBe('−1h00');
    expect(formatBalanceMinutes(125, false)).toBe('2h05');
  });
});

import { describe, expect, it } from 'vitest';
import { buildEmployeeTimeBalanceReport } from '@/lib/ponto/timeBalanceReports';
import type { SalaryDayLedger } from '@/lib/salaryPayroll';
import { buildTimeBalanceReportHtml } from './printTimeBalanceReports';

const ledger: SalaryDayLedger = {
  date: '2026-08-03',
  day_of_week: 1,
  punches: ['08:00', '18:40'],
  is_holiday: false,
  is_workday: true,
  expected_minutes: 540,
  worked_minutes: 580,
  raw_balance_minutes: 40,
  raw_credit_minutes: 40,
  raw_delay_minutes: 0,
  compensated_credit_minutes: 0,
  compensated_delay_minutes: 0,
  payable_overtime_minutes: 40,
  payable_delay_minutes: 0,
  discarded_tolerance_minutes: 0,
  status: 'credit',
};

describe('printTimeBalanceReports', () => {
  it('gera calendário diário imprimível e escapa dados do funcionário', () => {
    const report = buildEmployeeTimeBalanceReport({
      id: '1',
      name: 'Ana <RH>',
      department: 'Montagem & Solagem',
      ledger: [ledger],
    });
    const html = buildTimeBalanceReportHtml([report], 'overtime', '03/08/2026 a 09/08/2026');

    expect(html).toContain('Relatório de horas extras');
    expect(html).toContain('Ana &lt;RH&gt;');
    expect(html).toContain('Montagem &amp; Solagem');
    expect(html).toContain('08:00 · 18:40');
    expect(html).toContain('+0h40');
    expect(html).toContain('Seg');
    expect(html).toContain('Dom');
  });
});

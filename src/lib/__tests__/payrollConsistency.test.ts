import { describe, expect, it } from 'vitest';
import { computeComparativoRows } from '../payrollComparativo';
import { buildPayrollHtml } from '../printPayrollBundle';
import { buildPayrollSnapshot, readPayrollSnapshot } from '../payrollSnapshot';
import { computePeriodFolha, PAYROLL_RULE_VERSION } from '../salaryPayroll';

const SCHEDULE = {
  id: 'schedule-1',
  name: 'Padrão',
  entry_time: '08:00:00',
  exit_time: '18:00:00',
  lunch_start: '12:00:00',
  lunch_end: '13:00:00',
  works_sunday: false,
  works_monday: true,
  works_tuesday: true,
  works_wednesday: true,
  works_thursday: true,
  works_friday: true,
  works_saturday: false,
};

describe('consistência da folha e dos relatórios', () => {
  it('inclui desligado somente no período em que o vínculo ainda existia', () => {
    const employee = {
      id: 'employee-terminated',
      name: 'Funcionário desligado',
      external_id: '9',
      active: false,
      admission_date: '2026-01-01',
      termination_date: '2026-05-15',
      salary: 2100,
      payment_type: 'mensalista',
      work_schedule_id: SCHEDULE.id,
    };
    const calculate = (from: string, to: string) => computeComparativoRows({
      employees: [employee],
      schedules: [SCHEDULE],
      defaultSchedule: SCHEDULE,
      holidaysSet: new Set(),
      timeRecords: [],
      advancesList: [],
      range: { from, to },
      period: from.slice(0, 7),
    });

    expect(calculate('2026-05-01', '2026-05-31').rows).toHaveLength(1);
    expect(calculate('2026-06-01', '2026-06-30').rows).toHaveLength(0);
  });

  it('comparativo usa as mesmas ausências justificadas do fechamento', () => {
    const employee = {
      id: 'employee-1',
      name: 'Funcionário',
      external_id: '1',
      active: true,
      salary: 2100,
      payment_type: 'mensalista',
      work_schedule_id: SCHEDULE.id,
    };
    const withAbsence = computeComparativoRows({
      employees: [employee],
      schedules: [SCHEDULE],
      defaultSchedule: SCHEDULE,
      holidaysSet: new Set(),
      timeRecords: [{ employee_external_id: '999', employee_name: 'Outro', record_date: '2026-05-05', punches: ['08:00', '18:00'] }],
      advancesList: [],
      absenceDatesByEmployee: new Map([['employee-1', new Set(['2026-05-05'])]]),
      range: { from: '2026-05-05', to: '2026-05-05' },
      period: '2026-05',
    });
    expect(withAbsence.rows[0].result.falta_days).toBe(0);
    expect(withAbsence.rows[0].result.excused_days).toBe(1);
  });

  it('snapshot preserva versão, ledger e resultado financeiro', () => {
    const result = computePeriodFolha({
      salary: 2200,
      from: '2026-05-04',
      to: '2026-05-05',
      schedule: SCHEDULE,
      holidaysSet: new Set(),
      punchesByDate: new Map([
        ['2026-05-04', ['08:00', '12:00', '13:00', '18:15']],
        ['2026-05-05', ['08:05', '12:00', '13:00', '18:00']],
      ]),
      heNormalRate: 20,
      advancesTotal: 100,
      periodDays: 2,
      monthDays: 31,
    });
    const snapshot = buildPayrollSnapshot({
      from: '2026-05-04',
      to: '2026-05-05',
      employee: {
        id: 'employee-1', name: 'Funcionário', payment_type: 'mensalista', salary: 2200,
        he_normal_rate: 20, he_sunday_holiday_rate: 30,
      },
      schedule: SCHEDULE,
      result,
    });
    const restored = readPayrollSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(restored?.rule_version).toBe(PAYROLL_RULE_VERSION);
    expect(restored?.result.net_value).toBe(result.net_value);
    expect(restored?.result.day_ledger).toEqual(result.day_ledger);

    const inconsistent = { ...snapshot, rule_version: 'regra-adulterada' };
    expect(readPayrollSnapshot(inconsistent)).toBeNull();
  });

  it('calendário e folha impressos exibem compensação e adiantamento do mesmo resultado', () => {
    const result = computePeriodFolha({
      salary: 2200,
      from: '2026-05-04',
      to: '2026-05-05',
      schedule: SCHEDULE,
      holidaysSet: new Set(),
      punchesByDate: new Map([
        ['2026-05-04', ['08:00', '12:00', '13:00', '18:15']],
        ['2026-05-05', ['08:05', '12:00', '13:00', '18:00']],
      ]),
      heNormalRate: 20,
      advancesTotal: 100,
    });
    const html = buildPayrollHtml({
      periodTitle: 'mai/2026',
      docs: { folha: true, calendario: true, holerite: true },
      autoPrint: false,
      employees: [{
        id: 'employee-1',
        name: 'Funcionário',
        run: {
          base_salary: result.base_salary,
          total_proventos: result.total_proventos,
          overtime_amount: result.he_value,
          overtime_50_minutes: result.he_minutes,
          absent_days: result.falta_days,
          absence_discount: result.falta_desconto,
          deductions_amount: result.atraso_desconto,
          advances_total: result.advances_total,
          total_descontos: result.total_descontos,
          total_liquido: result.net_value,
          worked_minutes: result.worked_minutes,
          hourly_rate: result.valor_hora,
          period: '2026-05',
          payment_type: result.payment_type,
          raw_credit_minutes: result.raw_credit_minutes,
          raw_delay_minutes: result.raw_delay_minutes,
          compensated_minutes: result.compensated_minutes,
          rule_version: result.rule_version,
        },
        days: result.day_ledger || [],
      }],
    });
    expect(html).toContain('compensado');
    expect(html).toContain('Adiant.');
    expect(html).toContain(PAYROLL_RULE_VERSION);
    expect(html).not.toContain('Horas extras 1,5×');
  });
});

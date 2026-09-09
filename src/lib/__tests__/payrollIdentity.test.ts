import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Employee } from '@/hooks/useEmployees';
import {
  computeComparativoRows,
  groupPayrollPunchesByEmployee,
  type PayrollIdentityTimeRecord,
} from '../payrollComparativo';

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

function employee(overrides: Partial<Employee>): Employee {
  return {
    id: 'employee-1',
    name: 'Funcionário atual',
    external_id: '10',
    active: true,
    admission_date: '2026-01-01',
    termination_date: null,
    salary: 2200,
    payment_type: 'mensalista',
    work_schedule_id: SCHEDULE.id,
    ...overrides,
  } as Employee;
}

function record(overrides: Partial<PayrollIdentityTimeRecord>): PayrollIdentityTimeRecord {
  return {
    employee_id: 'employee-1',
    employee_external_id: '10',
    employee_name: 'nome curto do relógio',
    record_date: '2026-08-03',
    punches: ['08:00', '12:00', '13:00', '18:00'],
    ...overrides,
  };
}

describe('identidade canônica nos relatórios de folha', () => {
  afterEach(() => vi.restoreAllMocks());

  it('usa a FK histórica correta mesmo quando o crachá foi reciclado', () => {
    const antigo = employee({
      id: 'employee-old',
      name: 'Titular antigo',
      active: false,
      admission_date: '2025-01-01',
      termination_date: '2026-06-30',
    });
    const atual = employee({
      id: 'employee-new',
      name: 'Titular atual',
      admission_date: '2026-07-01',
    });
    const junho = record({ employee_id: antigo.id, record_date: '2026-06-30', employee_name: 'NOME INEXATO' });
    const julho = record({ employee_id: atual.id, record_date: '2026-07-01', employee_name: 'OUTRO NOME INEXATO' });

    const grouped = groupPayrollPunchesByEmployee([antigo, atual], [junho, julho]);

    expect(grouped.byEmployee.get(antigo.id)?.has('2026-06-30')).toBe(true);
    expect(grouped.byEmployee.get(atual.id)?.has('2026-07-01')).toBe(true);
    expect(grouped.unmatched).toEqual([]);
  });

  it('não usa o nome como fallback quando o relógio trouxe matrícula', () => {
    const atual = employee({ id: 'employee-current', name: 'Maria Correta' });
    const wrongBadge = record({ employee_id: null, employee_external_id: '999', employee_name: 'Maria Correta' });

    const grouped = groupPayrollPunchesByEmployee([atual], [wrongBadge]);

    expect(grouped.byEmployee.size).toBe(0);
    expect(grouped.unmatched).toEqual([wrongBadge]);
  });

  it('prioriza a identidade interna persistida e não cai para matrícula ou nome', () => {
    const correto = employee({ id: 'employee-correct', external_id: '10', name: 'Maria Correta' });
    const errado = employee({ id: 'employee-wrong', external_id: '20', name: 'Outro Nome' });
    const canonical = record({
      employee_id: correto.id,
      employee_external_id: '20',
      employee_name: errado.name,
    });

    const grouped = groupPayrollPunchesByEmployee([correto, errado], [canonical]);

    expect(grouped.byEmployee.get(correto.id)?.has(canonical.record_date)).toBe(true);
    expect(grouped.byEmployee.has(errado.id)).toBe(false);
  });

  it('não associa lançamento legado quando mais de uma ficha casa pelo nome', () => {
    const primeira = employee({ id: 'employee-a', external_id: null, name: 'Ana Maria Santos' });
    const segunda = employee({ id: 'employee-b', external_id: null, name: 'Ana Maria Pereira' });
    const legacy = record({
      employee_id: null,
      employee_external_id: null,
      employee_name: 'Ana Maria',
    });

    const grouped = groupPayrollPunchesByEmployee([primeira, segunda], [legacy]);

    expect(grouped.byEmployee.size).toBe(0);
    expect(grouped.unmatched).toEqual([legacy]);
  });

  it('não associa nome legado fora da vigência do vínculo', () => {
    const desligado = employee({
      id: 'employee-old',
      external_id: null,
      name: 'Ana Exclusiva',
      termination_date: '2026-07-31',
      active: false,
    });
    const legacy = record({
      employee_id: null,
      employee_external_id: null,
      employee_name: desligado.name,
      record_date: '2026-08-03',
    });

    const grouped = groupPayrollPunchesByEmployee([desligado], [legacy]);

    expect(grouped.byEmployee.size).toBe(0);
    expect(grouped.unmatched).toEqual([legacy]);
  });

  it('deixa sem vínculo uma matrícula ambígua na mesma data, mesmo com nome exato', () => {
    const primeira = employee({ id: 'employee-a', name: 'Ana Exata' });
    const segunda = employee({ id: 'employee-b', name: 'Beatriz', admission_date: '2026-07-01' });
    const ambiguous = record({ employee_id: null, employee_name: 'Ana Exata', record_date: '2026-08-03' });

    const grouped = groupPayrollPunchesByEmployee([primeira, segunda], [ambiguous]);

    expect(grouped.byEmployee.size).toBe(0);
    expect(grouped.unmatched).toEqual([ambiguous]);
  });

  it('deduplica somente variantes idênticas, com ordem determinística', () => {
    const atual = employee({ id: 'employee-1' });
    const first = record({ punches: ['18:00', '13:00', '12:00', '08:00'] });
    const duplicate = record({ punches: ['08:00', '12:00', '13:00', '18:00'] });

    const grouped = groupPayrollPunchesByEmployee([atual], [first, duplicate]);

    expect(grouped.byEmployee.get(atual.id)?.get('2026-08-03'))
      .toEqual(['08:00', '12:00', '13:00', '18:00']);
    expect(grouped.deduplicatedCount).toBe(1);
    expect(grouped.conflicts).toEqual([]);
  });

  it('marca variantes conflitantes como pendência sem uni-las nem gerar falta', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const atual = employee({ id: 'employee-1' });
    const records = [
      record({ punches: ['08:00', '12:00', '13:00', '17:00'] }),
      record({ punches: ['08:00', '12:00', '13:00', '18:00'] }),
    ];
    const grouped = groupPayrollPunchesByEmployee([atual], records);

    expect(grouped.conflicts).toHaveLength(1);
    expect(grouped.byEmployee.get(atual.id)?.get('2026-08-03')).toEqual(['08:00']);

    const comparativo = computeComparativoRows({
      employees: [atual],
      schedules: [SCHEDULE],
      defaultSchedule: SCHEDULE,
      holidaysSet: new Set(),
      timeRecords: records,
      advancesList: [],
      range: { from: '2026-08-03', to: '2026-08-03' },
      period: '2026-08',
    });
    expect(comparativo.rows[0].result.pending_days).toBe(1);
    expect(comparativo.rows[0].result.falta_days).toBe(0);
  });
});

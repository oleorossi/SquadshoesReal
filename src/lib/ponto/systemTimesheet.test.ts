import { describe, expect, it } from 'vitest';
import type { Employee } from '@/hooks/useEmployees';
import type { TimeRecord, WorkSchedule } from '@/hooks/useTimesheet';
import {
  buildSystemTimesheetAssessment,
  groupTimeRecordsBySystemEmployee,
  listSystemTimesheetEmployees,
  mergeImportedTimePunches,
} from './systemTimesheet';

const schedule = {
  id: 'schedule-1',
  works_sunday: false,
  works_monday: true,
  works_tuesday: true,
  works_wednesday: true,
  works_thursday: true,
  works_friday: true,
  works_saturday: false,
} as WorkSchedule;

function employee(overrides: Partial<Employee>): Employee {
  return {
    id: 'emp-1',
    name: 'Ana Silva',
    external_id: '10',
    active: true,
    admission_date: '2026-01-01',
    termination_date: null,
    payment_type: 'mensalista',
    work_schedule_id: schedule.id,
    department: 'Produção',
    ...overrides,
  } as Employee;
}

function record(overrides: Partial<TimeRecord>): TimeRecord {
  return {
    id: 'record-1',
    employee_name: 'nome curto do relógio',
    employee_external_id: '10',
    department: 'Produção',
    record_date: '2026-08-03',
    punches: ['08:00', '17:48'],
    import_batch: 'batch-1',
    ...overrides,
  } as TimeRecord;
}

describe('systemTimesheet', () => {
  it('atualiza a base pelo novo arquivo sem apagar correções manuais', () => {
    expect(mergeImportedTimePunches(
      ['08:00', '12:00*', '18:00*'],
      ['08:01', '12:00', '13:00'],
    )).toEqual(['08:01', '12:00', '13:00', '18:00*']);
  });

  it('monta o quadro pelo cadastro e vigência, sem depender de quem veio no arquivo', () => {
    const rows = listSystemTimesheetEmployees([
      employee({ id: 'active' }),
      employee({ id: 'terminated', name: 'Bruna', active: false, termination_date: '2026-08-10' }),
      employee({ id: 'old', name: 'Carla', active: false, termination_date: '2026-07-31' }),
      employee({ id: 'future', name: 'Dora', admission_date: '2026-09-01' }),
      employee({ id: 'remote', name: 'Eva', payment_type: 'remoto' }),
    ], '2026-08-01', '2026-08-31');

    expect(rows.map(row => row.id)).toEqual(['active', 'terminated']);
  });

  it('resolve nome divergente pelo ID do relógio e nome apenas no lançamento manual', () => {
    const employees = [employee({ id: 'ana' }), employee({ id: 'bia', name: 'Bia Souza', external_id: '20' })];
    const imported = record({ id: 'clock', employee_name: 'ANA', employee_external_id: '10' });
    const manual = record({ id: 'manual', employee_name: 'Bia Souza', employee_external_id: null });
    const orphan = record({ id: 'orphan', employee_external_id: '999' });
    const grouped = groupTimeRecordsBySystemEmployee(employees, [imported, manual, orphan]);

    expect(grouped.byEmployee.get('ana')).toEqual([imported]);
    expect(grouped.byEmployee.get('bia')).toEqual([manual]);
    expect(grouped.unmatched).toEqual([orphan]);
  });

  it('cria lacunas virtuais nos dias cobertos e respeita calendário e ausências', () => {
    const ana = employee({ id: 'ana' });
    const bia = employee({ id: 'bia', name: 'Bia Souza', external_id: '20' });
    const assessment = buildSystemTimesheetAssessment({
      employees: [ana, bia],
      records: [record({ employee_external_id: '10', record_date: '2026-08-03' })],
      schedules: [schedule],
      defaultSchedule: schedule,
      from: '2026-08-03',
      to: '2026-08-08',
      coveredDates: new Set(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-08']),
      holidayDates: new Set(['2026-08-05']),
      swapWorkedSet: new Set(['2026-08-08']),
      absenceDatesByEmployee: new Map([['bia', new Set(['2026-08-04'])]]),
    });

    expect(assessment.employeeCount).toBe(2);
    expect(assessment.employeesWithPunches).toBe(1);
    expect(assessment.employeesWithoutPunches).toBe(1);
    expect(assessment.employees.find(row => row.employee.id === 'ana')?.missingDates)
      .toEqual(['2026-08-04', '2026-08-08']);
    expect(assessment.employees.find(row => row.employee.id === 'bia')?.missingDates)
      .toEqual(['2026-08-03', '2026-08-08']);
    expect(assessment.missingDayCount).toBe(4);
  });
});

import type { Employee } from '@/hooks/useEmployees';
import type { TimeRecord, WorkSchedule } from '@/hooks/useTimesheet';
import { findEmployeeMatch } from '@/lib/employeeMatching';
import { worksOnDow } from '@/lib/ponto/pontoEngine';
import { employeeOverlapsEmploymentRange } from '@/lib/employeeEmployment';

function cleanPunchKey(punch: string): string {
  const clean = String(punch || '').replace(/[*"]/g, '');
  return /^\d{2}:\d{2}/.test(clean) ? clean.slice(0, 5) : clean;
}

/**
 * Um novo arquivo atualiza as batidas brutas do dia, mas não pode apagar uma
 * correção manual feita depois no sistema. Quando o relógio passa a trazer o
 * mesmo horário, a marca manual (*) é substituída pela batida real.
 */
export function mergeImportedTimePunches(existing: string[], incoming: string[]): string[] {
  const merged = new Map<string, string>();
  for (const punch of incoming || []) {
    const key = cleanPunchKey(punch);
    if (key) merged.set(key, String(punch));
  }
  for (const punch of existing || []) {
    if (!String(punch).includes('*')) continue;
    const key = cleanPunchKey(punch);
    if (key && !merged.has(key)) merged.set(key, String(punch));
  }
  return [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, punch]) => punch);
}

export interface SystemTimesheetEmployeeAssessment {
  employee: Employee;
  records: TimeRecord[];
  recordsByDate: Map<string, TimeRecord[]>;
  punchDays: number;
  missingDates: string[];
}

export interface SystemTimesheetAssessment {
  employees: SystemTimesheetEmployeeAssessment[];
  employeeCount: number;
  employeesWithPunches: number;
  employeesWithoutPunches: number;
  missingDayCount: number;
  unmatchedRecordCount: number;
}

/**
 * O cadastro interno define quem existe no período. O arquivo do relógio só
 * fornece batidas e nunca decide quais funcionários devem aparecer.
 */
export function employeeOverlapsTimesheetRange(
  employee: Pick<Employee, 'active' | 'admission_date' | 'termination_date'>,
  from: string,
  to: string,
): boolean {
  return employeeOverlapsEmploymentRange(employee, from, to);
}

/** Remoto não usa relógio. Produção por par continua visível para presença. */
export function employeeUsesTimeClock(employee: Pick<Employee, 'payment_type'>): boolean {
  return String(employee.payment_type || 'mensalista').toLowerCase() !== 'remoto';
}

export function listSystemTimesheetEmployees(
  employees: Employee[],
  from: string,
  to: string,
): Employee[] {
  return employees
    .filter(employeeUsesTimeClock)
    .filter(employee => employeeOverlapsTimesheetRange(employee, from, to))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

/**
 * Resolve cada linha importada para a ficha vigente. ID do relógio + data tem
 * precedência; nome só é aceito em lançamentos manuais sem ID.
 */
export function groupTimeRecordsBySystemEmployee(
  employees: Employee[],
  records: TimeRecord[],
): { byEmployee: Map<string, TimeRecord[]>; unmatched: TimeRecord[] } {
  const byEmployee = new Map<string, TimeRecord[]>();
  const unmatched: TimeRecord[] = [];

  for (const record of records) {
    const match = findEmployeeMatch(
      employees,
      record.employee_name,
      record.employee_external_id,
      {
        employeeId: record.employee_id,
        recordDate: record.record_date,
        allowNameFallback: !record.employee_external_id,
      },
    );
    if (!match) {
      unmatched.push(record);
      continue;
    }
    const rows = byEmployee.get(match.id) || [];
    rows.push(record);
    byEmployee.set(match.id, rows);
  }

  return { byEmployee, unmatched };
}

function hasRealPunch(records: TimeRecord[]): boolean {
  return records.some(record => Array.isArray(record.punches) && record.punches.length > 0);
}

/**
 * Monta a avaliação operacional do período sobre cadastro, escala, calendário,
 * ausências e cobertura do sistema. Nenhuma lacuna precisa existir no arquivo:
 * se o dia foi coberto pelo relógio e falta a linha de um funcionário esperado,
 * o dia aparece em missingDates mesmo sem time_record persistido.
 */
export function buildSystemTimesheetAssessment(args: {
  employees: Employee[];
  records: TimeRecord[];
  schedules: WorkSchedule[];
  defaultSchedule: WorkSchedule;
  from: string;
  to: string;
  coveredDates: Set<string>;
  holidayDates?: Set<string>;
  swapWorkedSet?: Set<string>;
  swapOffSet?: Set<string>;
  absenceDatesByEmployee?: Map<string, Set<string>>;
}): SystemTimesheetAssessment {
  const {
    employees,
    records,
    schedules,
    defaultSchedule,
    from,
    to,
    coveredDates,
    holidayDates = new Set<string>(),
    swapWorkedSet = new Set<string>(),
    swapOffSet = new Set<string>(),
    absenceDatesByEmployee = new Map<string, Set<string>>(),
  } = args;

  const roster = listSystemTimesheetEmployees(employees, from, to);
  const { byEmployee, unmatched } = groupTimeRecordsBySystemEmployee(employees, records);
  const dates = [...coveredDates].filter(date => date >= from && date <= to).sort();

  const assessmentEmployees = roster.map(employee => {
    const employeeRecords = byEmployee.get(employee.id) || [];
    const recordsByDate = new Map<string, TimeRecord[]>();
    for (const record of employeeRecords) {
      const rows = recordsByDate.get(record.record_date) || [];
      rows.push(record);
      recordsByDate.set(record.record_date, rows);
    }

    const schedule = (employee.work_schedule_id
      && schedules.find(item => item.id === employee.work_schedule_id)) || defaultSchedule;
    const absenceDates = absenceDatesByEmployee.get(employee.id) || new Set<string>();
    const missingDates = dates.filter(date => {
      if (employee.admission_date && date < employee.admission_date) return false;
      if (employee.termination_date && date > employee.termination_date) return false;
      if (absenceDates.has(date) || swapOffSet.has(date)) return false;

      const dow = new Date(`${date}T12:00:00`).getDay();
      const expected = swapWorkedSet.has(date)
        || (!holidayDates.has(date) && worksOnDow(schedule, dow));
      if (!expected) return false;
      return !hasRealPunch(recordsByDate.get(date) || []);
    });

    return {
      employee,
      records: employeeRecords,
      recordsByDate,
      punchDays: [...recordsByDate.values()].filter(hasRealPunch).length,
      missingDates,
    };
  });

  return {
    employees: assessmentEmployees,
    employeeCount: assessmentEmployees.length,
    employeesWithPunches: assessmentEmployees.filter(item => item.punchDays > 0).length,
    employeesWithoutPunches: assessmentEmployees.filter(item => item.punchDays === 0).length,
    missingDayCount: assessmentEmployees.reduce((sum, item) => sum + item.missingDates.length, 0),
    unmatchedRecordCount: unmatched.length,
  };
}

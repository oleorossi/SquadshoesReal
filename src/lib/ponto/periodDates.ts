import { getDaysInRange } from '../salaryPayroll';

type HolidayRow = {
  holiday_date: string;
  recurring?: boolean | null;
  optional?: boolean | null;
};

type AbsenceRow = {
  employee_id: string;
  start_date: string;
  end_date: string;
};

/** Resolve os feriados efetivos do intervalo, expandindo os recorrentes por ano. */
export function resolveHolidaysInRange(
  holidays: HolidayRow[],
  from: string,
  to: string,
): Set<string> {
  const resolved = new Set<string>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return resolved;

  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  for (const holiday of holidays || []) {
    if (holiday.optional === true) continue;
    const holidayDate = String(holiday.holiday_date || '').slice(0, 10);
    if (!holiday.recurring) {
      if (holidayDate >= from && holidayDate <= to) resolved.add(holidayDate);
      continue;
    }

    const month = Number(holidayDate.slice(5, 7));
    const day = Number(holidayDate.slice(8, 10));
    if (!month || !day) continue;
    for (let year = fromYear; year <= toYear; year++) {
      const date = new Date(Date.UTC(year, month - 1, day));
      // 29/02 não existe em anos não bissextos; Date.UTC o normalizaria para março.
      if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dateStr >= from && dateStr <= to) resolved.add(dateStr);
    }
  }
  return resolved;
}

/**
 * Feriados necessários ao cálculo da folha: inclui os meses completos do intervalo,
 * porque o divisor de falta/atraso conta todos os dias úteis do mês.
 */
export function resolveHolidaysForPayrollRange(
  holidays: HolidayRow[],
  from: string,
  to: string,
): Set<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return new Set<string>();
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  if (!endYear || !endMonth) return new Set<string>();
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return resolveHolidaysInRange(
    holidays,
    `${from.slice(0, 7)}-01`,
    `${to.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`,
  );
}

/** Expande ausências que cruzam o intervalo em datas abonadas por funcionário. */
export function expandAbsenceDatesByEmployee(
  absences: AbsenceRow[],
  from: string,
  to: string,
): Map<string, Set<string>> {
  const byEmployee = new Map<string, Set<string>>();
  if (!from || !to || from > to) return byEmployee;

  for (const absence of absences || []) {
    if (!absence.employee_id || !absence.start_date || !absence.end_date) continue;
    const start = absence.start_date > from ? absence.start_date : from;
    const end = absence.end_date < to ? absence.end_date : to;
    if (start > end) continue;
    const dates = byEmployee.get(absence.employee_id) || new Set<string>();
    for (const day of getDaysInRange(start, end)) dates.add(day.date);
    byEmployee.set(absence.employee_id, dates);
  }
  return byEmployee;
}

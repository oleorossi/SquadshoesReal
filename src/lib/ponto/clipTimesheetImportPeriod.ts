/**
 * Recorta batidas do arquivo ao período declarado na importação.
 * Batidas fora de [startDate, endDate] ficam de fora (avisadas na UI) —
 * decisão do dono: alinhar o save à quinzena civil sem barrar o arquivo.
 */
export interface TimesheetImportRecordLike {
  day: number;
  dateStr?: string;
  punches: string[];
}

export interface TimesheetImportEmployeeLike {
  externalId: string;
  name: string;
  department: string;
  records: TimesheetImportRecordLike[];
}

export function clipTimesheetEmployeesToPeriod<T extends TimesheetImportEmployeeLike>(
  employees: T[],
  startDate: string,
  endDate: string,
): { employees: T[]; clippedDayCount: number; clippedPunchDates: string[] } {
  const clippedDates = new Set<string>();
  let clippedDayCount = 0;
  const next = employees.map(employee => {
    const kept: TimesheetImportRecordLike[] = [];
    for (const record of employee.records) {
      const date = record.dateStr || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        kept.push(record);
        continue;
      }
      if (date < startDate || date > endDate) {
        if (Array.isArray(record.punches) && record.punches.length > 0) {
          clippedDayCount += 1;
          clippedDates.add(date);
        }
        continue;
      }
      kept.push(record);
    }
    return { ...employee, records: kept };
  }) as T[];
  return {
    employees: next,
    clippedDayCount,
    clippedPunchDates: Array.from(clippedDates).sort(),
  };
}

/** Conta dias com batida fora do intervalo sem mutar a lista. */
export function countPunchesOutsidePeriod(
  employees: TimesheetImportEmployeeLike[],
  startDate: string,
  endDate: string,
): { outsideDayCount: number; outsideDates: string[] } {
  const { clippedDayCount, clippedPunchDates } = clipTimesheetEmployeesToPeriod(
    employees,
    startDate,
    endDate,
  );
  return { outsideDayCount: clippedDayCount, outsideDates: clippedPunchDates };
}

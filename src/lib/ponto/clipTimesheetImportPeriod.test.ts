import { describe, expect, it } from 'vitest';
import {
  clipTimesheetEmployeesToPeriod,
  countPunchesOutsidePeriod,
} from '@/lib/ponto/clipTimesheetImportPeriod';

describe('clipTimesheetImportPeriod', () => {
  const employees = [
    {
      externalId: '1',
      name: 'Ana',
      department: '',
      records: [
        { day: 31, dateStr: '2026-08-31', punches: ['08:00', '17:00'] },
        { day: 1, dateStr: '2026-09-01', punches: ['08:00', '17:00'] },
        { day: 15, dateStr: '2026-09-15', punches: ['08:00', '17:00'] },
        { day: 16, dateStr: '2026-09-16', punches: ['08:00', '17:00'] },
      ],
    },
  ];

  it('recorta batidas fora da 1ª quinzena e conta o que ficou de fora', () => {
    const { employees: clipped, clippedDayCount, clippedPunchDates } =
      clipTimesheetEmployeesToPeriod(employees, '2026-09-01', '2026-09-15');
    expect(clippedDayCount).toBe(2);
    expect(clippedPunchDates).toEqual(['2026-08-31', '2026-09-16']);
    expect(clipped[0].records.map(r => r.dateStr)).toEqual(['2026-09-01', '2026-09-15']);
  });

  it('countPunchesOutsidePeriod não muta a lista original', () => {
    const before = employees[0].records.length;
    const { outsideDayCount } = countPunchesOutsidePeriod(employees, '2026-09-01', '2026-09-15');
    expect(outsideDayCount).toBe(2);
    expect(employees[0].records).toHaveLength(before);
  });
});

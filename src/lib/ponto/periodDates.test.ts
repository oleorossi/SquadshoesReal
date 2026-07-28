import { describe, expect, it } from 'vitest';
import { expandAbsenceDatesByEmployee, resolveHolidaysForPayrollRange } from './periodDates';

describe('periodDates', () => {
  it('expande feriado recorrente no ano consultado e em todo o mês da folha', () => {
    const holidays = [
      { holiday_date: '2026-01-01', recurring: true },
      { holiday_date: '2027-01-20', recurring: false },
      { holiday_date: '2026-01-25', recurring: true, optional: true },
    ];
    const dates = resolveHolidaysForPayrollRange(holidays, '2027-01-16', '2027-01-16');

    expect(dates).toEqual(new Set(['2027-01-01', '2027-01-20']));
  });

  it('expande apenas a interseção da ausência para cada funcionário', () => {
    const dates = expandAbsenceDatesByEmployee([
      { employee_id: 'ana', start_date: '2026-07-30', end_date: '2026-08-02' },
      { employee_id: 'bia', start_date: '2026-08-01', end_date: '2026-08-01' },
    ], '2026-08-01', '2026-08-03');

    expect(dates.get('ana')).toEqual(new Set(['2026-08-01', '2026-08-02']));
    expect(dates.get('bia')).toEqual(new Set(['2026-08-01']));
  });
});

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

  it('NÃO trata dia útil excepcional da fábrica como feriado (sábado produtivo)', () => {
    // Regressão de 11/08/2026. `holidays` passou a guardar dois tipos de linha
    // com sinais OPOSTOS: feriado de verdade e sábado em que a fábrica trabalha
    // (is_working_day). Este resolver é o gargalo por onde Payroll, Timesheet,
    // EspelhoPonto e os relatórios de faltas/atrasos leem feriado — deixar o
    // sábado produtivo passar marcaria o dia como feriado no espelho de ponto e
    // geraria hora extra fantasma.
    const holidays = [
      { holiday_date: '2026-09-07', recurring: false },                        // feriado real
      { holiday_date: '2026-09-05', recurring: false, is_working_day: true },  // sábado trabalhado
    ];
    const dates = resolveHolidaysForPayrollRange(holidays, '2026-09-01', '2026-09-30');

    expect(dates.has('2026-09-07')).toBe(true);
    expect(dates.has('2026-09-05')).toBe(false);
  });

  it('is_working_day vence mesmo em feriado recorrente na mesma data', () => {
    const holidays = [
      { holiday_date: '2026-09-05', recurring: true, is_working_day: true },
    ];
    const dates = resolveHolidaysForPayrollRange(holidays, '2026-09-01', '2026-09-30');

    expect(dates.size).toBe(0);
  });
});

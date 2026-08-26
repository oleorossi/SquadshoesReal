import { describe, expect, it } from 'vitest';
import {
  expandAbsenceCreditsByEmployee,
  expandAbsenceDatesByEmployee,
  resolveHolidaysForPayrollRange,
} from './periodDates';

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

  it('não transforma falta injustificada, suspensão ou ausência não paga em abono', () => {
    const dates = expandAbsenceDatesByEmployee([
      { employee_id: 'ana', start_date: '2026-08-03', end_date: '2026-08-03', absence_type: 'falta_injustificada', paid: true },
      { employee_id: 'ana', start_date: '2026-08-04', end_date: '2026-08-04', absence_type: 'suspensao', justified: true },
      { employee_id: 'ana', start_date: '2026-08-05', end_date: '2026-08-05', absence_type: 'atestado', paid: false, justified: true },
      { employee_id: 'ana', start_date: '2026-08-06', end_date: '2026-08-06', absence_type: 'atestado', paid: null, justified: false },
      { employee_id: 'ana', start_date: '2026-08-07', end_date: '2026-08-07', absence_type: 'atestado', paid: true, justified: true },
    ], '2026-08-03', '2026-08-07');

    expect(dates.get('ana')).toEqual(new Set(['2026-08-07']));
  });

  it('paid=true vence justified legado falso no cadastro moderno', () => {
    const dates = expandAbsenceDatesByEmployee([
      { employee_id: 'ana', start_date: '2026-08-03', end_date: '2026-08-03', absence_type: 'atestado', paid: true, justified: false },
    ], '2026-08-03', '2026-08-03');

    expect(dates.get('ana')).toEqual(new Set(['2026-08-03']));
  });

  it('separa horas parciais do abono integral e soma sobreposições remuneradas', () => {
    const credits = expandAbsenceCreditsByEmployee([
      { employee_id: 'ana', start_date: '2026-08-03', end_date: '2026-08-04', absence_type: 'atestado', paid: true, hours_per_day: 2.5 },
      { employee_id: 'ana', start_date: '2026-08-04', end_date: '2026-08-04', absence_type: 'abono', paid: true, hours_per_day: 1 },
      { employee_id: 'ana', start_date: '2026-08-05', end_date: '2026-08-05', absence_type: 'ferias', paid: true, hours_per_day: null },
      { employee_id: 'ana', start_date: '2026-08-06', end_date: '2026-08-06', absence_type: 'atestado', paid: true, hours_per_day: 0 },
    ], '2026-08-03', '2026-08-06');

    expect(credits.fullDayDates.get('ana')).toEqual(new Set(['2026-08-05']));
    expect(credits.partialMinutes.get('ana')).toEqual(new Map([
      ['2026-08-03', 150],
      ['2026-08-04', 210],
    ]));
  });

  it('abono integral vence créditos parciais sobrepostos independentemente da ordem', () => {
    const credits = expandAbsenceCreditsByEmployee([
      { employee_id: 'ana', start_date: '2026-08-03', end_date: '2026-08-03', paid: true, hours_per_day: 2 },
      { employee_id: 'ana', start_date: '2026-08-03', end_date: '2026-08-03', paid: true, hours_per_day: null },
      { employee_id: 'ana', start_date: '2026-08-03', end_date: '2026-08-03', paid: true, hours_per_day: 1 },
    ], '2026-08-03', '2026-08-03');

    expect(credits.fullDayDates.get('ana')).toEqual(new Set(['2026-08-03']));
    expect(credits.partialMinutes.get('ana')?.has('2026-08-03')).toBe(false);
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

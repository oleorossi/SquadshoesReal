import { describe, it, expect } from 'vitest';
import { monthWeekToISODate, isoToMonthWeek } from './billingWeek';

describe('monthWeekToISODate', () => {
  it('mês começando em segunda: S1 = dia 1, semanas seguintes de 7 em 7', () => {
    // Junho/2026 começa numa segunda-feira
    expect(monthWeekToISODate('2026-06', 'S1')).toBe('2026-06-01');
    expect(monthWeekToISODate('2026-06', 'S2')).toBe('2026-06-08');
    expect(monthWeekToISODate('2026-06', 'S4')).toBe('2026-06-22');
  });

  it('S1 de mês começando em sábado é clampada pro dia 1 (não vaza pro mês anterior)', () => {
    // Agosto/2026 começa num sábado — a segunda da semana que contém o dia 1
    // seria 2026-07-27 (mês ANTERIOR). Regra M14: clampa pro dia 1.
    expect(monthWeekToISODate('2026-08', 'S1')).toBe('2026-08-01');
    // S2 já cai dentro do mês normalmente (primeira segunda de agosto)
    expect(monthWeekToISODate('2026-08', 'S2')).toBe('2026-08-03');
  });

  it('entrada inválida retorna null', () => {
    expect(monthWeekToISODate('', 'S1')).toBeNull();
    expect(monthWeekToISODate('2026-08', '')).toBeNull();
    expect(monthWeekToISODate('abc', 'S1')).toBeNull();
  });
});

describe('isoToMonthWeek', () => {
  it('faz o round-trip da data clampada de S1', () => {
    expect(isoToMonthWeek('2026-08-01')).toEqual({ month: '2026-08', week: 'S1' });
  });

  it('faz o round-trip de semanas normais', () => {
    expect(isoToMonthWeek('2026-08-03')).toEqual({ month: '2026-08', week: 'S2' });
    expect(isoToMonthWeek('2026-06-08')).toEqual({ month: '2026-06', week: 'S2' });
  });
});

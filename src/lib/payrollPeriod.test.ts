import { describe, expect, it } from 'vitest';
import { lastDayOfMonth, payrollPeriodLabel, periodToRange, rangeToPeriod } from './payrollPeriod';

describe('lastDayOfMonth', () => {
  it('resolve meses de 31/30 dias', () => {
    expect(lastDayOfMonth('2026-07')).toBe('2026-07-31');
    expect(lastDayOfMonth('2026-06')).toBe('2026-06-30');
  });
  it('fevereiro bissexto e não bissexto', () => {
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29');
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
  });
  it('entrada malformada → vazio', () => {
    expect(lastDayOfMonth('')).toBe('');
    expect(lastDayOfMonth('abc')).toBe('');
  });
});

describe('rangeToPeriod', () => {
  it('mês cheio vira "YYYY-MM" (compat com folhas mensais antigas)', () => {
    expect(rangeToPeriod('2026-07-01', '2026-07-31')).toBe('2026-07');
    expect(rangeToPeriod('2024-02-01', '2024-02-29')).toBe('2024-02');
  });
  it('quinzena vira "from_to"', () => {
    expect(rangeToPeriod('2026-07-01', '2026-07-15')).toBe('2026-07-01_2026-07-15');
    expect(rangeToPeriod('2026-07-16', '2026-07-31')).toBe('2026-07-16_2026-07-31');
  });
  it('intervalo cruzando meses NUNCA vira mensal', () => {
    expect(rangeToPeriod('2026-07-01', '2026-08-31')).toBe('2026-07-01_2026-08-31');
  });
  it('vazio → vazio', () => {
    expect(rangeToPeriod('', '2026-07-31')).toBe('');
    expect(rangeToPeriod('2026-07-01', '')).toBe('');
  });
});

describe('periodToRange', () => {
  it('roundtrip com rangeToPeriod (mensal e quinzenal)', () => {
    for (const [from, to] of [
      ['2026-07-01', '2026-07-31'],
      ['2026-07-01', '2026-07-15'],
      ['2026-07-16', '2026-07-31'],
      ['2024-02-01', '2024-02-29'],
    ] as const) {
      expect(periodToRange(rangeToPeriod(from, to))).toEqual({ from, to });
    }
  });
  it('period malformado → {from:"", to:""}', () => {
    expect(periodToRange('julho')).toEqual({ from: '', to: '' });
    expect(periodToRange('2026-07-01')).toEqual({ from: '', to: '' });
    expect(periodToRange('')).toEqual({ from: '', to: '' });
  });
});

describe('payrollPeriodLabel', () => {
  it('mês cheio → "jul/2026"', () => {
    expect(payrollPeriodLabel('2026-07-01', '2026-07-31')).toBe('jul/2026');
  });
  it('quinzena → "01/07–15/07/2026"', () => {
    expect(payrollPeriodLabel('2026-07-01', '2026-07-15')).toBe('01/07–15/07/2026');
  });
  it('sem datas → travessão', () => {
    expect(payrollPeriodLabel('', '')).toBe('—');
  });
});

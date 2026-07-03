import { describe, it, expect } from 'vitest';
import {
  businessDaysInPeriod, absenceBusinessDays, sumAbsenceBusinessDays,
  absenteeismRate, mandatoryHolidaySet,
} from '../absenteeism';

// Âncora: 2026-07-01 é uma QUARTA. Julho/2026: 31 dias, 8 dias de fim de semana
// (04,05,11,12,18,19,25,26) → 23 dias úteis sem feriado.
describe('businessDaysInPeriod', () => {
  it('conta seg–sex, exclui fim de semana', () => {
    // 01(Qua) 02(Qui) 03(Sex) 04(Sáb) 05(Dom) 06(Seg) 07(Ter) = 5 úteis
    expect(businessDaysInPeriod('2026-07-01', '2026-07-07')).toBe(5);
  });
  it('exclui feriado obrigatório', () => {
    expect(businessDaysInPeriod('2026-07-01', '2026-07-07', new Set(['2026-07-03']))).toBe(4);
  });
  it('mês cheio de julho/2026 = 23 dias úteis', () => {
    expect(businessDaysInPeriod('2026-07-01', '2026-07-31')).toBe(23);
  });
  it('intervalo invertido/vazio = 0', () => {
    expect(businessDaysInPeriod('2026-07-07', '2026-07-01')).toBe(0);
    expect(businessDaysInPeriod('', '')).toBe(0);
  });
});

describe('absenceBusinessDays (recorte na janela)', () => {
  it('recorta a ausência que atravessa a borda do período', () => {
    // 28/06(Dom)–02/07(Qui) consultada em julho → só 01(Qua) e 02(Qui) = 2
    expect(absenceBusinessDays({ start_date: '2026-06-28', end_date: '2026-07-02' }, '2026-07-01', '2026-07-31')).toBe(2);
  });
  it('ausência inteiramente fora do período = 0', () => {
    expect(absenceBusinessDays({ start_date: '2026-06-01', end_date: '2026-06-15' }, '2026-07-01', '2026-07-31')).toBe(0);
  });
  it('férias de 1 semana cheia = 5 dias úteis', () => {
    // 06/07(Seg)–12/07(Dom) → 06,07,08,09,10 = 5
    expect(absenceBusinessDays({ start_date: '2026-07-06', end_date: '2026-07-12' }, '2026-07-01', '2026-07-31')).toBe(5);
  });
});

describe('sumAbsenceBusinessDays', () => {
  it('soma múltiplas ausências recortadas', () => {
    const list = [
      { start_date: '2026-07-01', end_date: '2026-07-02' }, // 2
      { start_date: '2026-07-06', end_date: '2026-07-06' }, // 1
      { start_date: '2026-06-01', end_date: '2026-06-30' }, // 0 (fora)
    ];
    expect(sumAbsenceBusinessDays(list, '2026-07-01', '2026-07-31')).toBe(3);
  });
});

describe('absenteeismRate', () => {
  it('taxa = dias ausentes / (dias úteis × headcount) × 100', () => {
    expect(absenteeismRate(23, 23, 10)).toBeCloseTo(10, 5); // 1 func ausente o mês todo entre 10
    expect(absenteeismRate(0, 23, 10)).toBe(0);
  });
  it('denominador 0 → 0 (sem divisão por zero)', () => {
    expect(absenteeismRate(5, 0, 10)).toBe(0);
    expect(absenteeismRate(5, 23, 0)).toBeCloseTo((5 / 23) * 100, 5); // headcount 0 tratado como 1
  });
});

describe('mandatoryHolidaySet', () => {
  it('mantém só feriados obrigatórios (optional !== true)', () => {
    const s = mandatoryHolidaySet([
      { holiday_date: '2026-07-09', optional: false },
      { holiday_date: '2026-07-16', optional: true },
      { holiday_date: '2026-07-20' },
    ]);
    expect(s.has('2026-07-09')).toBe(true);
    expect(s.has('2026-07-16')).toBe(false);
    expect(s.has('2026-07-20')).toBe(true);
  });
});

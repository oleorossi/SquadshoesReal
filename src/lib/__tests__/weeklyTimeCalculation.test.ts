import { describe, it, expect } from 'vitest';
import { calculateWeeklyPeriod, type WeeklyCalcDay } from '../weeklyTimeCalculation';

const SCH = { tolerance_minutes: 0, weekly_hours: 40, minimum_overtime_minutes: 0 };
const mkDay = (date: string, dow: number, worked: number, expected = 480): WeeklyCalcDay => ({
  date, dayOfWeek: dow, workedMinutes: worked, expectedMinutes: expected,
  overtimeMinutes: 0, isHoliday: false, isAbsent: worked === 0, status: 'normal', punches: [],
});

// Seg–Sex (2026-05-04 a 08) caem na MESMA semana ISO.
const WEEK = (w: number[]) => [
  mkDay('2026-05-04', 1, w[0]), mkDay('2026-05-05', 2, w[1]),
  mkDay('2026-05-06', 3, w[2]), mkDay('2026-05-07', 4, w[3]),
  mkDay('2026-05-08', 5, w[4]),
];

describe('calculateWeeklyPeriod — redistribuição diária de HE (invariante Σ=semana)', () => {
  it('caso front-then-dip: Σ(dias) === HE semanal e dia de déficit NÃO recebe HE', () => {
    // worked 700,700,480,200,480 · esperado 480/dia → HE semanal = max(0, 2560−2400) = 160.
    // (Bug antigo distribuía ~1420 e dava HE pra quinta, que trabalhou só 200.)
    const p = calculateWeeklyPeriod(WEEK([700, 700, 480, 200, 480]), SCH);
    expect(p.weeks).toHaveLength(1);
    const wk = p.weeks[0];
    expect(wk.overtimeMinutes).toBe(160);
    expect(wk.days.reduce((s, d) => s + d.overtimeMinutes, 0)).toBe(160);
    expect(wk.days.find(d => d.date === '2026-05-07')!.overtimeMinutes).toBe(0); // déficit → 0 HE
  });

  it('caso steady (+40/dia): Σ(dias) === HE semanal', () => {
    const p = calculateWeeklyPeriod(WEEK([520, 520, 520, 520, 520]), SCH);
    const wk = p.weeks[0];
    expect(wk.overtimeMinutes).toBe(200);
    expect(wk.days.reduce((s, d) => s + d.overtimeMinutes, 0)).toBe(200);
  });

  it('sem HE (todo dia no esperado): nenhum dia recebe HE', () => {
    const p = calculateWeeklyPeriod(WEEK([480, 480, 480, 480, 480]), SCH);
    const wk = p.weeks[0];
    expect(wk.overtimeMinutes).toBe(0);
    expect(wk.days.every(d => d.overtimeMinutes === 0)).toBe(true);
  });

  it('um pico isolado: a HE cai toda no dia do excedente', () => {
    const p = calculateWeeklyPeriod(WEEK([480, 480, 900, 480, 480]), SCH);
    const wk = p.weeks[0];
    expect(wk.overtimeMinutes).toBe(420); // 900−480
    expect(wk.days.reduce((s, d) => s + d.overtimeMinutes, 0)).toBe(420);
    expect(wk.days.find(d => d.date === '2026-05-06')!.overtimeMinutes).toBe(420);
  });
});

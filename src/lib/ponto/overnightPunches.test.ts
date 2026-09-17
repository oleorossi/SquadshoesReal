import { describe, expect, it } from 'vitest';
import {
  applyOvernightCarry,
  dayNeedsOvernightExit,
  detectOvernightCarries,
  orderPunchMinutesForIntervals,
  takeDawnPrefix,
} from './overnightPunches';
import { splitDayMinutes } from '../hourlyPayroll';
import { computePeriodFolha } from '../salaryPayroll';

const WED = 3;

describe('overnightPunches', () => {
  it('dayNeedsOvernightExit cobre 1 batida, ímpar e n=3 sem saída final', () => {
    expect(dayNeedsOvernightExit(['08:14'])).toBe(true);
    expect(dayNeedsOvernightExit(['08:00', '12:00', '13:00', '18:00', '20:00'])).toBe(true);
    expect(dayNeedsOvernightExit(['08:12', '12:41', '13:08'])).toBe(true);
    expect(dayNeedsOvernightExit(['08:00', '12:00', '13:00', '18:00'])).toBe(false);
    expect(dayNeedsOvernightExit(['08:00', '13:00', '21:28'])).toBe(false);
  });

  it('takeDawnPrefix separa só o prefixo < 05:00', () => {
    expect(takeDawnPrefix(['00:48', '08:23', '12:12'])).toEqual({
      dawn: ['00:48'],
      rest: ['08:23', '12:12'],
    });
    expect(takeDawnPrefix(['06:13', '14:57'])).toEqual({
      dawn: [],
      rest: ['06:13', '14:57'],
    });
  });

  it('detecta virada Tália 02–03/07 (entrada sozinha + saída 03:04)', () => {
    const map = new Map<string, string[]>([
      ['2026-07-02', ['08:14']],
      ['2026-07-03', ['03:04']],
    ]);
    const carries = detectOvernightCarries(map);
    expect(carries).toHaveLength(1);
    expect(carries[0]).toMatchObject({
      workDate: '2026-07-02',
      nextDate: '2026-07-03',
      carriedPunches: ['03:04'],
      workPunchesAfter: ['08:14', '03:04'],
      remainingNextPunches: [],
    });
  });

  it('não carrega 06:13 (após o corte da madrugada)', () => {
    const map = new Map<string, string[]>([
      ['2026-08-03', ['08:02', '13:05', '21:42']],
      ['2026-08-04', ['06:13', '14:57', '17:58']],
    ]);
    // 08-03 tem 3 batidas com última 21:42 → não precisa saída (já tem)
    expect(detectOvernightCarries(map)).toHaveLength(0);
  });

  it('carrega 00:48 do dia seguinte quando D está incompleto (n=3 almoço)', () => {
    const map = new Map<string, string[]>([
      ['2026-08-05', ['08:12', '12:41', '13:08']],
      ['2026-08-06', ['00:48', '08:23', '12:12', '12:26']],
    ]);
    const { punchesByDate, carries } = applyOvernightCarry(map);
    expect(carries).toHaveLength(1);
    expect(punchesByDate.get('2026-08-05')).toEqual(['08:12', '12:41', '13:08', '00:48']);
    expect(punchesByDate.get('2026-08-06')).toEqual(['08:23', '12:12', '12:26']);
  });

  it('orderPunchMinutesForIntervals sobe a saída de madrugada (+1440)', () => {
    expect(orderPunchMinutesForIntervals(['08:14', '03:04'])).toEqual([8 * 60 + 14, 27 * 60 + 4]);
    // Dia normal não mexe
    expect(orderPunchMinutesForIntervals(['08:00', '12:00', '13:00', '18:00']))
      .toEqual([480, 720, 780, 1080]);
  });
});

describe('splitDayMinutes — virada à noite', () => {
  it('08:14 + 03:04 conta a jornada noturna, não a manhã invertida', () => {
    const r = splitDayMinutes(['08:14', '03:04'], WED, false);
    expect(r.incomplete).toBe(false);
    // 08:14→03:04(+1) = 18h50 brutos − 1h almoço = 17h50
    // normal 08:14→18:00 = 586 − 60 almoço = 526; premium 18:00→03:04 = 544
    expect(r.normal).toBe(526);
    expect(r.premium).toBe(544);
    expect(r.normal + r.premium).toBe(17 * 60 + 50);
  });

  it('n=4 com saída 00:48 na cauda pareia a virada', () => {
    const r = splitDayMinutes(['08:12', '12:41', '13:08', '00:48'], WED, false);
    expect(r.incomplete).toBe(false);
    expect(r.normal + r.premium).toBeGreaterThan(10 * 60);
  });
});

describe('computePeriodFolha — virada carrega sozinha', () => {
  const SCHED = {
    entry_time: '08:00:00', exit_time: '17:48:00', lunch_start: '12:00:00', lunch_end: '13:00:00',
    saturday_entry: '08:00:00', saturday_exit: '12:00:00',
    works_sunday: false, works_monday: true, works_tuesday: true, works_wednesday: true,
    works_thursday: true, works_friday: true, works_saturday: false,
    weekly_hours: 44, overtime_multiplier: 1.5, night_overtime_multiplier: 1.7,
    holiday_multiplier: 1.5, tolerance_minutes: 0, minimum_overtime_minutes: 10, is_default: true,
  };

  it('Tália 02–03/07: D completa e D+1 não fica pendente órfão', () => {
    const punches = new Map<string, string[]>([
      ['2026-07-02', ['08:14']],
      ['2026-07-03', ['03:04']],
    ]);
    const r = computePeriodFolha({
      salary: 2200,
      from: '2026-07-02',
      to: '2026-07-03',
      schedule: SCHED as never,
      holidaysSet: new Set(),
      punchesByDate: punches,
      coveredDates: new Set(['2026-07-02', '2026-07-03']),
      heNormalRate: 15,
    });
    const d2 = r.day_ledger!.find(d => d.date === '2026-07-02')!;
    const d3 = r.day_ledger!.find(d => d.date === '2026-07-03')!;
    expect(d2.status).not.toBe('pending');
    expect((d2.worked_minutes || 0)).toBeGreaterThan(10 * 60);
    // 03/07 quinta: sem batida após o carry → débito de jornada (compensa HE), não pendência
    expect(d3.status).not.toBe('pending');
    expect(d3.worked_minutes || 0).toBe(0);
  });
});

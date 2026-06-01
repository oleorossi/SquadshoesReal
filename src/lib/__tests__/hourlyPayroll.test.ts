import { describe, it, expect } from 'vitest';
import { splitDayMinutes, calculateHourlyPayroll, type HourlyDayInput } from '../hourlyPayroll';

// Folha por hora trabalhada (refocus 2026-06-01). Trava a regra:
// VH = salário/220; 1,5× após 18h / sáb / dom / feriado; não acumula;
// almoço não-batido (2 batidas ou nº ímpar, dia >6h) deduz 1h padrão.
const WED = 3, SAT = 6, SUN = 0;

describe('splitDayMinutes', () => {
  it('4 batidas completas (dia útil): almoço sai no gap → 9h normal', () => {
    const r = splitDayMinutes(['08:00', '12:00', '13:00', '18:00'], WED, false);
    expect(r).toEqual({ normal: 540, premium: 0, incomplete: false });
  });

  it('esqueceu o 12:00 (ímpar 08/13/18): conta a tarde e deduz 1h almoço → 9h, marca incompleto', () => {
    const r = splitDayMinutes(['08:00', '13:00', '18:00'], WED, false);
    expect(r.normal).toBe(540); // não os 5h truncados de antes
    expect(r.premium).toBe(0);
    expect(r.incomplete).toBe(true);
  });

  it('só entrada+saída longa (08/18): deduz 1h almoço não-batido → 9h', () => {
    expect(splitDayMinutes(['08:00', '18:00'], WED, false)).toEqual({ normal: 540, premium: 0, incomplete: false });
  });

  it('2 batidas curtas (08/13, <6h): não deduz almoço → 5h', () => {
    expect(splitDayMinutes(['08:00', '13:00'], WED, false)).toEqual({ normal: 300, premium: 0, incomplete: false });
  });

  it('meio período (08/12): 4h, sem dedução', () => {
    expect(splitDayMinutes(['08:00', '12:00'], WED, false)).toEqual({ normal: 240, premium: 0, incomplete: false });
  });

  it('vai até 20h (completo): 9h normal + 2h após 18h a 1,5×', () => {
    const r = splitDayMinutes(['08:00', '12:00', '13:00', '20:00'], WED, false);
    expect(r).toEqual({ normal: 540, premium: 120, incomplete: false });
  });

  it('sábado o dia inteiro é 1,5× (entrada+saída deduz almoço) → 9h premium', () => {
    expect(splitDayMinutes(['08:00', '18:00'], SAT, false)).toEqual({ normal: 0, premium: 540, incomplete: false });
  });

  it('domingo completo: 9h premium (almoço no gap)', () => {
    expect(splitDayMinutes(['08:00', '12:00', '13:00', '18:00'], SUN, false)).toEqual({ normal: 0, premium: 540, incomplete: false });
  });

  it('feriado ímpar: deduz do premium quando não há normal → 9h premium, incompleto', () => {
    const r = splitDayMinutes(['08:00', '13:00', '18:00'], WED, true);
    expect(r).toEqual({ normal: 0, premium: 540, incomplete: true });
  });

  it('tolera batida assumida com * e minutos não-zero (12:37*, 18:00*)', () => {
    // 08:00, 12:37*(=12:37), 13:00, 18:00*(=18:00) → manhã 4h37 + tarde 5h
    const r = splitDayMinutes(['08:00', '12:37*', '13:00', '18:00*'], WED, false);
    expect(r.normal).toBe((757 - 480) + (1080 - 780)); // 277 + 300 = 577
    expect(r.premium).toBe(0);
  });

  it('batida assumida só entrada+saída (08:09, 18:00*) deduz 1h almoço', () => {
    const r = splitDayMinutes(['08:09', '18:00*'], WED, false);
    expect(r.normal).toBe((1080 - 489) - 60); // span 591 − 60 = 531
  });

  it('batida única ou vazia: 0h (única marca incompleto)', () => {
    expect(splitDayMinutes(['08:00'], WED, false)).toEqual({ normal: 0, premium: 0, incomplete: true });
    expect(splitDayMinutes([], WED, false)).toEqual({ normal: 0, premium: 0, incomplete: false });
  });
});

describe('calculateHourlyPayroll', () => {
  const day = (date: string, dayOfWeek: number, punches: string[], isHoliday = false): HourlyDayInput =>
    ({ date, dayOfWeek, isHoliday, punches });

  it('salário 2200 → VH 10; um dia normal de 9h = R$ 90 bruto', () => {
    const r = calculateHourlyPayroll(2200, [day('2026-06-03', WED, ['08:00', '12:00', '13:00', '18:00'])], 0);
    expect(r.hourly_rate).toBe(10);
    expect(r.normal_minutes).toBe(540);
    expect(r.normal_value).toBe(90);
    expect(r.gross_value).toBe(90);
    expect(r.net_value).toBe(90);
  });

  it('hora 1,5×: sábado de 9h com VH 10 = R$ 135', () => {
    const r = calculateHourlyPayroll(2200, [day('2026-06-06', SAT, ['08:00', '18:00'])], 0);
    expect(r.premium_minutes).toBe(540);
    expect(r.premium_value).toBe(135);
    expect(r.gross_value).toBe(135);
  });

  it('adiantamento é o único desconto: líquido = bruto − adiantamento', () => {
    const r = calculateHourlyPayroll(2200, [day('2026-06-03', WED, ['08:00', '12:00', '13:00', '18:00'])], 50);
    expect(r.gross_value).toBe(90);
    expect(r.advances_total).toBe(50);
    expect(r.net_value).toBe(40);
  });

  it('conta dias incompletos (batida faltando) pra alerta', () => {
    const r = calculateHourlyPayroll(2200, [day('2026-06-03', WED, ['08:00', '13:00', '18:00'])], 0);
    expect(r.incomplete_days).toBe(1);
    expect(r.normal_minutes).toBe(540); // ainda contabiliza
  });
});

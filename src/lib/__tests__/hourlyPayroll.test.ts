import { describe, it, expect } from 'vitest';
import { splitDayMinutes, calculateHourlyPayroll, type HourlyDayInput } from '../hourlyPayroll';

// Folha por hora trabalhada (refocus 2026-06-01). Trava a regra:
// VH = salário/220; 1,5× após 18h / sáb / dom / feriado; não acumula;
// almoço não-batido (2 batidas, dia >6h) deduz 1h padrão;
// nº ÍMPAR de batidas = INCONSISTENTE → 0h (fica de fora; resolver no Pendências).
const WED = 3, SAT = 6, SUN = 0;

describe('splitDayMinutes', () => {
  it('4 batidas completas (dia útil): almoço sai no gap → 9h normal', () => {
    const r = splitDayMinutes(['08:00', '12:00', '13:00', '18:00'], WED, false);
    expect(r).toEqual({ normal: 540, premium: 0, incomplete: false });
  });

  it('nº ímpar (08/13/18 = pulou batida): INCONSISTENTE → 0h, marca incompleto (resolve no Pendências)', () => {
    const r = splitDayMinutes(['08:00', '13:00', '18:00'], WED, false);
    expect(r.normal).toBe(0); // não "chuta" mais pelo intervalo
    expect(r.premium).toBe(0);
    expect(r.incomplete).toBe(true);
  });

  it('batida EXTRA (5 marcações): última batida = saída, calcula span − almoço (08..20 → 11h)', () => {
    // 08:00,12:00,13:00,18:00,20:00 → span 08→20 (12h) − 1h almoço = 11h:
    // 9h normal (até 18h) + 2h premium (18→20). Não vira pendência.
    const r = splitDayMinutes(['08:00', '12:00', '13:00', '18:00', '20:00'], WED, false);
    expect(r).toEqual({ normal: 540, premium: 120, incomplete: false });
  });

  it('nº ímpar n=3 continua pendente; n=5 (extra) não', () => {
    expect(splitDayMinutes(['08:00', '13:00', '18:00'], WED, false).incomplete).toBe(true);
    expect(splitDayMinutes(['08:06', '12:01', '12:59', '18:09', '20:09'], WED, false).incomplete).toBe(false);
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

  it('feriado ímpar (pulou batida): INCONSISTENTE → 0h, incompleto (mesmo em feriado)', () => {
    const r = splitDayMinutes(['08:00', '13:00', '18:00'], WED, true);
    expect(r).toEqual({ normal: 0, premium: 0, incomplete: true });
  });

  it('tolera batida assumida com * e minutos não-zero (12:37*, 18:00*)', () => {
    // 08:00, 12:37*, 13:00, 18:00*: pausa de 23min em 12–14 → completa pra 1h.
    // Trabalhado bruto 577min − 37min (top-up do almoço) = 540 = 9h.
    const r = splitDayMinutes(['08:00', '12:37*', '13:00', '18:00*'], WED, false);
    expect(r.normal).toBe(540);
    expect(r.premium).toBe(0);
  });

  it('almoço curto batido (Quesia: 13:00→13:05 = 5min) é completado pra 1h → 8h59', () => {
    // pares (08:01→13:00)=299 + (13:05→18:00)=295 = 594; pausa em 12–14 = 5min
    // → top-up 55min → 539 = 8h59.
    const r = splitDayMinutes(['08:01', '13:00', '13:05', '18:00'], WED, false);
    expect(r.normal).toBe(539);
    expect(r.premium).toBe(0);
  });

  it('pausa LONGA batida (08/11/15/18 = saiu 4h no meio) usa a real, sem forçar 1h → 6h', () => {
    const r = splitDayMinutes(['08:00', '11:00', '15:00', '18:00'], WED, false);
    expect(r.normal).toBe(360); // 3h manhã + 3h tarde; pausa de 12–14 já > 1h
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

  // ── Dedupe de batida DUPLA (<5 min) — paridade com o SQL calculate_day_summary (M25) ──
  it('batida dupla do relógio (07:59 + 08:01 + 18:00): deduplica e CALCULA o dia (não vira pendência)', () => {
    // dedupe → [07:59, 18:00] = span 601 − 1h almoço = 541 (o caso da migration do SQL).
    const r = splitDayMinutes(['07:59', '08:01', '18:00'], WED, false);
    expect(r.incomplete).toBe(false);
    expect(r.normal).toBe(541);
    expect(r.premium).toBe(0);
  });

  it('batida dupla no meio de 5 marcações: dedupe → 4 batidas pareadas normais', () => {
    // dedupe → [07:59, 12:00, 13:00, 18:00] = 241 + 300 = 541 (pausa ≥1h já batida).
    const r = splitDayMinutes(['07:59', '08:01', '12:00', '13:00', '18:00'], WED, false);
    expect(r).toEqual({ normal: 541, premium: 0, incomplete: false });
  });

  it('SÓ a batida dupla (07:59 + 08:01): dedupe deixa 1 batida → incompleto', () => {
    expect(splitDayMinutes(['07:59', '08:01'], WED, false)).toEqual({ normal: 0, premium: 0, incomplete: true });
  });

  it('dedupe que tornaria PAR→ÍMPAR preserva o dia (12:04 = volta do almoço, não repique)', () => {
    // [08:00,12:00,12:04,18:00]: 12:04 está <5min de 12:00, mas descartá-lo
    // deixaria 3 batidas → 0h/pendente. Como o conjunto original é PAR ≥4, o
    // dedupe é ignorado e o dia pareia normal: (08→12)+(12:04→18) − almoço = 540.
    const r = splitDayMinutes(['08:00', '12:00', '12:04', '18:00'], WED, false);
    expect(r).toEqual({ normal: 540, premium: 0, incomplete: false });
  });

  it('batidas fora de ordem são ordenadas antes de parear (relógio pode entregar desordenado)', () => {
    // [18:00,08:00,13:00,12:00] → ordena → [08,12,13,18] = (08→12)+(13→18) = 540.
    const r = splitDayMinutes(['18:00', '08:00', '13:00', '12:00'], WED, false);
    expect(r).toEqual({ normal: 540, premium: 0, incomplete: false });
  });

  it('gap de exatamente 5 min NÃO deduplica (almoço curto continua valendo)', () => {
    // 13:00→13:05 = 5 min ≥ 5 → mantida (mesma regra ABS ≥ 5 do SQL).
    const r = splitDayMinutes(['08:01', '13:00', '13:05', '18:00'], WED, false);
    expect(r.normal).toBe(539);
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

  it('dia com batida ímpar NÃO entra no cálculo, só conta pro alerta (resolve no Pendências)', () => {
    const r = calculateHourlyPayroll(2200, [day('2026-06-03', WED, ['08:00', '13:00', '18:00'])], 0);
    expect(r.incomplete_days).toBe(1);
    expect(r.normal_minutes).toBe(0); // ímpar fica de fora; antes contava 540
    expect(r.gross_value).toBe(0);
  });
});

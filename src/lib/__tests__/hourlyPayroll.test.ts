import { describe, it, expect } from 'vitest';
import { splitDayMinutes, calculateHourlyPayroll, type HourlyDayInput } from '../hourlyPayroll';

// Folha por hora trabalhada. Trava a regra (atualizada 2026-10-19):
// VH = salário/220; 1,5× após 18h / sáb / dom / feriado; não acumula;
// par ≥4 e n=2 turno parcial pagam; n=2 jornada cheia / 1 / 3 / ímpar ≥5 = pendência.
const WED = 3, SAT = 6, SUN = 0;

describe('splitDayMinutes', () => {
  it('4 batidas completas (dia útil): almoço sai no gap → 9h normal', () => {
    const r = splitDayMinutes(['08:00', '12:00', '13:00', '18:00'], WED, false);
    expect(r).toEqual({ normal: 540, premium: 0, incomplete: false });
  });

  it('n=3 (qualquer) vira pendência — decisão 2026-10-17', () => {
    expect(splitDayMinutes(['08:00', '13:00', '18:00'], WED, false))
      .toEqual({ normal: 0, premium: 0, incomplete: true });
    expect(splitDayMinutes(['08:00', '13:00', '21:28'], WED, false).incomplete).toBe(true);
    expect(splitDayMinutes(['08:00', '12:00', '13:00'], WED, false))
      .toEqual({ normal: 0, premium: 0, incomplete: true });
  });

  it('ímpar ≥5 continua pendência — decisão 2026-07-30 intacta', () => {
    const cincoBatidas = splitDayMinutes(['08:00', '12:00', '13:00', '18:00', '20:00'], WED, false);
    expect(cincoBatidas).toEqual({ normal: 0, premium: 0, incomplete: true });
    expect(splitDayMinutes(['08:06', '12:01', '12:59', '18:09', '20:09'], WED, false).incomplete).toBe(true);
  });

  it('hora que não existe no relógio vira pendência, nunca pagamento', () => {
    expect(splitDayMinutes(['08:00', '29:59'], WED, false)).toEqual({ normal: 0, premium: 0, incomplete: true });
    expect(splitDayMinutes(['08:00', '12:75'], WED, false).incomplete).toBe(true);
    // Jornada cheia com * ainda é pendência (faltam marcas de almoço).
    expect(splitDayMinutes(['08:00', '18:00*'], WED, false).incomplete).toBe(true);
  });

  it('n=2 jornada cheia (cruza almoço) continua pendência — sem inferir 12:00/13:00', () => {
    expect(splitDayMinutes(['08:00', '18:00'], WED, false))
      .toEqual({ normal: 0, premium: 0, incomplete: true });
    expect(splitDayMinutes(['08:00', '13:00'], WED, false).incomplete).toBe(true);
    expect(splitDayMinutes(['08:01', '20:15'], WED, false).incomplete).toBe(true);
  });

  it('n=2 turno parcial (só tarde / só manhã) PAGA o par — Mariane 19/10/2026', () => {
    // Só tarde: 13:06→18:06 = 5h (4h54 normal + 6min premium após 18h).
    expect(splitDayMinutes(['13:06', '18:06'], WED, false)).toEqual({
      normal: 294, premium: 6, incomplete: false,
    });
    // Só manhã: 08:00→12:00 = 4h, sem almoço fantasma.
    expect(splitDayMinutes(['08:00', '12:00'], WED, false)).toEqual({
      normal: 240, premium: 0, incomplete: false,
    });
  });

  it('vai até 20h (completo 4 batidas): 9h normal + 2h após 18h a 1,5×', () => {
    const r = splitDayMinutes(['08:00', '12:00', '13:00', '20:00'], WED, false);
    expect(r).toEqual({ normal: 540, premium: 120, incomplete: false });
  });

  it('sábado: n=2 jornada cheia pendência; n=2 parcial e n=4 pagam em 1,5×', () => {
    expect(splitDayMinutes(['08:00', '18:00'], SAT, false).incomplete).toBe(true);
    expect(splitDayMinutes(['13:00', '18:00'], SAT, false))
      .toEqual({ normal: 0, premium: 300, incomplete: false });
    expect(splitDayMinutes(['08:00', '12:00', '13:00', '18:00'], SAT, false))
      .toEqual({ normal: 0, premium: 540, incomplete: false });
  });

  it('domingo completo: 9h premium (almoço no gap)', () => {
    expect(splitDayMinutes(['08:00', '12:00', '13:00', '18:00'], SUN, false)).toEqual({ normal: 0, premium: 540, incomplete: false });
  });

  it('feriado n=3 é pendência (não paga)', () => {
    const r = splitDayMinutes(['08:00', '13:00', '18:00'], WED, true);
    expect(r).toEqual({ normal: 0, premium: 0, incomplete: true });
  });

  it('tolera batida assumida com * e minutos não-zero (12:37*, 18:00*)', () => {
    const r = splitDayMinutes(['08:00', '12:37*', '13:00', '18:00*'], WED, false);
    expect(r.normal).toBe(540);
    expect(r.premium).toBe(0);
  });

  it('almoço curto batido (Quesia: 13:00→13:05 = 5min) é completado pra 1h → 8h59', () => {
    const r = splitDayMinutes(['08:01', '13:00', '13:05', '18:00'], WED, false);
    expect(r.normal).toBe(539);
    expect(r.premium).toBe(0);
  });

  it('pausa LONGA batida (08/11/15/18 = saiu 4h no meio) usa a real, sem forçar 1h → 6h', () => {
    const r = splitDayMinutes(['08:00', '11:00', '15:00', '18:00'], WED, false);
    expect(r.normal).toBe(360);
    expect(r.premium).toBe(0);
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

  it('hora 1,5×: sábado de 9h (4 batidas) com VH 10 = R$ 135', () => {
    const r = calculateHourlyPayroll(2200, [day('2026-06-06', SAT, ['08:00', '12:00', '13:00', '18:00'])], 0);
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

  it('dia com 3 batidas NÃO entra no cálculo — resolve no Pendências', () => {
    const r = calculateHourlyPayroll(2200, [day('2026-06-03', WED, ['08:00', '13:00', '18:00'])], 0);
    expect(r.incomplete_days).toBe(1);
    expect(r.normal_minutes).toBe(0);
    expect(r.gross_value).toBe(0);
  });

  it('ímpar ≥5 NÃO entra no cálculo, só conta pro alerta (resolve no Pendências)', () => {
    const r = calculateHourlyPayroll(2200, [day('2026-06-03', WED, ['08:00', '12:00', '13:00', '18:00', '20:00'])], 0);
    expect(r.incomplete_days).toBe(1);
    expect(r.normal_minutes).toBe(0);
    expect(r.gross_value).toBe(0);
  });
});

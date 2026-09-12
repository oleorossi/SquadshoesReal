import { describe, expect, it } from 'vitest';
import {
  interpretThreePunches,
  interpretDayPunches,
  looksLikeWeekdayJourney,
  sortedPunchMinutes,
  threePunchesStayPending,
  mapThreePunchesToNamedSlots,
  shouldSuggestFinalExit,
  LUNCH_START_MIN,
  LUNCH_END_MIN,
  WEEKDAY_JOURNEY_MIN,
} from './interpretDayPunches';

describe('interpretThreePunches', () => {
  it('31/08 — volta ~13h e saída ~18h30: falta só a saída do almoço', () => {
    const mins = sortedPunchMinutes(['08:18', '12:58', '18:03'])!;
    const r = interpretThreePunches(mins);
    expect(r.incomplete).toBe(false);
    expect(r.kind).toBe('missing_lunch_out');
    expect(r.intervals).toEqual([
      [8 * 60 + 18, LUNCH_START_MIN],
      [12 * 60 + 58, 18 * 60 + 3],
    ]);
  });

  it('22/08 — volta 13h e saída 21h28: tarde conta, inclusive HE após 18h', () => {
    const mins = sortedPunchMinutes(['08:22', '13:00', '21:28'])!;
    const r = interpretThreePunches(mins);
    expect(r.incomplete).toBe(false);
    expect(r.kind).toBe('missing_lunch_out');
    expect(r.intervals).toEqual([
      [8 * 60 + 22, LUNCH_START_MIN],
      [13 * 60, 21 * 60 + 28],
    ]);
  });

  it('padrão canônico 08/13/18: entrada, volta, saída — infere 12:00', () => {
    const r = interpretThreePunches([8 * 60, 13 * 60, 18 * 60]);
    expect(r).toEqual({
      kind: 'missing_lunch_out',
      incomplete: false,
      intervals: [[8 * 60, LUNCH_START_MIN], [13 * 60, 18 * 60]],
    });
  });

  it('meio-dia cedo (12:00) é saída de almoço — infere volta 13:00', () => {
    const r = interpretThreePunches([8 * 60, 12 * 60, 18 * 60]);
    expect(r.kind).toBe('missing_lunch_return');
    expect(r.incomplete).toBe(false);
    expect(r.intervals).toEqual([
      [8 * 60, 12 * 60],
      [LUNCH_END_MIN, 18 * 60],
    ]);
  });

  it('última batida ainda no almoço: falta a saída final (pendência)', () => {
    const r = interpretThreePunches([8 * 60, 12 * 60, 13 * 60]);
    expect(r.kind).toBe('missing_final_exit');
    expect(r.incomplete).toBe(true);
    expect(r.intervals).toEqual([]);
  });

  it('tolera * de batida manual', () => {
    expect(interpretDayPunches(['08:00*', '13:00', '18:30*'])?.kind).toBe('missing_lunch_out');
  });
});

describe('looksLikeWeekdayJourney', () => {
  it('22/08 08:01→18:25 é jornada de dia útil (HE só o excedente das 9h)', () => {
    expect(looksLikeWeekdayJourney(['08:01', '12:00', '13:00', '18:25'])).toBe(true);
    expect(looksLikeWeekdayJourney(['08:01', '18:25'])).toBe(true);
    expect(WEEKDAY_JOURNEY_MIN).toBe(540);
  });

  it('sábado só de manhã NÃO é jornada de 9h — continua crédito integral', () => {
    expect(looksLikeWeekdayJourney(['08:10', '11:51'])).toBe(false);
    expect(looksLikeWeekdayJourney(['08:00', '12:00'])).toBe(false);
  });

  it('domingo 09:45–17:48 (saiu antes das 18h) não vira jornada de 9h', () => {
    expect(looksLikeWeekdayJourney(['09:45', '17:48'])).toBe(false);
  });
});

describe('mapThreePunchesToNamedSlots', () => {
  it('31/08 — volta ~13h vai em Volta, saída real em Saída (almoço vazio)', () => {
    expect(mapThreePunchesToNamedSlots(['08:18', '12:58', '18:03'])).toEqual({
      entrada: '08:18',
      saidaAlmoco: '',
      voltaAlmoco: '12:58',
      saida: '18:03',
    });
  });

  it('saída de almoço 12:00 — Volta vazia, Saída preenchida', () => {
    expect(mapThreePunchesToNamedSlots(['08:00', '12:00', '18:00'])).toEqual({
      entrada: '08:00',
      saidaAlmoco: '12:00',
      voltaAlmoco: '',
      saida: '18:00',
    });
  });

  it('ainda no almoço — posicional (falta saída)', () => {
    expect(mapThreePunchesToNamedSlots(['08:00', '12:00', '13:00'])).toEqual({
      entrada: '08:00',
      saidaAlmoco: '12:00',
      voltaAlmoco: '13:00',
      saida: '',
    });
  });
});

describe('shouldSuggestFinalExit', () => {
  it('não sugere 18:00 quando a última já é a saída', () => {
    expect(shouldSuggestFinalExit(['08:18', '12:58', '18:03'])).toBe(false);
    expect(shouldSuggestFinalExit(['08:22', '13:00', '21:28'])).toBe(false);
  });

  it('sugere quando falta a saída ou não é o padrão de 3 batidas', () => {
    expect(shouldSuggestFinalExit(['08:00', '12:00', '13:00'])).toBe(true);
    expect(shouldSuggestFinalExit(['08:00'])).toBe(true);
    expect(shouldSuggestFinalExit(['08:00', '18:00'])).toBe(true);
  });
});

describe('threePunchesStayPending', () => {
  it('sai da fila quando a última batida já é a saída', () => {
    expect(threePunchesStayPending(['08:18', '12:58', '18:03'])).toBe(false);
    expect(threePunchesStayPending(['08:22', '13:00', '21:28'])).toBe(false);
  });

  it('fica na fila quando falta a saída final', () => {
    expect(threePunchesStayPending(['08:00', '12:00', '13:00'])).toBe(true);
    expect(threePunchesStayPending(['08:00'])).toBe(true);
  });
});

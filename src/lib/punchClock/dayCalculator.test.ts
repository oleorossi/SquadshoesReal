/**
 * Tests pro dayCalculator.
 *
 * Casos derivados do MODELO Calculo_Horas_Ponto_MODELO.xlsx (planejamento
 * de migração 2026-05). Cobrem os 5 status do plano + tolerância CLT.
 */

import { describe, it, expect } from 'vitest';
import { calculateDay, timeToMinutes, minutesToHhMm } from './dayCalculator';

describe('timeToMinutes', () => {
  it('converte HH:MM corretamente', () => {
    expect(timeToMinutes('08:00')).toBe(480);
    expect(timeToMinutes('12:30')).toBe(750);
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('retorna NaN pra entrada inválida', () => {
    expect(Number.isNaN(timeToMinutes(''))).toBe(true);
    expect(Number.isNaN(timeToMinutes('25:00'))).toBe(true);
    expect(Number.isNaN(timeToMinutes('08:60'))).toBe(true);
    expect(Number.isNaN(timeToMinutes('lixo' as any))).toBe(true);
  });
});

describe('minutesToHhMm', () => {
  it('formata minutos pra HH:MM', () => {
    expect(minutesToHhMm(480)).toBe('08:00');
    expect(minutesToHhMm(60)).toBe('01:00');
    expect(minutesToHhMm(0)).toBe('00:00');
  });

  it('prefixa "-" pra negativo', () => {
    expect(minutesToHhMm(-30)).toBe('-00:30');
    expect(minutesToHhMm(-180)).toBe('-03:00');
  });
});

describe('calculateDay — DSR (domingo)', () => {
  it('domingo sem batidas = DSR', () => {
    const r = calculateDay({ punches: [], dayOfWeek: 0 });
    expect(r.status).toBe('DSR');
    expect(r.workedMinutes).toBe(0);
    expect(r.expectedMinutes).toBe(0);
    expect(r.missingMinutes).toBe(0);
  });

  it('domingo com batidas (excepcional) — ainda DSR pro cálculo, mas retorna 0', () => {
    const r = calculateDay({ punches: ['08:00', '18:00'], dayOfWeek: 0 });
    expect(r.status).toBe('DSR');
    expect(r.workedMinutes).toBe(0);
  });
});

describe('calculateDay — FALTA (dia útil sem batidas)', () => {
  it('segunda sem batidas = FALTA, faltante = jornada esperada', () => {
    const r = calculateDay({ punches: [], dayOfWeek: 1 });
    expect(r.status).toBe('FALTA');
    expect(r.workedMinutes).toBe(0);
    expect(r.expectedMinutes).toBe(480);
    expect(r.missingMinutes).toBe(480);
    expect(r.detail).toBe('Sem batidas');
  });

  it('sábado sem batidas = FALTA com expected 240', () => {
    const r = calculateDay({ punches: [], dayOfWeek: 6 });
    expect(r.status).toBe('FALTA');
    expect(r.expectedMinutes).toBe(240);
    expect(r.missingMinutes).toBe(240);
  });
});

describe('calculateDay — IRREGULAR (batidas ímpares ou 1)', () => {
  it('1 batida = IRREGULAR', () => {
    const r = calculateDay({ punches: ['18:40'], dayOfWeek: 6 });
    expect(r.status).toBe('IRREGULAR');
    expect(r.workedMinutes).toBe(0);
    expect(r.missingMinutes).toBe(240);
    expect(r.detail).toContain('18:40');
  });

  it('3 batidas = IRREGULAR (caso valdilene 05/05/2026)', () => {
    const r = calculateDay({
      punches: ['08:15', '12:08', '18:19'],
      dayOfWeek: 2, // Ter
    });
    expect(r.status).toBe('IRREGULAR');
    expect(r.workedMinutes).toBe(0);
    expect(r.missingMinutes).toBe(480);
  });

  it('5 batidas = IRREGULAR', () => {
    const r = calculateDay({
      punches: ['07:45', '12:00', '13:00', '18:00', '18:30'],
      dayOfWeek: 1,
    });
    expect(r.status).toBe('IRREGULAR');
  });
});

describe('calculateDay — INCONSISTENTE (2 batidas em dia útil)', () => {
  it('segunda com 2 batidas = INCONSISTENTE (caso antonio 04/05/2026)', () => {
    const r = calculateDay({
      punches: ['07:55', '14:34'],
      dayOfWeek: 1,
    });
    expect(r.status).toBe('INCONSISTENTE');
    expect(r.workedMinutes).toBe(0);
    expect(r.missingMinutes).toBe(480);
    expect(r.detail).toContain('esqueceu almoço');
  });

  it('quarta com 2 batidas = INCONSISTENTE', () => {
    const r = calculateDay({ punches: ['08:00', '18:00'], dayOfWeek: 3 });
    expect(r.status).toBe('INCONSISTENTE');
  });
});

describe('calculateDay — OK em sábado com 2 batidas (jornada contínua)', () => {
  it('sábado 08:00-12:00 = OK, 240min trabalhados', () => {
    const r = calculateDay({
      punches: ['08:00', '12:00'],
      dayOfWeek: 6,
    });
    expect(r.status).toBe('OK');
    expect(r.workedMinutes).toBe(240);
    expect(r.expectedMinutes).toBe(240);
    expect(r.missingMinutes).toBe(0);
  });

  it('sábado 08:00-11:55 = OK com tolerância 10min (faltante 5min vira 0)', () => {
    const r = calculateDay({
      punches: ['08:00', '11:55'],
      dayOfWeek: 6,
    });
    expect(r.status).toBe('OK');
    expect(r.workedMinutes).toBe(235);
    expect(r.missingMinutes).toBe(0);
  });

  it('sábado 08:00-11:45 = OK SEM tolerância (faltante 15min > 10)', () => {
    const r = calculateDay({
      punches: ['08:00', '11:45'],
      dayOfWeek: 6,
    });
    expect(r.status).toBe('OK');
    expect(r.workedMinutes).toBe(225);
    expect(r.missingMinutes).toBe(15);
  });
});

describe('calculateDay — OK em dia útil (4 batidas, com almoço)', () => {
  it('caso valdilene 04/05/2026 (Seg, 08:15/12:03/13:06/18:08) = OK 08:50', () => {
    const r = calculateDay({
      punches: ['08:15', '12:03', '13:06', '18:08'],
      dayOfWeek: 1,
    });
    expect(r.status).toBe('OK');
    // (12:03 - 08:15) + (18:08 - 13:06) = 228 + 302 = 530min = 8h50min
    expect(r.workedMinutes).toBe(530);
    expect(r.expectedMinutes).toBe(480);
    // Trabalhou mais do que esperado → 0 faltante
    expect(r.missingMinutes).toBe(0);
  });

  it('caso erick 13/05/2026 — entrada 08:06, saída 16:52 (incompleto registrado) - aqui 2 batidas = INCONSISTENTE', () => {
    // No exemplo do espelho-ponto, esse dia mostra Entrada 08:06 / Saída 16:52
    // mas sem volta de almoço — só 2 batidas. É INCONSISTENTE.
    const r = calculateDay({
      punches: ['08:06', '16:52'],
      dayOfWeek: 3,
    });
    expect(r.status).toBe('INCONSISTENTE');
    expect(r.missingMinutes).toBe(480);
  });
});

describe('calculateDay — tolerância CLT (art. 58 §1º)', () => {
  it('faltante exatamente igual à tolerância (10min) zera', () => {
    // 08:00→12:00 (240min) + 13:00→16:50 (230min) = 470min. Faltante 10 → 0.
    const r = calculateDay({
      punches: ['08:00', '12:00', '13:00', '16:50'],
      dayOfWeek: 1,
    });
    expect(r.status).toBe('OK');
    expect(r.workedMinutes).toBe(470);
    expect(r.missingMinutes).toBe(0);
  });

  it('faltante 11min NÃO zera (acima da tolerância)', () => {
    // 08:00→12:00 (240min) + 13:00→16:49 (229min) = 469min. Faltante 11 → 11.
    const r = calculateDay({
      punches: ['08:00', '12:00', '13:00', '16:49'],
      dayOfWeek: 1,
    });
    expect(r.status).toBe('OK');
    expect(r.workedMinutes).toBe(469);
    expect(r.missingMinutes).toBe(11);
  });

  it('tolerância parametrizável — 5min', () => {
    // 08:00→12:00 (240) + 13:00→16:52 (232) = 472min. Faltante 8: c/ tol 10 zera, c/ tol 5 não.
    const r = calculateDay({
      punches: ['08:00', '12:00', '13:00', '16:52'],
      dayOfWeek: 1,
      toleranceMinutes: 5,
    });
    expect(r.workedMinutes).toBe(472);
    expect(r.missingMinutes).toBe(8);
  });
});

describe('calculateDay — batidas fora de ordem (parser robusto)', () => {
  it('batidas em ordem invertida são ordenadas internamente', () => {
    const r = calculateDay({
      punches: ['18:00', '08:00', '13:00', '12:00'],
      dayOfWeek: 1,
    });
    expect(r.status).toBe('OK');
    // (12:00 - 08:00) + (18:00 - 13:00) = 240 + 300 = 540min = 9h
    expect(r.workedMinutes).toBe(540);
  });

  it('ignora batidas inválidas', () => {
    const r = calculateDay({
      punches: ['08:00', 'lixo', '12:00', '13:00', '18:00'],
      dayOfWeek: 1,
    });
    // 4 batidas válidas após filter → OK
    expect(r.status).toBe('OK');
    expect(r.sortedPunches.length).toBe(4);
  });
});

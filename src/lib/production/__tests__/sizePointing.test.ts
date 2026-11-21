import { describe, expect, it } from 'vitest';
import {
  clampSizeQuantity,
  formatSizeBreakdown,
  knownSizesFromPointings,
  negateSizeBreakdown,
  pointingSizeBalance,
  scaleSizesToTotal,
  sizeBreakdownFromEntries,
  sizeLaunchMeter,
} from '../sizePointing';

describe('lançamento por numeração', () => {
  it('mostra 60/15 quando o 34 tem 75 e o operador digita 60', () => {
    const meter = sizeLaunchMeter(60, 75);
    expect(meter).toMatchObject({ launched: 60, falta: 15, done: false, over: false });
  });

  it('marca concluído quando a falta zera e bloqueia acima do saldo', () => {
    expect(sizeLaunchMeter(75, 75)).toMatchObject({ falta: 0, done: true, over: false });
    expect(sizeLaunchMeter(76, 75)).toMatchObject({ over: true, done: false });
    expect(clampSizeQuantity(76, 75)).toBe(75);
    expect(clampSizeQuantity(-3, 75)).toBe(0);
  });

  it('desconta lançamento anterior por número antes de pré-preencher', () => {
    const balance = pointingSizeBalance({
      grade: { '34': 75, '35': 25 },
      quantityTotal: 100,
      quantityProcessed: 15,
      known: { '34': 15 },
      launchablePairs: 85,
    });
    expect(balance.pending).toEqual({ '34': 60, '35': 25 });
    expect(balance.legacyUnallocated).toBe(0);
    expect(balance.sizes).toEqual(['34', '35']);
  });

  it('distribui pares antigos sem numeração pela curva até fechar o saldo', () => {
    const balance = pointingSizeBalance({
      grade: { '34': 75, '35': 25 },
      quantityTotal: 100,
      quantityProcessed: 20,
      known: {},
      launchablePairs: 80,
    });
    expect(balance.legacyUnallocated).toBe(20);
    expect(balance.pending['34'] + balance.pending['35']).toBe(80);
    expect(balance.pending['34']).toBeGreaterThan(balance.pending['35']);
  });

  it('não oferece mais pares do que o setor anterior já liberou', () => {
    const balance = pointingSizeBalance({
      grade: { '34': 75, '35': 25 },
      quantityTotal: 100,
      quantityProcessed: 0,
      known: {},
      launchablePairs: 40,
    });
    expect(sum(balance.pending)).toBe(40);
    expect(balance.pending['34']).toBeLessThanOrEqual(75);
    expect(balance.pending['35']).toBeLessThanOrEqual(25);
  });

  it('soma a grade líquida só do setor apontado', () => {
    const known = knownSizesFromPointings(
      [
        { stage_name: 'Palmilha · Fibra', size_breakdown: { '34': 10, '35': 4 } },
        { stage_name: 'Corte Fibra', size_breakdown: { '34': -2 } },
        { stage_name: 'Montagem', size_breakdown: { '34': 99 } },
      ],
      'Corte Palmilha',
      (a, b) => a.replace('Corte Fibra', 'Palmilha · Fibra').replace('Corte Palmilha', 'Palmilha · Fibra')
        === b.replace('Corte Fibra', 'Palmilha · Fibra').replace('Corte Palmilha', 'Palmilha · Fibra'),
    );
    expect(known).toEqual({ '34': 8, '35': 4 });
  });

  it('grava só o que cabe e o total continua a soma dos números', () => {
    const breakdown = sizeBreakdownFromEntries(
      { '34': 80, '35': 12, '36': 0 },
      { '34': 75, '35': 12 },
    );
    expect(breakdown).toEqual({ '34': 75, '35': 12 });
    expect(sum(breakdown)).toBe(87);
    expect(negateSizeBreakdown(breakdown)).toEqual({ '34': -75, '35': -12 });
    expect(formatSizeBreakdown(breakdown)).toBe('34:75 · 35:12');
  });

  it('escala a grade da ficha para o total da OP sem perder par no arredondamento', () => {
    const scaled = scaleSizesToTotal({ '34': 2, '35': 1 }, 10);
    expect(sum(scaled)).toBe(10);
  });
});

function sum(grade: Record<string, number>): number {
  return Object.values(grade).reduce((acc, value) => acc + value, 0);
}

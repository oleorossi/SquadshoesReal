import { describe, expect, it } from 'vitest';
import {
  clampSizeQuantity,
  formatSizeBreakdown,
  knifeOverMessage,
  knifeRangePlan,
  knifeRangesForGrade,
  knownSizesFromPointings,
  negateSizeBreakdown,
  pointingSizeBalance,
  scaleSizesToTotal,
  sectorPointingMode,
  sizeBreakdownFromEntries,
  sizeLaunchMeter,
  KNIFE_RANGE_MISSING,
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

const RANGES = [
  { label: 'P', sizes: ['34', '35'] },
  { label: 'M', sizes: ['36', '37'] },
  { label: 'G', sizes: ['38', '39', '40'] },
];
const GRADE = { '34': 6, '35': 8, '36': 10, '37': 12, '38': 8, '39': 4, '40': 2, '41': 3 };

describe('lançamento por faixa de faca', () => {
  it('soma a grade da faixa e trata o número de fora como faixa extra', () => {
    const ranges = knifeRangesForGrade(RANGES, GRADE);
    expect(ranges?.map(range => range.label)).toEqual(['P', 'M', 'G', '41']);
    expect(ranges?.find(range => range.label === '41')?.extra).toBe(true);
    const plan = knifeRangePlan({
      grade: GRADE,
      rangesRaw: RANGES,
      quantityTotal: 53,
      quantityProcessed: 0,
      known: {},
      launchablePairs: 53,
      upstreamKnown: null,
    });
    expect(plan.mode).toBe('grid');
    expect(plan.balance?.target).toEqual({ P: 14, M: 22, G: 14, '41': 3 });
  });

  it('parcial P 4 deixa 10 e o fechamento zera a faixa', () => {
    const open = knifeRangePlan({
      grade: GRADE,
      rangesRaw: RANGES,
      quantityTotal: 53,
      quantityProcessed: 4,
      known: { P: 4 },
      launchablePairs: 49,
      upstreamKnown: null,
    });
    expect(open.balance?.pending.P).toBe(10);
    expect(open.balance?.known.P).toBe(4);
    const closed = knifeRangePlan({
      grade: GRADE,
      rangesRaw: RANGES,
      quantityTotal: 53,
      quantityProcessed: 14,
      known: { P: 14 },
      launchablePairs: 39,
      upstreamKnown: null,
    });
    expect(closed.balance?.pending.P).toBeUndefined();
    expect(closed.balance?.target.P).toBe(14);
  });

  it('bloqueia a mensagem quando a faixa passa do saldo', () => {
    expect(knifeOverMessage('P', 15, 12)).toBe('Faixa P: 15 passa o saldo de 12 pares.');
  });

  it('ficha sem faixa não monta grade', () => {
    for (const raw of [null, undefined, [], {}]) {
      const plan = knifeRangePlan({
        grade: GRADE,
        rangesRaw: raw,
        quantityTotal: 53,
        quantityProcessed: 0,
        known: {},
        launchablePairs: 53,
        upstreamKnown: null,
      });
      expect(plan.mode).toBe('total');
      expect(plan.warning).toBe(KNIFE_RANGE_MISSING);
    }
  });

  it('a costura não passa do que o corte já lançou na faixa', () => {
    const plan = knifeRangePlan({
      grade: GRADE,
      rangesRaw: RANGES,
      quantityTotal: 53,
      quantityProcessed: 0,
      known: {},
      launchablePairs: 53,
      upstreamKnown: { P: 4, M: 0 },
    });
    expect(plan.balance?.pending.P).toBe(4);
    expect(plan.balance?.pending.M).toBeUndefined();
    expect(plan.balance?.pending.G).toBeUndefined();
  });

  it('corte lançado só pelo total não trava a faixa da costura', () => {
    const plan = knifeRangePlan({
      grade: GRADE,
      rangesRaw: RANGES,
      quantityTotal: 53,
      quantityProcessed: 0,
      known: {},
      launchablePairs: 53,
      upstreamKnown: null,
    });
    expect(plan.balance?.pending.P).toBe(14);
  });

  it('o modo do setor distingue faixa e numeração', () => {
    const same = (a: string, b: string) => a === b;
    expect(sectorPointingMode([{ sector: 'Corte Cabedal', point_by_size_mode: 'knife_range' }], 'Corte Cabedal', same)).toBe('knife_range');
    expect(sectorPointingMode([{ sector: 'Palmilha · Fibra', point_by_size: true, point_by_size_mode: 'size' }], 'Palmilha · Fibra', same)).toBe('size');
    expect(sectorPointingMode([{ sector: 'Montagem', point_by_size_mode: 'total' }], 'Montagem', same)).toBeNull();
  });
});

function sum(grade: Record<string, number>): number {
  return Object.values(grade).reduce((acc, value) => acc + value, 0);
}

import { describe, it, expect } from 'vitest';
import {
  minutesPerPairFromCapacity,
  sectorCostPerPair,
  totalModPerPair,
  countActiveSectors,
  rowCost,
  DEFAULT_HOURS_PER_DAY,
  type SectorPricingRow,
} from '../sectorPricing';

describe('sectorCostPerPair', () => {
  it('1 setor: (tempo/60) × custo-hora', () => {
    // 6 min/par a R$ 12/h = 0,1 h × 12 = R$ 1,20
    expect(sectorCostPerPair(6, 12)).toBeCloseTo(1.2, 6);
  });

  it('30 min a R$ 10/h = R$ 5,00', () => {
    expect(sectorCostPerPair(30, 10)).toBeCloseTo(5, 6);
  });

  it('decimais: 2,5 min a R$ 13,64/h', () => {
    expect(sectorCostPerPair(2.5, 13.6364)).toBeCloseTo((2.5 / 60) * 13.6364, 6);
  });

  it('tempo 0 ⇒ custo 0', () => {
    expect(sectorCostPerPair(0, 50)).toBe(0);
  });

  it('custo-hora 0 ⇒ custo 0 (setor sem salário)', () => {
    expect(sectorCostPerPair(10, 0)).toBe(0);
  });

  it('negativos são clampados a 0', () => {
    expect(sectorCostPerPair(-5, 10)).toBe(0);
    expect(sectorCostPerPair(10, -10)).toBe(0);
  });

  it('entradas inválidas (NaN) ⇒ 0', () => {
    expect(sectorCostPerPair(Number.NaN, 10)).toBe(0);
    expect(sectorCostPerPair(10, Number.NaN)).toBe(0);
  });
});

describe('minutesPerPairFromCapacity', () => {
  it('200 pares/dia em 8h ⇒ 2,4 min/par', () => {
    // 8h × 60 = 480 min / 200 = 2,4
    expect(minutesPerPairFromCapacity(200)).toBeCloseTo(2.4, 6);
  });

  it('usa a jornada-padrão de 8h', () => {
    expect(DEFAULT_HOURS_PER_DAY).toBe(8);
    expect(minutesPerPairFromCapacity(480)).toBeCloseTo(1, 6); // 480/480 = 1 min/par
  });

  it('jornada custom: 100 pares em 10h ⇒ 6 min/par', () => {
    expect(minutesPerPairFromCapacity(100, 10)).toBeCloseTo(6, 6);
  });

  it('capacidade 0 ⇒ 0 (não dá pra derivar)', () => {
    expect(minutesPerPairFromCapacity(0)).toBe(0);
  });

  it('capacidade negativa/inválida ⇒ 0', () => {
    expect(minutesPerPairFromCapacity(-10)).toBe(0);
    expect(minutesPerPairFromCapacity(Number.NaN)).toBe(0);
  });

  it('round-trip: derivar tempo da capacidade e custar bate com o esperado', () => {
    // 240 pares/dia, 8h ⇒ 2 min/par; a R$ 15/h = R$ 0,50/par
    const t = minutesPerPairFromCapacity(240);
    expect(t).toBeCloseTo(2, 6);
    expect(sectorCostPerPair(t, 15)).toBeCloseTo(0.5, 6);
  });
});

describe('totalModPerPair', () => {
  const rows: SectorPricingRow[] = [
    { sectorKey: 'corte_palmilha', timePerPairMin: 3, costPerHour: 12 },   // 0,60
    { sectorKey: 'costura', timePerPairMin: 10, costPerHour: 13.5 },       // 2,25
    { sectorKey: 'montagem', timePerPairMin: 8, costPerHour: 15 },         // 2,00
  ];

  it('multi setor: soma das linhas', () => {
    const expected = (3 / 60) * 12 + (10 / 60) * 13.5 + (8 / 60) * 15;
    expect(totalModPerPair(rows)).toBeCloseTo(expected, 6);
    expect(totalModPerPair(rows)).toBeCloseTo(4.85, 6);
  });

  it('lista vazia ⇒ 0', () => {
    expect(totalModPerPair([])).toBe(0);
  });

  it('linhas zeradas (sem tempo ou sem custo) não quebram a soma', () => {
    const withZeros: SectorPricingRow[] = [
      ...rows,
      { sectorKey: 'silk', timePerPairMin: 0, costPerHour: 20 },    // 0
      { sectorKey: 'acabamento', timePerPairMin: 5, costPerHour: 0 }, // 0 (sem salário)
    ];
    expect(totalModPerPair(withZeros)).toBeCloseTo(4.85, 6);
  });

  it('é igual à soma de rowCost de cada linha', () => {
    const viaReduce = rows.reduce((a, r) => a + rowCost(r), 0);
    expect(totalModPerPair(rows)).toBeCloseTo(viaReduce, 9);
  });

  it('robusto a undefined/null', () => {
    expect(totalModPerPair(undefined as unknown as SectorPricingRow[])).toBe(0);
    expect(totalModPerPair(null as unknown as SectorPricingRow[])).toBe(0);
  });
});

describe('countActiveSectors', () => {
  it('conta só setores com custo > 0', () => {
    const rows: SectorPricingRow[] = [
      { sectorKey: 'corte_palmilha', timePerPairMin: 3, costPerHour: 12 }, // ativo
      { sectorKey: 'silk', timePerPairMin: 0, costPerHour: 20 },           // tempo 0
      { sectorKey: 'acabamento', timePerPairMin: 5, costPerHour: 0 },      // sem salário
      { sectorKey: 'costura', timePerPairMin: 10, costPerHour: 13.5 },     // ativo
    ];
    expect(countActiveSectors(rows)).toBe(2);
  });

  it('lista vazia ⇒ 0', () => {
    expect(countActiveSectors([])).toBe(0);
  });
});

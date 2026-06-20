import { describe, it, expect } from 'vitest';
import {
  pairsPerHourFromCapacity,
  sectorCostPerPair,
  totalModPerPair,
  countActiveSectors,
  rowCost,
  pairsPerDay,
  dailyRate,
  totalDailyRate,
  DEFAULT_HOURS_PER_DAY,
  type SectorPricingRow,
} from '../sectorPricing';

describe('sectorCostPerPair', () => {
  it('1 setor: custo-hora / pares-por-hora', () => {
    // R$ 12/h, 10 pares/h ⇒ R$ 1,20/par
    expect(sectorCostPerPair(10, 12)).toBeCloseTo(1.2, 6);
  });

  it('R$ 10/h a 2 pares/h ⇒ R$ 5,00/par', () => {
    expect(sectorCostPerPair(2, 10)).toBeCloseTo(5, 6);
  });

  it('decimais: 6,5 pares/h a R$ 13,64/h', () => {
    expect(sectorCostPerPair(6.5, 13.6364)).toBeCloseTo(13.6364 / 6.5, 6);
  });

  it('produtividade 0 ⇒ custo 0 (setor sem capacidade)', () => {
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

  it('equivalência com a fórmula antiga (min/par): pph=60/min preserva o custo', () => {
    // Antes: (min/60)×hora. Agora: hora/pph com pph=60/min ⇒ mesmo número.
    const min = 10, hora = 12;
    const pph = 60 / min;
    expect(sectorCostPerPair(pph, hora)).toBeCloseTo((min / 60) * hora, 9);
  });
});

describe('pairsPerHourFromCapacity', () => {
  it('200 pares/dia em 8h ⇒ 25 pares/h', () => {
    expect(pairsPerHourFromCapacity(200)).toBeCloseTo(25, 6);
  });

  it('usa a jornada-padrão de 8h', () => {
    expect(DEFAULT_HOURS_PER_DAY).toBe(8);
    expect(pairsPerHourFromCapacity(80)).toBeCloseTo(10, 6); // 80/8 = 10
  });

  it('jornada custom: 100 pares em 10h ⇒ 10 pares/h', () => {
    expect(pairsPerHourFromCapacity(100, 10)).toBeCloseTo(10, 6);
  });

  it('capacidade 0 ⇒ 0 (não dá pra derivar)', () => {
    expect(pairsPerHourFromCapacity(0)).toBe(0);
  });

  it('capacidade negativa/inválida ⇒ 0', () => {
    expect(pairsPerHourFromCapacity(-10)).toBe(0);
    expect(pairsPerHourFromCapacity(Number.NaN)).toBe(0);
  });

  it('round-trip: derivar pares/hora da capacidade e custar bate com o esperado', () => {
    // 240 pares/dia, 8h ⇒ 30 pares/h; a R$ 15/h ⇒ R$ 0,50/par
    const pph = pairsPerHourFromCapacity(240);
    expect(pph).toBeCloseTo(30, 6);
    expect(sectorCostPerPair(pph, 15)).toBeCloseTo(0.5, 6);
  });
});

describe('totalModPerPair', () => {
  const rows: SectorPricingRow[] = [
    { sectorKey: 'corte_palmilha', pairsPerHour: 20, costPerHour: 12 },  // 0,60
    { sectorKey: 'costura', pairsPerHour: 6, costPerHour: 13.5 },        // 2,25
    { sectorKey: 'montagem', pairsPerHour: 7.5, costPerHour: 15 },       // 2,00
  ];

  it('multi setor: soma das linhas', () => {
    const expected = 12 / 20 + 13.5 / 6 + 15 / 7.5;
    expect(totalModPerPair(rows)).toBeCloseTo(expected, 6);
    expect(totalModPerPair(rows)).toBeCloseTo(4.85, 6);
  });

  it('lista vazia ⇒ 0', () => {
    expect(totalModPerPair([])).toBe(0);
  });

  it('linhas zeradas (sem produtividade ou sem custo) não quebram a soma', () => {
    const withZeros: SectorPricingRow[] = [
      ...rows,
      { sectorKey: 'silk', pairsPerHour: 0, costPerHour: 20 },     // 0 (sem capacidade)
      { sectorKey: 'acabamento', pairsPerHour: 5, costPerHour: 0 }, // 0 (sem salário)
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

describe('pairsPerDay', () => {
  it('pares/dia = pares/hora × 8h', () => {
    expect(pairsPerDay(10)).toBeCloseTo(80, 6);
    expect(pairsPerDay(25)).toBeCloseTo(200, 6);
  });

  it('jornada custom', () => {
    expect(pairsPerDay(10, 10)).toBeCloseTo(100, 6);
  });

  it('produtividade 0/negativa/NaN ⇒ 0', () => {
    expect(pairsPerDay(0)).toBe(0);
    expect(pairsPerDay(-5)).toBe(0);
    expect(pairsPerDay(Number.NaN)).toBe(0);
  });
});

describe('dailyRate', () => {
  it('diária = custo-hora × 8h', () => {
    expect(dailyRate(12)).toBeCloseTo(96, 6);
    expect(dailyRate(15)).toBeCloseTo(120, 6);
  });

  it('jornada custom', () => {
    expect(dailyRate(15, 10)).toBeCloseTo(150, 6);
  });

  it('custo-hora 0 ⇒ diária 0', () => {
    expect(dailyRate(0)).toBe(0);
  });

  it('independe da produtividade (só custo-hora)', () => {
    // diária não usa pares/hora — é custo_hora × jornada
    expect(dailyRate(20)).toBeCloseTo(160, 6);
  });
});

describe('totalDailyRate', () => {
  const rows: SectorPricingRow[] = [
    { sectorKey: 'corte_palmilha', pairsPerHour: 20, costPerHour: 12 },  // ativo → 96
    { sectorKey: 'costura', pairsPerHour: 6, costPerHour: 15 },          // ativo → 120
    { sectorKey: 'silk', pairsPerHour: 0, costPerHour: 30 },             // sem capacidade → ignora
    { sectorKey: 'montagem', pairsPerHour: 5, costPerHour: 0 },          // ativo mas sem salário → 0
  ];

  it('soma as diárias só dos setores com capacidade > 0', () => {
    // 12×8 + 15×8 + (silk ignorado) + 0×8 = 96 + 120 + 0 = 216
    expect(totalDailyRate(rows)).toBeCloseTo(216, 6);
  });

  it('jornada custom propaga', () => {
    expect(totalDailyRate(rows, 10)).toBeCloseTo(12 * 10 + 15 * 10, 6);
  });

  it('lista vazia / sem capacidade ⇒ 0', () => {
    expect(totalDailyRate([])).toBe(0);
    expect(totalDailyRate([{ sectorKey: 'silk', pairsPerHour: 0, costPerHour: 30 }])).toBe(0);
  });

  it('robusto a undefined/null', () => {
    expect(totalDailyRate(undefined as unknown as SectorPricingRow[])).toBe(0);
    expect(totalDailyRate(null as unknown as SectorPricingRow[])).toBe(0);
  });
});

describe('countActiveSectors', () => {
  it('conta só setores com custo > 0', () => {
    const rows: SectorPricingRow[] = [
      { sectorKey: 'corte_palmilha', pairsPerHour: 20, costPerHour: 12 }, // ativo
      { sectorKey: 'silk', pairsPerHour: 0, costPerHour: 20 },            // sem capacidade
      { sectorKey: 'acabamento', pairsPerHour: 5, costPerHour: 0 },       // sem salário
      { sectorKey: 'costura', pairsPerHour: 6, costPerHour: 13.5 },       // ativo
    ];
    expect(countActiveSectors(rows)).toBe(2);
  });

  it('lista vazia ⇒ 0', () => {
    expect(countActiveSectors([])).toBe(0);
  });
});

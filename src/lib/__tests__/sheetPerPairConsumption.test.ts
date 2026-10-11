import { describe, expect, it } from 'vitest';
import {
  computePerPairConsumption,
  isExcludedFromPerPair,
  medianPrice,
  resolvePerPairCost,
  summarizePerPairCost,
  type PerPairSource,
} from '@/lib/sheetPerPairConsumption';

const napaSheet = { dimensions_width: 1370, dimensions_unit: 'mm', products: { unit: 'm' } };

const src = (over: Partial<PerPairSource>): PerPairSource => ({
  component: 'Cabedal',
  material: 'NAPA SOFT',
  category: 'Cabedal',
  stockUnit: 'm',
  inputUnit: 'dm2',
  componentSheet: napaSheet,
  scalar: 0,
  perSize: null,
  ...over,
});

describe('computePerPairConsumption', () => {
  it('converte dm²/par → m/par pela largura da ficha de componente', () => {
    const [row] = computePerPairConsumption([src({ scalar: 13.7 })], ['34']);
    expect(row.unit).toBe('m');
    expect(row.average).toBeCloseTo(0.1, 6);
    expect(row.widthMissing).toBe(false);
  });

  it('sem largura fica em dm² e marca widthMissing', () => {
    const [row] = computePerPairConsumption([src({ scalar: 10, componentSheet: null })], ['34']);
    expect(row.unit).toBe('dm²');
    expect(row.average).toBe(10);
    expect(row.widthMissing).toBe(true);
  });

  it('média só nas numerações da grade da ficha', () => {
    const [row] = computePerPairConsumption(
      [src({ inputUnit: 'stock', stockUnit: 'un', perSize: { '28': 2, '29': 4, '40': 100 } })],
      ['28', '29'],
    );
    expect(row.average).toBe(3);
    expect(row.perSize).toEqual({ '28': 2, '29': 4 });
  });

  it('numeração sem valor cai no escalar', () => {
    const [row] = computePerPairConsumption(
      [src({ inputUnit: 'stock', stockUnit: 'un', scalar: 1, perSize: { '28': 3 } })],
      ['28', '29'],
    );
    expect(row.perSize).toEqual({ '28': 3, '29': 1 });
    expect(row.average).toBe(2);
  });

  it('tira: cm/PAR → m/par sem dividir por 2 (o ÷2 é só do input por pé)', () => {
    const [row] = computePerPairConsumption(
      [src({ component: 'Tiras', material: 'TIRA CHATA · 8 mm', category: null, inputUnit: 'stock', stockUnit: 'm', scale: 0.01, perSize: { '34': 60 } })],
      ['34'],
    );
    expect(row.unit).toBe('m');
    expect(row.average).toBeCloseTo(0.6, 6);
  });

  it('soma o mesmo material vindo de componentes diferentes', () => {
    const rows = computePerPairConsumption(
      [src({ scalar: 13.7 }), src({ component: 'Material extra', scalar: 27.4 })],
      ['34'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].average).toBeCloseTo(0.3, 6);
    expect(rows[0].components).toEqual(['Cabedal', 'Material extra']);
  });

  it('sem grade usa o escalar', () => {
    const [row] = computePerPairConsumption([src({ component: 'Componente', inputUnit: 'stock', stockUnit: 'un', scalar: 1, material: 'Fivela 12mm', category: 'Componente' })], []);
    expect(row.average).toBe(1);
  });

  it('descarta linha zerada', () => {
    expect(computePerPairConsumption([src({ scalar: 0 })], ['34'])).toEqual([]);
  });
});

describe('isExcludedFromPerPair', () => {
  it.each([
    [{ component: 'Forração', material: 'NAPA FORRO', category: 'Cabedal' }],
    [{ component: 'BOM', material: 'NAPA FORRO', category: 'Forração da Palmilha' }],
    [{ component: 'BOM', material: 'COLA PU', category: 'Cola / Químico' }],
    [{ component: 'Palmilha', material: 'PLACA FIBRA 2MM', category: 'Palmilha' }],
    [{ component: 'BOM', material: 'Fibra Látex', category: 'Material Base' }],
  ])('exclui %o', (source) => {
    expect(isExcludedFromPerPair(source)).toBe(true);
  });

  // Revisão 2 (dono, 11/10/2026): básicos comuns a todo modelo saem.
  it.each([
    [{ component: 'Solado', material: 'SOLADO 01', category: 'Solado' }],
    [{ component: 'Palmilha', material: 'PALMILHA', category: 'Palmilha' }],
    [{ component: 'BOM', material: 'PALMILHA EVA', category: 'Palmilha' }],
    // Cadastrados como `Componente` — escapavam do filtro por setor.
    [{ component: 'BOM', material: 'COLA FORTE', category: 'Componente' }],
    [{ component: 'BOM', material: 'COLA PVC', category: 'Componente' }],
    [{ component: 'BOM', material: 'LINHANYL', category: 'Componente' }],
    [{ component: 'BOM', material: 'EMBALAGEM', category: 'Componente' }],
  ])('exclui básico %o', (source) => {
    expect(isExcludedFromPerPair(source)).toBe(true);
  });

  it('mantém cabedal, tira, fivela e material com COLA dentro de outra palavra', () => {
    expect(isExcludedFromPerPair({ component: 'Cabedal', material: 'NAPA SOFT', category: 'Cabedal' })).toBe(false);
    expect(isExcludedFromPerPair({ component: 'Tiras', material: 'TIRA CHATA', category: null })).toBe(false);
    expect(isExcludedFromPerPair({ component: 'Componente', material: 'Fivela 12mm', category: 'Componente' })).toBe(false);
    // CHOCOLATE contém "COLA" — palavra inteira, nunca substring.
    expect(isExcludedFromPerPair({ component: 'Material extra', material: 'NAPA CHOCOLATE', category: 'Cabedal' })).toBe(false);
  });

  it('cabedal estocado no setor Forração da Palmilha continua aparecendo (SP301: NAPA SOFT)', () => {
    // A mesma napa é estoque de forro E cabedal — o papel vem do campo da ficha.
    expect(isExcludedFromPerPair({ component: 'Cabedal', material: 'NAPA SOFT', category: 'Forração da Palmilha' })).toBe(false);
    expect(isExcludedFromPerPair({ component: 'Material extra', material: 'NAPA SUDANI', category: 'Forração da Palmilha' })).toBe(false);
    // Na BOM o papel não é conhecido — aí o setor manda.
    expect(isExcludedFromPerPair({ component: 'BOM', material: 'NAPA SOFT', category: 'Forração da Palmilha' })).toBe(true);
    // Nome ainda exclui mesmo com papel da ficha.
    expect(isExcludedFromPerPair({ component: 'Material extra', material: 'PLACA FIBRA', category: 'Cabedal' })).toBe(true);
  });
});

const priced = (unit: string, ...prices: number[]) => prices.map((unitPrice) => ({ unit, unitPrice }));

describe('medianPrice', () => {
  it('ignora zero/negativo e é robusta a outlier', () => {
    expect(medianPrice([0, 0.85, 0.85, 0.85, 1.05, 20.495])).toBe(0.85);
  });
  it('par de valores → média dos dois do meio', () => {
    expect(medianPrice([2, 2, 2.5, 2.5])).toBe(2.25);
  });
  it('nada com preço → null', () => {
    expect(medianPrice([0, 0])).toBeNull();
  });
});

describe('resolvePerPairCost', () => {
  const row = { unit: 'm', average: 0.5, widthMissing: false };

  it('mediana das cores × consumo médio, com faixa quando divergem', () => {
    const cost = resolvePerPairCost(row, { candidates: priced('m', 2, 2, 2.5, 2.5) });
    expect(cost.status).toBe('ok');
    expect(cost.unitPrice).toBe(2.25);
    expect(cost.perPair).toBeCloseTo(1.125, 9);
    expect(cost.perPairMin).toBeCloseTo(1, 9);
    expect(cost.perPairMax).toBeCloseTo(1.25, 9);
  });

  it('cores que só diferem abaixo do centavo por par → sem faixa', () => {
    const cost = resolvePerPairCost({ unit: 'un', average: 2, widthMissing: false }, { candidates: priced('un', 0.27, 0.271) });
    expect(cost.perPairMin).toBeNull();
    expect(cost.perPairMax).toBeNull();
  });

  it('preço único → sem faixa', () => {
    const cost = resolvePerPairCost(row, { candidates: priced('metro', 43.54) });
    expect(cost.perPair).toBeCloseTo(21.77, 9);
    expect(cost.perPairMin).toBeNull();
    expect(cost.perPairMax).toBeNull();
  });

  it('só casa preço na MESMA unidade da linha', () => {
    // NAPA SOFT + MASSABOX tem um SKU em `un` a R$ 43,34 — não pode virar R$/m.
    const cost = resolvePerPairCost(row, { candidates: priced('un', 43.34) });
    expect(cost.status).toBe('missing');
    expect(cost.perPair).toBeNull();
  });

  it('sem preço nas cores do modelo → mediana do grupo, marcada estimada e sem faixa', () => {
    const cost = resolvePerPairCost(
      { unit: 'm', average: 0.44, widthMissing: false },
      {
        candidates: priced('m', 0, 0, 0),
        fallbackCandidates: priced('m', 0.85, 0.85, 0.85, 1.05, 20.495),
        missingScope: 'NAPA SOFT',
      },
    );
    expect(cost.status).toBe('estimated');
    expect(cost.unitPrice).toBe(0.85);
    expect(cost.perPair).toBeCloseTo(0.374, 9);
    expect(cost.perPairMin).toBeNull();
    expect(cost.missingScope).toBe('NAPA SOFT');
  });

  it('nada com preço em lugar nenhum → missing', () => {
    const cost = resolvePerPairCost(row, { candidates: priced('m', 0), fallbackCandidates: [], missingScope: 'X' });
    expect(cost.status).toBe('missing');
    expect(cost.missingScope).toBe('X');
  });

  it('dm² sem largura nunca recebe preço por metro', () => {
    const cost = resolvePerPairCost({ unit: 'dm²', average: 10, widthMissing: true }, { candidates: priced('m', 17.34) });
    expect(cost.status).toBe('no_width');
    expect(cost.perPair).toBeNull();
  });

  it('linha sem fonte de preço → missing', () => {
    expect(resolvePerPairCost(row, null).status).toBe('missing');
  });
});

describe('computePerPairConsumption + custo', () => {
  it('a linha consolidada usa o preço da primeira fonte que trouxe um', () => {
    const rows = computePerPairConsumption(
      [
        src({ scalar: 13.7 }),
        src({ component: 'Material extra', scalar: 13.7, price: { candidates: priced('m', 17.34) } }),
      ],
      ['34'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].average).toBeCloseTo(0.2, 6);
    expect(rows[0].cost.status).toBe('ok');
    expect(rows[0].cost.perPair).toBeCloseTo(0.2 * 17.34, 6);
  });

  it('I703: fivela + cabedal + overlock estimada + strass → total e pendentes', () => {
    const rows = computePerPairConsumption(
      [
        src({ component: 'Componente', material: 'Fivela 12mm', category: 'Componente', inputUnit: 'stock', stockUnit: 'un', scalar: 2, price: { candidates: priced('un', 0.27) } }),
        src({ material: 'NAPA SOFT + MASSABOX', scalar: 0.02 * 137, price: { candidates: [...priced('m', 43.54, 43.54), ...priced('un', 43.34)] } }),
        src({ component: 'Tiras', material: 'TIRA OVERLOCK · 5 mm', category: null, inputUnit: 'stock', stockUnit: 'm', scale: 0.01, scalar: 44, price: { candidates: priced('m', 0, 0), fallbackCandidates: priced('m', 0.85, 0.85, 20.495), missingScope: 'NAPA SOFT' } }),
        src({ component: 'Tiras', material: 'TIRA STRASS · 6 mm', category: null, inputUnit: 'stock', stockUnit: 'm', scale: 0.01, scalar: 50, price: { candidates: priced('m', 2, 2, 2.5, 2.5) } }),
        src({ component: 'Tiras', material: 'TIRA SEM PREÇO', category: null, inputUnit: 'stock', stockUnit: 'm', scale: 0.01, scalar: 10 }),
        // Napa sem largura: fica em dm², não casa com preço por metro → conta como pendente.
        src({ component: 'Material extra', material: 'NAPA SEM LARGURA', componentSheet: null, scalar: 5, price: { candidates: priced('m', 17.34) } }),
      ],
      ['34', '35'],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.material, r]));
    expect(byName['Fivela 12mm'].cost.perPair).toBeCloseTo(0.54, 9);
    expect(byName['NAPA SOFT + MASSABOX'].cost.perPair).toBeCloseTo(0.8708, 6);
    expect(byName['TIRA OVERLOCK · 5 mm'].cost.status).toBe('estimated');
    expect(byName['TIRA STRASS · 6 mm'].cost.perPair).toBeCloseTo(1.125, 9);
    expect(byName['NAPA SEM LARGURA'].cost.status).toBe('no_width');

    const summary = summarizePerPairCost(rows);
    expect(summary.total).toBeCloseTo(0.54 + 0.8708 + 0.374 + 1.125, 6);
    expect(summary.pricedCount).toBe(4);
    expect(summary.estimatedCount).toBe(1);
    expect(summary.missingCount).toBe(2); // tira sem preço + napa sem largura
  });
});

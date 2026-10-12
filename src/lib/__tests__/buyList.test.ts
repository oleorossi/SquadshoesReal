import { describe, it, expect } from 'vitest';
import {
  baseApplicationKind,
  baseMaterialName,
  buildBuyList,
  isBuyListRow,
  isDirectNapaRow,
  rowBelongsToBaseFamily,
} from '../buyList';
import { computeBaseMaterialTotal } from '../baseMaterialTotal';
import type { ConsumptionRow } from '../consumptionRows';
import { PV00195_ROWS } from './fixtures/pv00195Consumption';

/** Atalho pra montar linha do motor sem repetir os campos obrigatórios. */
const row = (o: Partial<ConsumptionRow>): ConsumptionRow => ({
  componentType: 'Forração Palmilha',
  groupName: 'NAPA SOFT',
  materialName: 'Forração Palmilha',
  color: 'PRETO',
  productUnit: 'm',
  totalQuantity: 1,
  ...o,
} as ConsumptionRow);

describe('buildBuyList', () => {
  it('agrupa napa direta por família → cor, maior primeiro', () => {
    const bl = buildBuyList([
      row({ color: 'PRETO', totalQuantity: 1 }),
      row({ color: 'OFF WHITE', totalQuantity: 4 }),
      row({ color: 'PRETO', totalQuantity: 2, materialName: 'Forração' , componentType: 'Forração' }),
      row({ groupName: 'NAPA SUDANI', color: 'CAFE', totalQuantity: 20.27, componentType: 'Cabedal' }),
    ]);

    expect(bl.families.map((f) => f.napa)).toEqual(['NAPA SUDANI', 'NAPA SOFT']);
    const soft = bl.families.find((f) => f.napa === 'NAPA SOFT')!;
    // PRETO soma as duas aplicações (1 + 2 = 3) e ainda fica atrás de OFF WHITE (4).
    expect(soft.colors.map((c) => [c.color, c.qty])).toEqual([['OFF WHITE', 4], ['PRETO', 3]]);
    expect(soft.colors.find((c) => c.color === 'PRETO')).toEqual({
      color: 'PRETO', qty: 3, cabedal: 0, forracao: 3,
    });
    expect(soft.total).toBe(7);
    expect(bl.grandTotal).toBeCloseTo(27.27, 2);
  });

  // Decisão do dono (11/10/2026): napa de tira NÃO entra na lista de napa —
  // só no §03 Setor de Tiras. Revoga a de 27/09/2026.
  it('tira artesanal convertida NÃO entra na família da napa-base', () => {
    const tira = row({
      componentType: 'Tiras', groupName: 'TIRA OVERLOCK 5MM', color: 'PRETO',
      totalQuantity: 169.2,
      artisanal: { baseName: 'NAPA SOFT', baseQty: 169.2 / 60, yieldPerMeter: 60 },
    });
    const bl = buildBuyList([tira]);
    expect(bl.families).toEqual([]);
    expect(bl.grandTotal).toBe(0);
    expect(bl.otherRows).toEqual([tira]);
    expect(isBuyListRow(tira)).toBe(false);
  });

  it('total da família = só cabedal; a tira interna fica fora e as colunas fecham', () => {
    const bl = buildBuyList([
      row({
        componentType: 'Cabedal', groupName: 'NAPA SOFT', materialName: 'Cabedal',
        color: 'PRETO', totalQuantity: 12.5,
      }),
      row({
        componentType: 'Tiras', groupName: 'TIRA OVERLOCK 5MM', materialName: 'Produção interna',
        color: 'PRETO', totalQuantity: 300,
        artisanal: { baseName: 'NAPA SOFT', baseQty: 5, yieldPerMeter: 60 },
      }),
    ]);

    const soft = bl.families.find((family) => family.napa === 'NAPA SOFT')!;
    const preto = soft.colors.find((color) => color.color === 'PRETO')!;
    expect(preto.cabedal).toBeCloseTo(12.5, 10);
    expect(preto.forracao).toBe(0);
    // Total = Cabedal + Forração — o que a tabela do §01 mostra.
    expect(preto.qty).toBeCloseTo(preto.cabedal + preto.forracao, 10);
    expect(preto.qty).toBeCloseTo(12.5, 10);
    expect(soft.total).toBeCloseTo(12.5, 10);
    expect(bl.grandTotal).toBeCloseTo(12.5, 10);
  });

  it('não abre família fantasma com a tira de SKU com cor (Massabox + Cobre)', () => {
    const bl = buildBuyList([
      row({
        componentType: 'Cabedal',
        groupName: 'GLOW METALIC + MASSABOX',
        materialName: 'Cabedal',
        color: 'COBRE',
        totalQuantity: 8.4,
      }),
      row({
        componentType: 'Cabedal',
        groupName: 'GLOW METALIC + MASSABOX',
        materialName: 'Cabedal',
        color: 'CHAMPAGNE',
        totalQuantity: 15.39,
      }),
      row({
        componentType: 'Tiras',
        groupName: 'TIRA OVERLOCK 5MM',
        materialName: 'Produção interna',
        color: 'COBRE',
        totalQuantity: 160,
        artisanal: {
          baseName: 'GLOW METALIC + MASSABOX - COBRE',
          baseQty: 2.64,
          yieldPerMeter: 60.6,
        },
      }),
    ]);

    expect(bl.families.map((f) => f.napa)).toEqual(['GLOW METALIC + MASSABOX']);
    const family = bl.families[0];
    // Cabedal 15,39 + 8,40 — os 2,64 m de napa da tira ficam no §03.
    expect(family.total).toBeCloseTo(23.79, 2);
    const cobre = family.colors.find((c) => c.color === 'COBRE')!;
    expect(cobre.cabedal).toBeCloseTo(8.4, 10);
    expect(cobre.qty).toBeCloseTo(8.4, 10);
  });

  it('tira sem rendimento não aparece no §01 (o §03 mostra o cadastro incompleto)', () => {
    const pendente = row({
      componentType: 'Tiras', groupName: 'TIRA CHATA 8MM', color: 'ROSADO',
      totalQuantity: 120,
      artisanal: { baseName: 'NAPA SOFT', baseQty: 0, yieldPerMeter: 0, pending: true },
    });
    const bl = buildBuyList([row({ color: 'ROSADO', totalQuantity: 5 }), pendente]);
    expect(bl.grandTotal).toBe(5); // os 120 m de tira NÃO entram
    expect(bl.families[0].colors[0]).toEqual({ color: 'ROSADO', qty: 5, cabedal: 0, forracao: 5 });
    expect(bl).not.toHaveProperty('pendingStraps');
    expect(bl.otherRows).toEqual([pendente]);
  });

  it('manda pra otherRows o que não se soma em metros com napa', () => {
    const bl = buildBuyList([
      row({ componentType: 'Solado', groupName: 'SOLADO 01', productUnit: 'par', totalQuantity: 540 }),
      row({ componentType: 'Químicos', groupName: 'COLA PU', productUnit: 'kg', totalQuantity: 0.97 }),
      row({ componentType: 'Embalagem', groupName: 'CAIXA', productUnit: 'un', totalQuantity: 720 }),
    ]);
    expect(bl.families).toHaveLength(0);
    expect(bl.otherRows.map((r) => r.groupName)).toEqual(['SOLADO 01', 'COLA PU', 'CAIXA']);
  });

  it('napa com cadastro incompleto fica fora da compra (consumo ~100× inflado)', () => {
    const inflada = row({ color: 'PRETO', totalQuantity: 508, widthMissing: true });
    expect(isDirectNapaRow(inflada)).toBe(false);
    expect(isBuyListRow(inflada)).toBe(false);
    const bl = buildBuyList([inflada]);
    expect(bl.families).toHaveLength(0);
    expect(bl.otherRows).toHaveLength(1);
  });

  it('dm² não entra na lista de compra em metros', () => {
    const bl = buildBuyList([row({ productUnit: 'dm²', totalQuantity: 570 })]);
    expect(bl.families).toHaveLength(0);
  });

  it('tira convertida não soma no grandTotal da napa-base', () => {
    const bl = buildBuyList([1, 2, 3].map(() => row({
      componentType: 'Tiras',
      groupName: 'TIRA TESTE',
      totalQuantity: 0.294,
      artisanal: { baseName: 'NAPA SOFT', baseQty: 0.0049, yieldPerMeter: 60 },
    })));
    expect(bl.grandTotal).toBe(0);
    expect(bl.families).toEqual([]);
  });

  it('PV-00195: necessidade de napa cai de 78,09 m para 55,57 m (napa de tira só no §03)', () => {
    const bl = buildBuyList(PV00195_ROWS);
    expect(bl.grandTotal).toBeCloseTo(55.57, 2);
    const color = (napa: string, cor: string) => bl.families
      .find((family) => family.napa === napa)!.colors
      .find((entry) => entry.color === cor)!;
    // Antes: 32,74 / 16,70 / 15,26 (cabedal/forração + napa de tira).
    expect(color('GLOW METALIC', 'CHAMPAGNE').qty).toBeCloseTo(14.06, 2);
    expect(color('GLOW METALIC', 'COBRE').qty).toBeCloseTo(14.06, 2);
    expect(color('NAPA SOFT', 'OFF WHITE').qty).toBeCloseTo(14.06, 2);
    // Toda cor fecha: Total = Cabedal + Forração.
    for (const family of bl.families) {
      for (const entry of family.colors) {
        expect(entry.qty).toBeCloseTo(entry.cabedal + entry.forracao, 10);
      }
    }
    // A napa que saiu é exatamente a das tiras de prestador (22,52 m).
    const strapNapa = PV00195_ROWS.reduce((sum, r) => sum + (Number(r.artisanal?.baseQty) || 0), 0);
    expect(bl.grandTotal + strapNapa).toBeCloseTo(78.09, 2);
  });
});

/**
 * PARIDADE com `computeBaseMaterialTotal`.
 *
 * A tela usa `computeBaseMaterialTotal` no número-herói ("material base a
 * comprar") e `buildBuyList` na lista família→cor logo abaixo. São duas
 * implementações da MESMA soma — se divergirem, o dono vê um total que não fecha
 * com as parcelas visíveis, que é exatamente o que a nota de arredondamento de
 * `baseMaterialTotal.ts` existe pra evitar. Este teste é o que impede a
 * divergência silenciosa.
 */
describe('paridade buildBuyList × computeBaseMaterialTotal', () => {
  const MIXED: ConsumptionRow[] = [
    row({ componentType: 'Cabedal', groupName: 'NAPA SUDANI', color: 'CAFE', totalQuantity: 20.27 }),
    row({ color: 'PRETO', totalQuantity: 1 }),
    row({ color: 'OFF WHITE', totalQuantity: 1 }),
    row({ color: 'ROSADO', totalQuantity: 1 }),
    row({
      componentType: 'Tiras', groupName: 'TIRA OVERLOCK 5MM', color: 'PRETO',
      totalQuantity: 234.72,
      artisanal: { baseName: 'NAPA SOFT', baseQty: 234.72 / 61, yieldPerMeter: 61 },
    }),
    row({
      componentType: 'Tiras', groupName: 'TIRA CHATA 8MM', color: 'ROSADO',
      totalQuantity: 120,
      artisanal: { baseName: 'NAPA SOFT', baseQty: 0, yieldPerMeter: 0, pending: true },
    }),
    // Ruído que nenhuma das duas deve somar:
    row({ componentType: 'Solado', groupName: 'SOLADO 01', productUnit: 'par', totalQuantity: 540 }),
    row({ componentType: 'Palmilha', groupName: 'EVA 3MM', totalQuantity: 5.08 }),
    row({ color: 'PRETO', totalQuantity: 508, widthMissing: true }),
  ];

  it('os dois chegam ao mesmo total de metros', () => {
    const bl = buildBuyList(MIXED);
    const base = computeBaseMaterialTotal(MIXED)!;
    expect(bl.grandTotal).toBeCloseTo(base.total, 2);
  });

  it('e às mesmas famílias, com os mesmos metros por família', () => {
    const bl = buildBuyList(MIXED);
    const base = computeBaseMaterialTotal(MIXED)!;
    const byName = (pairs: { name: string; qty: number }[]) =>
      Object.fromEntries(pairs.map((p) => [p.name, Number(p.qty.toFixed(2))]));
    expect(byName(bl.families.map((f) => ({ name: f.napa, qty: f.total }))))
      .toEqual(byName(base.parts));
  });

  it('nenhum dos dois soma tira — convertida ou pendente (11/10/2026)', () => {
    // 20,27 + 1 + 1 + 1: só napa direta. A tira convertida (3,85 m) e a
    // pendente ficam no §03; a largura faltando segue como skipped.
    expect(buildBuyList(MIXED).grandTotal).toBeCloseTo(23.27, 2);
    const base = computeBaseMaterialTotal(MIXED)!;
    expect(base.total).toBeCloseTo(23.27, 2);
    expect(base.skipped).toBe(1);
  });

  it('PV-00195: os dois chegam a 55,57 m', () => {
    expect(buildBuyList(PV00195_ROWS).grandTotal).toBeCloseTo(55.57, 2);
    expect(computeBaseMaterialTotal(PV00195_ROWS)!.total).toBeCloseTo(55.57, 2);
  });
});

describe('material base → cor → aplicação', () => {
  const napa = row({
    componentType: 'Forração Palmilha',
    groupName: 'NAPA SOFT',
    materialName: 'Forração Palmilha',
    color: 'NEW WHISKY',
    totalQuantity: 20.21,
  });
  const cabedal = row({
    componentType: 'Cabedal',
    groupName: 'NAPA SOFT',
    materialName: 'Cabedal',
    color: 'OFF WHITE',
    totalQuantity: 59.05,
  });
  const tira = row({
    componentType: 'Tiras',
    groupName: 'TIRA OVERLOCK 5 mm · NAPA SOFT · NEW WHISKY',
    materialName: 'Produção interna',
    color: 'NEW WHISKY',
    totalQuantity: 1402.8,
    artisanal: { baseName: 'NAPA SOFT', baseQty: 20.04, yieldPerMeter: 70 },
  });

  it('tira interna não pertence a família de napa (napa dela: Setor de Tiras)', () => {
    expect(baseMaterialName(tira)).toBeNull();
    expect(baseApplicationKind(tira)).toBeNull();
    expect(baseApplicationKind(napa)).toBe('forracao');
    expect(baseApplicationKind(cabedal)).toBe('cabedal');
    expect(rowBelongsToBaseFamily(tira, 'NAPA SOFT')).toBe(false);
    expect(rowBelongsToBaseFamily(napa, 'NAPA SOFT')).toBe(true);
  });

  it('quebra cada cor em cabedal + forração; o total fecha com as duas colunas', () => {
    const bl = buildBuyList([napa, cabedal, tira]);
    const soft = bl.families.find((f) => f.napa === 'NAPA SOFT')!;
    const whisky = soft.colors.find((c) => c.color === 'NEW WHISKY')!;
    const white = soft.colors.find((c) => c.color === 'OFF WHITE')!;

    expect(whisky.cabedal).toBe(0);
    expect(whisky.forracao).toBeCloseTo(20.21, 2);
    expect(whisky.qty).toBeCloseTo(20.21, 2);

    expect(white.cabedal).toBeCloseTo(59.05, 2);
    expect(white.forracao).toBe(0);
    expect(white.qty).toBeCloseTo(59.05, 2);

    expect(soft.total).toBeCloseTo(79.26, 2);
    expect(bl.otherRows).toEqual([tira]);
  });
});

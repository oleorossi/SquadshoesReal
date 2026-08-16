import { describe, it, expect } from 'vitest';
import { buildBuyList, isBuyListRow, isDirectNapaRow } from '../buyList';
import { computeBaseMaterialTotal } from '../baseMaterialTotal';
import type { ConsumptionRow } from '../consumptionRows';

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
    expect(soft.total).toBe(7);
    expect(bl.grandTotal).toBeCloseTo(27.27, 2);
  });

  it('converte tira artesanal em napa e NUNCA soma os metros de tira', () => {
    const bl = buildBuyList([
      row({
        componentType: 'Tiras', groupName: 'TIRA OVERLOCK 5MM', color: 'PRETO',
        totalQuantity: 169.2,
        artisanal: { baseName: 'NAPA SOFT', baseQty: 169.2 / 60, yieldPerMeter: 60 },
      }),
    ]);
    expect(bl.families).toHaveLength(1);
    expect(bl.families[0].napa).toBe('NAPA SOFT');
    // 169,20 / 60 = 2,82 — e não 169,20.
    expect(bl.families[0].total).toBeCloseTo(2.82, 2);
  });

  it('tira sem rendimento sai em pendingStraps, fora do total, e marca a cor', () => {
    const bl = buildBuyList([
      row({ color: 'ROSADO', totalQuantity: 5 }),
      row({
        componentType: 'Tiras', groupName: 'TIRA CHATA 8MM', color: 'ROSADO',
        totalQuantity: 120,
        artisanal: { baseName: 'NAPA SOFT', baseQty: 0, yieldPerMeter: 0, pending: true },
      }),
    ]);
    expect(bl.pendingStraps).toEqual([
      { tira: 'TIRA CHATA 8MM', color: 'ROSADO', napa: 'NAPA SOFT', tiraM: 120 },
    ]);
    expect(bl.grandTotal).toBe(5); // os 120 m de tira NÃO entram
    expect(bl.families[0].colors[0].pending).toBe(1);
    // e não vaza pra otherRows (senão aparecia duas vezes na tela)
    expect(bl.otherRows).toHaveLength(0);
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

  it('preserva precisão integral antes da apresentação', () => {
    const bl = buildBuyList([1, 2, 3].map(() => row({
      componentType: 'Tiras',
      groupName: 'TIRA TESTE',
      totalQuantity: 0.294,
      artisanal: { baseName: 'NAPA SOFT', baseQty: 0.0049, yieldPerMeter: 60 },
    })));
    expect(bl.grandTotal).toBeCloseTo(0.0147, 10);
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

  it('contam a mesma pendência (tira sem rendimento fica fora dos dois)', () => {
    expect(buildBuyList(MIXED).pendingStraps).toHaveLength(1);
    expect(computeBaseMaterialTotal(MIXED)!.skipped).toBeGreaterThanOrEqual(1);
  });
});

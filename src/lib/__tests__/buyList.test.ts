import { describe, it, expect } from 'vitest';
import { buildBuyList, isBuyListRow, isDirectNapaRow } from '../buyList';
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
});

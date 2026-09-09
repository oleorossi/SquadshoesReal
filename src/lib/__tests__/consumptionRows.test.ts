import { describe, expect, it } from 'vitest';
import { rowKnown, rowShortfall } from '@/lib/consumptionAvailability';
import {
  attachUnresolvedStrapQuantityPreview,
  resolveRowUnitPrice,
  rowTotalCost,
  type ConsumptionRow,
} from '@/lib/consumptionRows';
import type { MaterialConsumptionRow } from '@/lib/orderConsumption';

const calculatedStrap: MaterialConsumptionRow = {
  componentType: 'Tiras',
  groupName: 'TIRA CHATA 8MM',
  materialName: 'Tira 1',
  productUnit: 'm',
  color: 'CAPUCCINO',
  totalQuantity: 17.25,
  materialFamily: 'NAPA SOFT',
};

const unresolved: ConsumptionRow = {
  componentType: 'Tiras',
  groupName: 'Demanda de tira não resolvida',
  materialName: 'Revisar ficha e origem no Hub de Tiras',
  productUnit: 'm',
  color: '—',
  totalQuantity: 0,
  productIds: [],
  warning: 'A tira permanece bloqueada até resolver variante, base, cor e receita por ID.',
};

const colorMatches = (product: any, color: string) =>
  !color || color === '—' || String(product.color || '').toUpperCase() === color.toUpperCase();

describe('attachUnresolvedStrapQuantityPreview', () => {
  it('exibe a metragem da ficha sem liberar estoque ou compra', () => {
    const [row] = attachUnresolvedStrapQuantityPreview(
      [unresolved],
      [calculatedStrap],
      false,
    );

    expect(row).toMatchObject({
      groupName: 'TIRA CHATA 8MM',
      color: 'CAPUCCINO',
      totalQuantity: 0,
      previewQuantity: 17.25,
      productIds: [],
    });
    expect(row.warning).toContain('somente uma prévia');
    expect(rowKnown(row)).toBe(false);
    expect(rowShortfall(row)).toBe(0);
  });

  it('não altera a linha quando a preview canônica já cobre a tira calculada', () => {
    const covered: ConsumptionRow = {
      ...unresolved,
      groupName: 'TIRA CHATA 8MM · NAPA SOFT',
      materialName: 'Produção interna',
      color: 'CAPUCCINO',
      totalQuantity: 17.25,
    };
    expect(attachUnresolvedStrapQuantityPreview(
      [covered],
      [calculatedStrap],
      true,
    )).toEqual([covered]);
  });

  // Regressão PV-00169 / Dakotton: preview trouxe OVERLOCK e omitiu STRASS
  // (linha só na ficha). O helper reanexa a STRASS como prévia bloqueada.
  // O path Consumo canônico corrige no SQL (mig 21100); isto é defesa TS.
  it('com preview parcial, reanexa STRASS calculada pela ficha como prévia', () => {
    const overlockCanonical: ConsumptionRow = {
      componentType: 'Tiras',
      groupName: 'TIRA OVERLOCK 5MM · NAPA SOFT',
      materialName: 'Produção interna',
      productUnit: 'm',
      color: 'PRETO',
      totalQuantity: 508,
      productIds: [],
      strapSourceMode: 'internal',
    };
    const strassCalculated: MaterialConsumptionRow = {
      componentType: 'Tiras',
      groupName: 'TIRA STRASS 6MM',
      materialName: 'STRASS LATERAL',
      productUnit: 'm',
      color: 'PRETO',
      totalQuantity: 120,
    };

    const rows = attachUnresolvedStrapQuantityPreview(
      [overlockCanonical],
      [strassCalculated],
      true,
    );

    expect(rows).toHaveLength(2);
    const strass = rows.find((row) => /STRASS/i.test(row.groupName));
    expect(strass).toMatchObject({
      totalQuantity: 0,
      previewQuantity: 120,
    });
    expect(strass?.warning).toContain('somente uma prévia');
  });
});

describe('custo unitário por item/cor', () => {
  it('resolve o preço do SKU pinado e calcula o total da necessidade', () => {
    const price = resolveRowUnitPrice(
      { productIds: ['napa-soft-off'], groupName: 'NAPA SOFT', color: 'OFF WHITE' },
      {
        allProducts: [
          { id: 'napa-soft-off', color: 'OFF WHITE', unit_price: 12.5, quantity: 10, reserved_stock: 0 },
        ],
        productGroups: [],
        boxTypes: [],
      },
      colorMatches,
    );
    expect(price).toBe(12.5);
    expect(rowTotalCost({ totalQuantity: 14.91, unitPrice: price })).toBeCloseTo(186.375);
  });

  it('resolve preço de embalagem pela caixa e de solado pelo soleProductId', () => {
    expect(resolveRowUnitPrice(
      { boxTypeIds: ['bt-colmeia'], groupName: 'EMBALAGEM', color: '—' },
      {
        allProducts: [],
        productGroups: [],
        boxTypes: [{ id: 'bt-colmeia', nome: 'CAIXA COLMEIA 11', tipo: 'colmeia', unit_price: 4.2 } as any],
      },
      colorMatches,
    )).toBe(4.2);

    expect(resolveRowUnitPrice(
      { soleProductId: 'sole-caramelo', groupName: 'SOLADO 01', color: 'CARAMELO' },
      {
        allProducts: [{ id: 'sole-caramelo', unit_price: 8.9 }],
        productGroups: [],
        boxTypes: [],
      },
      colorMatches,
    )).toBe(8.9);
  });

  it('devolve null sem inventar preço quando o SKU não tem unit_price', () => {
    expect(resolveRowUnitPrice(
      { productIds: ['sem-preco'], groupName: 'NAPA SOFT', color: 'PRETO' },
      {
        allProducts: [{ id: 'sem-preco', color: 'PRETO', unit_price: null }],
        productGroups: [],
        boxTypes: [],
      },
      colorMatches,
    )).toBeNull();
    expect(rowTotalCost({ totalQuantity: 10, unitPrice: null })).toBeNull();
  });
});

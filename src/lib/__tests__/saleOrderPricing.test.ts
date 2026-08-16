import { describe, expect, it } from 'vitest';
import {
  evaluatePriceListValidity,
  resolvePrice,
  resolvePriceRule,
  type PriceLookup,
} from '@/lib/mobile/clientContext';
import { resolveSaleOrderItemPrice } from '@/lib/saleOrderPricing';

function lookup(): PriceLookup {
  return {
    byRefColor: new Map([
      ['ref-1::PRETO', [
        { id: 'cor-base', minQty: 1, price: 92 },
        { id: 'cor-volume', minQty: 100, price: 88 },
      ]],
    ]),
    byRef: new Map([
      ['ref-1', [
        { id: 'ref-base', minQty: 1, price: 95 },
        { id: 'ref-volume', minQty: 50, price: 90 },
      ]],
    ]),
  };
}

describe('precificação comercial do pedido de venda', () => {
  it('usa a regra mais específica de cor e a maior faixa atingida', () => {
    const rule = resolvePriceRule(lookup(), 'ref-1', ' preto ', 120);
    expect(rule).toMatchObject({ price: 88, match: 'color', tier: { id: 'cor-volume', minQty: 100 } });
    expect(resolvePrice(lookup(), 'ref-1', 'PRETO', 99)).toBe(92);
  });

  it('cai no preço default da referência quando não existe regra da cor', () => {
    expect(resolvePriceRule(lookup(), 'ref-1', 'CARAMELO', 60)).toMatchObject({
      price: 90,
      match: 'reference',
    });
  });

  it('prioriza tabela, depois variação de material e por último ficha técnica', () => {
    expect(resolveSaleOrderItemPrice({
      lookup: lookup(), referenceId: 'ref-1', color: 'PRETO', quantity: 120,
      variantPrice: 91, sheetPrice: 99,
    })).toMatchObject({ price: 88, source: 'table_color' });

    expect(resolveSaleOrderItemPrice({
      referenceId: 'ref-1', variantPrice: 91, sheetPrice: 99,
    })).toMatchObject({ price: 91, source: 'material_variant' });

    expect(resolveSaleOrderItemPrice({
      referenceId: 'ref-1', sheetPrice: 99,
    })).toMatchObject({ price: 99, source: 'technical_sheet' });
  });

  it('nunca usa tabela inativa, futura ou vencida', () => {
    expect(evaluatePriceListValidity({ active: false }, '2026-08-16')).toEqual({
      effective: false, invalidReason: 'inactive',
    });
    expect(evaluatePriceListValidity({ active: true, valid_from: '2026-08-17' }, '2026-08-16')).toEqual({
      effective: false, invalidReason: 'not_started',
    });
    expect(evaluatePriceListValidity({ active: true, valid_from: '2026-08-01', valid_to: '2026-08-15' }, '2026-08-16')).toEqual({
      effective: false, invalidReason: 'expired',
    });

    const invalidLookup = lookup();
    invalidLookup.context = {
      id: 'pl-1', name: 'Vencida', active: true, validFrom: '2026-08-01',
      validTo: '2026-08-15', effective: false, invalidReason: 'expired',
    };
    expect(resolvePrice(invalidLookup, 'ref-1', 'PRETO', 120)).toBe(0);
  });
});

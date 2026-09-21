import { describe, expect, it } from 'vitest';
import {
  isSaleOrderItemStructurallyIncomplete,
  saleOrderItemUiKey,
} from './saleOrderItemDensity';
import type { SaleOrderItemFormData } from '@/hooks/useSaleOrders';

function base(partial: Partial<SaleOrderItemFormData> = {}): SaleOrderItemFormData {
  return {
    reference_id: 'ref-1',
    color: 'PRETO',
    grade: { '34': 1, '35': 1 },
    fichas: 1,
    quantity: 2,
    unit_price: 21,
    ...partial,
  } as SaleOrderItemFormData;
}

describe('saleOrderItemUiKey', () => {
  it('prefere id, depois clientKey, depois índice', () => {
    expect(saleOrderItemUiKey({ id: 'a', clientKey: 'c' }, 3)).toBe('a');
    expect(saleOrderItemUiKey({ clientKey: 'c' }, 3)).toBe('c');
    expect(saleOrderItemUiKey({}, 3)).toBe('idx-3');
  });
});

describe('isSaleOrderItemStructurallyIncomplete', () => {
  it('completo quando tem ref, cor e pares', () => {
    expect(isSaleOrderItemStructurallyIncomplete(base())).toBe(false);
  });

  it('incompleto sem referência', () => {
    expect(isSaleOrderItemStructurallyIncomplete(base({ reference_id: '' }))).toBe(true);
  });

  it('incompleto sem cor', () => {
    expect(isSaleOrderItemStructurallyIncomplete(base({ color: '  ' }))).toBe(true);
  });

  it('incompleto com grade zerada', () => {
    expect(isSaleOrderItemStructurallyIncomplete(base({
      grade: { '34': 0 },
      quantity: 0,
    }))).toBe(true);
  });
});

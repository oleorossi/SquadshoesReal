import { describe, expect, it } from 'vitest';
import { commonProductField } from '@/lib/applyGroupItemUnitPrice';

describe('commonProductField', () => {
  it('devolve o valor comum quando todos os itens batem', () => {
    const products = [
      { unit: 'm', unit_price: 12.5 },
      { unit: 'm', unit_price: 12.5 },
    ];
    expect(commonProductField(products, 'unit', (v) => String(v || ''))).toBe('m');
    expect(commonProductField(products, 'unit_price', (v) => Number(v) || 0)).toBe(12.5);
  });

  it('devolve null quando a unidade diverge', () => {
    const products = [
      { unit: 'm', unit_price: 10 },
      { unit: 'cm', unit_price: 10 },
    ];
    expect(commonProductField(products, 'unit', (v) => String(v || ''))).toBeNull();
    expect(commonProductField(products, 'unit_price', (v) => Number(v) || 0)).toBe(10);
  });

  it('devolve null com lista vazia', () => {
    expect(commonProductField([], 'unit', (v) => String(v || ''))).toBeNull();
  });
});

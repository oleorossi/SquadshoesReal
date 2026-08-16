import { describe, expect, it } from 'vitest';
import { officialStrapColorsForBase } from '@/lib/officialStrapColors';

describe('officialStrapColorsForBase', () => {
  it('lista somente vínculos oficiais ativos da base, inclusive produto com saldo zero', () => {
    const catalog = {
      colors: [
        { id: 'preto', name: 'PRETO', active: true },
        { id: 'branco', name: 'BRANCO', active: true },
        { id: 'inativa', name: 'INATIVA', active: false },
      ],
      products: [
        { id: 'napa-zero', active: true, quantity: 0 },
        { id: 'napa-inativa', active: false, quantity: 10 },
      ],
      official_products: [
        { base_group_id: 'soft', color_id: 'preto', official_product_id: 'napa-zero', status: 'active' },
        { base_group_id: 'soft', color_id: 'branco', official_product_id: 'napa-inativa', status: 'active' },
        { base_group_id: 'madrid', color_id: 'branco', official_product_id: 'napa-zero', status: 'active' },
      ],
    };

    expect(officialStrapColorsForBase(catalog, 'soft').map((color) => color.id)).toEqual(['preto']);
  });

  it('não oferece catálogo global quando a base ainda não foi resolvida', () => {
    expect(officialStrapColorsForBase({ colors: [], products: [], official_products: [] }, null)).toEqual([]);
  });

  it('mantém cor descontinuada enquanto saldo acabado ou compra pronta seguem disponíveis', () => {
    const catalog = {
      colors: [{ id: 'off', name: 'OFF WHITE', active: false }],
      products: [],
      official_products: [],
      variants: [{
        base_group_id: 'soft',
        color_id: 'off',
        status: 'active',
        source_availability: {
          finished_available_m: 12,
          buy_ready_purchase_allowed: false,
        },
      }],
    };

    expect(officialStrapColorsForBase(catalog, 'soft').map((color) => color.id)).toEqual(['off']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  canonicalStrapColorForProduct,
  officialStrapColorsForBase,
  purchasedReadyStrapColorsForGroup,
  strapColorsForIdentity,
} from '@/lib/officialStrapColors';

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

describe('purchasedReadyStrapColorsForGroup', () => {
  const catalog = {
    colors: [
      { id: 'preto', name: 'PRETO', active: true },
      { id: 'off', name: 'OFF WHITE', active: true },
      { id: 'manual', name: 'MANUAL', active: true },
    ],
    aliases: [{
      canonical_color_id: 'off',
      alias: 'OF WHITE',
      status: 'approved',
    }],
    products: [
      { id: 'strass-preto', group_id: 'strass', color: 'PRETO', active: true },
      { id: 'strass-off', group_id: 'strass', color: 'OF WHITE', active: true },
      { id: 'other', group_id: 'other', color: 'MANUAL', active: true },
      { id: 'inactive', group_id: 'strass', color: 'MANUAL', active: false },
    ],
    official_products: [],
    variants: [],
  };

  it('deriva somente produtos ativos do grupo e aliases aprovados', () => {
    expect(purchasedReadyStrapColorsForGroup(catalog, 'strass').map((color) => color.id))
      .toEqual(['off', 'preto']);
  });

  it('não usa available_colors nem mistura a napa da referência', () => {
    const identity = {
      identity_basis: 'finished_product_group' as const,
      identity_group_id: 'strass',
      available_colors: ['MANUAL'],
    };
    expect(strapColorsForIdentity(catalog, identity, 'soft').map((color) => color.id))
      .toEqual(['off', 'preto']);
  });

  it('não escolhe cor quando o alias aprovado é ambíguo', () => {
    const ambiguous = {
      ...catalog,
      aliases: [
        { canonical_color_id: 'off', alias: 'DUPLA', status: 'approved' },
        { canonical_color_id: 'preto', alias: 'DUPLA', status: 'approved' },
      ],
      products: [{ id: 'ambiguous', group_id: 'strass', color: 'DUPLA', active: true }],
    };
    expect(canonicalStrapColorForProduct(ambiguous, 'ambiguous')).toBeNull();
    expect(purchasedReadyStrapColorsForGroup(ambiguous, 'strass')).toEqual([]);
  });

  it('não deixa o cadastro da variante contradizer a cor exata do produto', () => {
    const divergentVariant = {
      ...catalog,
      variants: [{
        finished_product_id: 'strass-preto',
        base_group_id: 'strass',
        identity_basis: 'finished_product_group' as const,
        color_id: 'manual',
        status: 'active',
      }],
    };

    expect(purchasedReadyStrapColorsForGroup(divergentVariant, 'strass').map((color) => color.id))
      .toEqual(['off', 'preto']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  canonicalStrapColorForProduct,
  officialStrapColorsForBase,
  purchasedReadyStrapColorsForGroup,
  registeredBaseMaterialColorsForGroup,
  strapColorsForIdentity,
} from '@/lib/officialStrapColors';

describe('registeredBaseMaterialColorsForGroup', () => {
  const catalog = {
    colors: [
      { id: 'preto', name: 'PRETO', active: true },
      { id: 'off', name: 'OFF WHITE', active: true },
      { id: 'caramelo', name: 'CARAMELO', active: true },
    ],
    aliases: [{ canonical_color_id: 'off', alias: 'OF WHITE', status: 'approved' }],
    products: [
      { id: 'soft-preto', group_id: 'napa-soft', color: 'PRETO', active: true, unit: 'm' },
      { id: 'soft-off', group_id: 'napa-soft', color: 'OF WHITE', active: true, unit: 'm' },
      { id: 'soft-inativo', group_id: 'napa-soft', color: 'CARAMELO', active: false },
      { id: 'madrid-caramelo', group_id: 'napa-madrid', color: 'CARAMELO', active: true },
    ],
    official_products: [],
  };

  it('puxa as cores dos produtos ativos da NAPA SOFT sem exigir vínculo oficial', () => {
    expect(registeredBaseMaterialColorsForGroup(catalog, 'napa-soft').map((color) => color.id))
      .toEqual(['off', 'preto']);
  });

  it('não mistura cores de outra napa-base nem produtos inativos', () => {
    expect(registeredBaseMaterialColorsForGroup(catalog, 'napa-madrid').map((color) => color.id))
      .toEqual(['caramelo']);
  });

  it('oferece no PV as cores registradas antes de materializar vínculo oficial e receita', () => {
    expect(strapColorsForIdentity(catalog, { identity_basis: 'reference_base' }, 'napa-soft')
      .map(color => color.id)).toEqual(['off', 'preto']);
    expect(catalog.official_products).toEqual([]);
  });

  it('une cores registradas e fontes existentes sem repetir identidades ou misturar bases', () => {
    const expanded = {
      ...catalog,
      colors: [...catalog.colors, { id: 'historica', name: 'HISTÓRICA', active: false }],
      official_products: [{
        base_group_id: 'napa-soft', color_id: 'preto', official_product_id: 'soft-preto', status: 'active',
      }],
      variants: [{
        base_group_id: 'napa-soft', color_id: 'historica', status: 'active',
        source_availability: { finished_available_m: 10 },
      }],
    };
    expect(strapColorsForIdentity(expanded, { identity_basis: 'reference_base' }, 'napa-soft')
      .map(color => color.id)).toEqual(['historica', 'off', 'preto']);
    expect(strapColorsForIdentity(expanded, { identity_basis: 'reference_base' }, null)).toEqual([]);
  });

  it('não oferece como intenção um SKU acabado, não linear ou ambíguo', () => {
    for (const products of [
      catalog.products.map(product => ({ ...product, unit: 'un' })),
      [...catalog.products, ...catalog.products.map(product => ({ ...product, id: `${product.id}-duplicado` }))],
    ]) {
      expect(strapColorsForIdentity({ ...catalog, products }, { identity_basis: 'reference_base' }, 'napa-soft')).toEqual([]);
    }
    const finished = { ...catalog, variants: [
      { finished_product_id: 'soft-preto', base_group_id: 'outro', color_id: 'preto', status: 'inactive' },
      { finished_product_id: 'soft-off', base_group_id: 'outro', color_id: 'off', status: 'inactive' },
    ] };
    expect(strapColorsForIdentity(finished, { identity_basis: 'reference_base' }, 'napa-soft')).toEqual([]);
  });
});

describe('officialStrapColorsForBase', () => {
  it('lista somente vínculos oficiais ativos da base, inclusive produto com saldo zero', () => {
    const catalog = {
      colors: [
        { id: 'preto', name: 'PRETO', active: true },
        { id: 'branco', name: 'BRANCO', active: true },
        { id: 'inativa', name: 'INATIVA', active: false },
      ],
      products: [
        { id: 'napa-zero', group_id: 'soft', active: true, quantity: 0 },
        { id: 'napa-inativa', group_id: 'soft', active: false, quantity: 10 },
      ],
      official_products: [
        { base_group_id: 'soft', color_id: 'preto', official_product_id: 'napa-zero', status: 'active' },
        { base_group_id: 'soft', color_id: 'branco', official_product_id: 'napa-inativa', status: 'active' },
        { base_group_id: 'madrid', color_id: 'branco', official_product_id: 'napa-zero', status: 'active' },
      ],
    };

    expect(officialStrapColorsForBase(catalog, 'soft').map((color) => color.id)).toEqual(['preto']);
  });

  it('não oferece a cor quando o produto oficial saiu do grupo da napa-base', () => {
    const catalog = {
      colors: [{ id: 'preto', name: 'PRETO', active: true }],
      products: [{ id: 'napa-movida', group_id: 'madrid', active: true }],
      official_products: [{
        base_group_id: 'soft',
        color_id: 'preto',
        official_product_id: 'napa-movida',
        status: 'active',
      }],
    };

    expect(officialStrapColorsForBase(catalog, 'soft')).toEqual([]);
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

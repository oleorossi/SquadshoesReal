import { describe, expect, it } from 'vitest';
import {
  applyTechnicalStrapMeasureWithSource,
  isTechnicalStrapSourceAllowed,
  technicalStrapSourcePolicy,
} from '@/lib/technicalStrapSourcePolicy';

const OVERLOCK = 'medida-overlock-5';
const STRASS = 'medida-strass-6';
const STRASS_GROUP = 'grupo-strass-6';
const GLOW = 'grupo-glow';
const ELASTICO = 'medida-elastico-25';
const ELASTICO_LEAF = 'folha-25mm';
const catalog: NonNullable<Parameters<typeof technicalStrapSourcePolicy>[0]> = {
  types: [
    { id: 'overlock', name: 'TIRA OVERLOCK', active: true },
    { id: 'strass', name: 'TIRA STRASS', active: true },
    { id: 'elastico', name: 'ELÁSTICO ESPECIAL G', active: true },
  ],
  measures: [
    { id: OVERLOCK, strap_type_id: 'overlock', active: true, finished_width_mm: 5 },
    { id: STRASS, strap_type_id: 'strass', active: true, finished_width_mm: 6, origem_padrao: 'sempre_sku_acabado' },
    { id: ELASTICO, strap_type_id: 'elastico', active: true, finished_width_mm: 25, origem_padrao: 'sempre_sku_acabado' },
  ],
  variants: [
    { measure_id: OVERLOCK, base_group_id: GLOW, identity_basis: 'reference_base', internal_production_enabled: true, status: 'active' },
    { measure_id: STRASS, base_group_id: STRASS_GROUP, identity_basis: 'finished_product_group', internal_production_enabled: false, finished_product_id: 'cristal', status: 'active' },
  ],
  recipes: [],
  products: [
    { id: 'cristal', name: 'TIRA STRASS 6MM · CRISTAL', group_id: STRASS_GROUP, active: true, unit: 'm' },
    { id: 'glow', name: 'NAPA GLOW', group_id: GLOW, active: true, unit: 'm' },
    { id: 'sem-vinculo', name: 'TIRA STRASS 6MM · OUTRO', group_id: 'outro-grupo', active: true, unit: 'm' },
    { id: 'elastico-preto', name: 'ELÁSTICO ESPECIAL G · PRETO', group_id: ELASTICO_LEAF, active: true, unit: 'm' },
  ],
  groups: [
    { id: STRASS_GROUP, name: 'TIRA STRASS 6MM' },
    { id: GLOW, name: 'GLOW METALIC + MASSABOX' },
    { id: 'outro-grupo', name: 'TIRA STRASS 6MM — nome parecido' },
    { id: ELASTICO_LEAF, name: '25MM' },
    { id: 'familia-elastico', name: 'ELÁSTICO ESPECIAL G' },
  ],
};
const overlockLine = {
  id: 'posicao-1', technical_strap_line_id: 'posicao-1', label: 'TIRA 2',
  measure_id: OVERLOCK, strap_type_id: 'overlock',
  identity_basis: 'reference_base' as const, identity_group_id: null,
  color_mode: 'follow_main' as const, internal_production_enabled: true,
  material_mode: 'fixed_group' as const, material_group_id: GLOW,
  allowed_material_group_ids: [], base_group_id: GLOW, base_group_name: 'Glow',
  consumption: 61, consumption_per_size: { '34': 61, '35': 63 },
};

describe('technicalStrapSourcePolicy', () => {
  it('limita Strass 6 mm a seu grupo acabado sem herdar napa nem grupos por nome', () => {
    const policy = technicalStrapSourcePolicy(catalog, STRASS);
    expect(policy).toEqual({ loaded: true, allowsReferenceBase: false, finishedGroups: [catalog.groups[0]] });
    expect(isTechnicalStrapSourceAllowed({ identity_basis: 'reference_base' }, policy)).toBe(false);
    expect(isTechnicalStrapSourceAllowed({ identity_basis: 'finished_product_group', identity_group_id: GLOW }, policy)).toBe(false);
    expect(isTechnicalStrapSourceAllowed({ identity_basis: 'finished_product_group', identity_group_id: STRASS_GROUP }, policy)).toBe(true);
  });

  it('não oferece compra pronta de Strass para medida exclusivamente interna de Overlock', () => {
    expect(technicalStrapSourcePolicy(catalog, OVERLOCK)).toEqual({
      loaded: true, allowsReferenceBase: true, finishedGroups: [],
    });
  });

  it('Strass (sempre_sku_acabado) não vira artesanal mesmo com variante/receita residual no Hub', () => {
    const hybrid = {
      ...catalog,
      variants: [...catalog.variants, { ...catalog.variants[0], measure_id: STRASS }],
      recipes: [{ measure_id: STRASS, status: 'approved', valid_from: '2020-01-01T00:00:00Z' }],
    };
    expect(technicalStrapSourcePolicy(hybrid, STRASS)).toMatchObject({
      allowsReferenceBase: false, finishedGroups: [catalog.groups[0]],
    });
  });

  it('permite medida interna com receita aprovada antes da primeira variante por cor', () => {
    const prospect = { ...catalog, variants: [], recipes: [{ measure_id: OVERLOCK, status: 'approved', valid_from: '2020-01-01T00:00:00Z' }] };
    expect(technicalStrapSourcePolicy(prospect, OVERLOCK).allowsReferenceBase).toBe(true);
    expect(technicalStrapSourcePolicy({ ...prospect, recipes: [{ measure_id: OVERLOCK, status: 'draft' }] }, OVERLOCK).allowsReferenceBase).toBe(false);
    expect(technicalStrapSourcePolicy(prospect, STRASS).allowsReferenceBase).toBe(false);
  });

  it.each([
    ['2026-09-05T12:00:00Z', null, true],
    ['2026-09-05T12:00:01Z', null, false],
    ['2026-09-05T11:00:00Z', '2026-09-05T12:00:00Z', false],
    ['2026-09-05T11:00:00Z', '2026-09-05T12:00:01Z', true],
    [null, null, false],
    ['data inválida', null, false],
    ['2026-09-05T11:00:00Z', 'data inválida', false],
  ])('respeita vigência da receita aprovada de %s a %s', (validFrom, validTo, expected) => {
    const prospect = {
      ...catalog, variants: [], recipes: [{ measure_id: OVERLOCK, status: 'approved', valid_from: validFrom as string | null, valid_to: validTo as string | null }],
    };
    expect(technicalStrapSourcePolicy(prospect, OVERLOCK, Date.parse('2026-09-05T12:00:00Z')).allowsReferenceBase).toBe(expected);
  });

  it.each(['inactive_product', 'moved_product', 'inactive_variant', 'nonlinear_product'])('exclui origem pronta inválida: %s', reason => {
    const invalid = {
      ...catalog,
      variants: catalog.variants.map(variant => variant.measure_id !== STRASS ? variant : {
        ...variant,
        status: reason === 'inactive_variant' ? 'archived' : variant.status,
      }),
      products: catalog.products.map(product => product.id !== 'cristal' ? product : {
        ...product,
        active: reason !== 'inactive_product',
        group_id: reason === 'moved_product' ? GLOW : product.group_id,
        unit: reason === 'nonlinear_product' ? 'un' : product.unit,
      }),
    };
    expect(technicalStrapSourcePolicy(invalid, STRASS).finishedGroups).toEqual([]);
  });

  it('sem variante nesta medida, resolve o grupo acabado pelo inventário (caso Strass 15 mm)', () => {
    const invalid = {
      ...catalog,
      variants: catalog.variants.map(variant => variant.measure_id !== STRASS ? variant : {
        ...variant,
        measure_id: OVERLOCK,
      }),
    };
    expect(technicalStrapSourcePolicy(invalid, STRASS).finishedGroups).toEqual([catalog.groups[0]]);
    expect(technicalStrapSourcePolicy(invalid, STRASS).allowsReferenceBase).toBe(false);
  });

  it('bloqueia identidade enquanto falta catálogo ou a família/medida está inativa', () => {
    expect(technicalStrapSourcePolicy(undefined, STRASS)).toEqual({ loaded: false, allowsReferenceBase: false, finishedGroups: [] });
    expect(technicalStrapSourcePolicy(catalog, null)).toEqual({ loaded: false, allowsReferenceBase: false, finishedGroups: [] });
    expect(technicalStrapSourcePolicy(catalog, '')).toEqual({ loaded: false, allowsReferenceBase: false, finishedGroups: [] });
    expect(technicalStrapSourcePolicy({ ...catalog, types: [] }, STRASS).finishedGroups).toEqual([]);
    expect(technicalStrapSourcePolicy({ ...catalog, measures: [{ ...catalog.measures[1], active: false }] }, STRASS).finishedGroups).toEqual([]);
  });

  it('ELÁSTICO ESPECIAL G buy-ready resolve a folha 25MM pelos SKUs sem variante Hub', () => {
    const policy = technicalStrapSourcePolicy(catalog, ELASTICO);
    expect(policy).toEqual({
      loaded: true,
      allowsReferenceBase: false,
      finishedGroups: [{ id: ELASTICO_LEAF, name: 'ELÁSTICO ESPECIAL G · 25MM' }],
    });
    expect(isTechnicalStrapSourceAllowed({
      identity_basis: 'finished_product_group',
      identity_group_id: ELASTICO_LEAF,
    }, policy)).toBe(true);
    const applied = applyTechnicalStrapMeasureWithSource(overlockLine, catalog.measures[2], catalog);
    expect(applied).toMatchObject({
      measure_id: ELASTICO,
      strap_type_id: 'elastico',
      identity_basis: 'finished_product_group',
      identity_group_id: ELASTICO_LEAF,
      color_mode: 'select_on_order',
      internal_production_enabled: false,
    });
  });

  it('trocar Overlock por Strass escolhe o único grupo pronto e separa a cor, preservando geometria e posição', () => {
    const changed = applyTechnicalStrapMeasureWithSource(overlockLine, catalog.measures[1], catalog);
    expect(changed).toMatchObject({
      id: 'posicao-1', technical_strap_line_id: 'posicao-1', label: 'TIRA 2',
      measure_id: STRASS, strap_type_id: 'strass', identity_basis: 'finished_product_group',
      identity_group_id: STRASS_GROUP, color_mode: 'select_on_order', internal_production_enabled: false,
      material_mode: 'follow_reference', material_group_id: null, allowed_material_group_ids: [],
      base_group_id: null, base_group_name: null,
      consumption: 61, consumption_per_size: { '34': 61, '35': 63 },
    });
    expect(overlockLine.identity_basis).toBe('reference_base');
    expect(overlockLine.color_mode).toBe('follow_main');
  });

  it('retorna à produção interna ao escolher medida que não tem grupo pronto', () => {
    const readyLine = applyTechnicalStrapMeasureWithSource(overlockLine, catalog.measures[1], catalog);
    const internal = applyTechnicalStrapMeasureWithSource(readyLine, catalog.measures[0], catalog);
    expect(internal).toMatchObject({ measure_id: OVERLOCK, identity_basis: 'reference_base', identity_group_id: null, internal_production_enabled: true });
  });

  it('ao trocar para tira pronta, descarta origem artesanal mesmo com cadastro híbrido residual', () => {
    const hybrid = { ...catalog, variants: [...catalog.variants, { ...catalog.variants[0], measure_id: STRASS }] };
    const changed = applyTechnicalStrapMeasureWithSource(overlockLine, catalog.measures[1], hybrid);
    expect(changed).toMatchObject({
      identity_basis: 'finished_product_group',
      identity_group_id: STRASS_GROUP,
      color_mode: 'select_on_order',
      material_mode: 'follow_reference',
      material_group_id: null,
    });
  });

  it('exige escolha explícita se a nova medida possui mais de um grupo pronto', () => {
    const multiple = {
      ...catalog,
      variants: [...catalog.variants, { ...catalog.variants[1], base_group_id: 'outro-grupo', finished_product_id: 'sem-vinculo' }],
    };
    const changed = applyTechnicalStrapMeasureWithSource(overlockLine, catalog.measures[1], multiple);
    expect(changed).toMatchObject({ identity_basis: 'finished_product_group', identity_group_id: null, color_mode: 'select_on_order' });
    expect(isTechnicalStrapSourceAllowed(changed, technicalStrapSourcePolicy(multiple, STRASS))).toBe(false);
    const previouslyChosen = { ...changed, identity_group_id: 'outro-grupo' };
    expect(applyTechnicalStrapMeasureWithSource(previouslyChosen, catalog.measures[1], multiple).identity_group_id).toBe('outro-grupo');
  });

  it('Strass 15 mm com receita residual e sem variante Hub resolve o grupo acabado pelo nome', () => {
    const fifteen = 'medida-strass-15';
    const group15 = 'grupo-strass-15';
    const catalog15 = {
      ...catalog,
      measures: [
        ...catalog.measures,
        { id: fifteen, strap_type_id: 'strass', active: true, finished_width_mm: 15, origem_padrao: 'sempre_sku_acabado' as const },
      ],
      recipes: [{ measure_id: fifteen, status: 'approved', valid_from: '2020-01-01T00:00:00Z' }],
      products: [
        ...catalog.products,
        { id: 'strass-15-cristal', name: 'Cristal com fundo branco', group_id: group15, active: true, unit: 'm' },
      ],
      groups: [...catalog.groups, { id: group15, name: 'TIRA STRASS 15MM' }],
    };
    const policy = technicalStrapSourcePolicy(catalog15, fifteen);
    expect(policy.allowsReferenceBase).toBe(false);
    expect(policy.finishedGroups).toEqual([{ id: group15, name: 'TIRA STRASS 15MM' }]);
    const applied = applyTechnicalStrapMeasureWithSource(overlockLine, catalog15.measures[3], catalog15);
    expect(applied).toMatchObject({
      measure_id: fifteen,
      identity_basis: 'finished_product_group',
      identity_group_id: group15,
      color_mode: 'select_on_order',
      internal_production_enabled: false,
    });
  });
});

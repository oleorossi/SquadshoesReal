import { describe, expect, it } from 'vitest';
import {
  clearIncompatibleMobileStrapSelections,
  buildMobileSaleOrderItemsPayload,
  mobileIndependentStrapColorIssues,
  mobileIndependentStrapReviewLines,
  MOBILE_TECHNICAL_SHEET_SELECT,
  mobileReferenceSizes,
  mobileFinishedStrapIdentityIssues,
  mobileCommercialHeaderDefaults,
  mobileConfirmationCommercialIssue,
  mobileMaterialSelectionIssues,
  mobileOwnerSessionChanged,
  mobileSelectableStrapCatalogIssues,
  mobileSelectableStrapValidationIssues,
  normalizeMobileDraftStrapSnapshots,
  repriceMobileDraftItems,
  referencesWithMissingStrapSnapshot,
  resetMobileStrapsForMaterialChange,
  updateMobileDraftItem,
} from '../MobileNewOrder';
import type { PriceLookup } from '@/lib/mobile/clientContext';
import type { MobileSaleOrderData } from '@/lib/mobile/offlineQueue';
import type { ArtisanalStrapCatalog } from '@/hooks/useArtisanalStraps';

describe('referencesWithMissingStrapSnapshot', () => {
  const reference = {
    id: 'ref-tira',
    name: 'SOFT',
    has_straps: true,
    strap_colors: [],
  };

  it('bloqueia ficha com tiras habilitadas quando o item perdeu o snapshot', () => {
    const blocked = referencesWithMissingStrapSnapshot([
      {
        reference_id: reference.id,
        reference_name: reference.name,
        color: 'PRETO',
        grade: { '37': 10 },
        unit_price: 100,
        strap_colors: [],
      },
    ], [reference]);

    expect(blocked).toHaveLength(1);
  });

  it('deixa de bloquear quando existe uma linha técnica persistida, sem inferir identidade', () => {
    const blocked = referencesWithMissingStrapSnapshot([
      {
        reference_id: reference.id,
        reference_name: reference.name,
        color: 'PRETO',
        grade: { '37': 10 },
        unit_price: 100,
        strap_colors: [{
          technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
          color: '',
          color_id: null,
        }],
      },
    ], [reference]);

    expect(blocked).toHaveLength(0);
  });
});

describe('identidade comercial material no PV mobile', () => {
  const references = [{
    id: 'ref-1',
    name: 'BT01',
    variant_drives_upper: false,
    variant_drives_lining: true,
  }];
  const materialVariants = [{
    id: 'variant-1',
    reference_id: 'ref-1',
    material_name: 'Napa Soft',
    sku: 'BT01-SOFT',
    main_material_group_id: 'lining-group',
    active: true,
  }];
  const products = [
    { id: 'product-1', group_id: 'lining-group', color: 'PRETO', active: true },
    { id: 'product-2', group_id: 'lining-group', color: 'BRANCO', active: false },
  ];
  const groups = [{ id: 'lining-group', name: 'Napa Soft' }];

  it('exige material antes da cor e aceita somente cor de produto ativo do grupo efetivo', () => {
    const base = {
      reference_id: 'ref-1',
      reference_name: 'BT01',
      color: '',
      grade: { '37': 10 },
      unit_price: 120,
    };
    expect(mobileMaterialSelectionIssues([base], references, materialVariants, products, groups)[0])
      .toContain('selecione o material antes da cor');
    expect(mobileMaterialSelectionIssues([{
      ...base,
      material_variant_id: 'variant-1',
      color: 'BRANCO',
    }], references, materialVariants, products, groups)[0]).toContain('cor ativa');
    expect(mobileMaterialSelectionIssues([{
      ...base,
      material_variant_id: 'variant-1',
      color: 'PRETO',
    }], references, materialVariants, products, groups)).toEqual([]);
  });

  it('preserva o material da ficha como escolha válida quando ele não é duplicado por variante', () => {
    const sheetReference = {
      ...references[0],
      upper_material_group_id: 'sheet-group',
      upper_material: 'Napa da ficha',
    };
    const sheetProducts = [
      ...products,
      { id: 'sheet-product', group_id: 'sheet-group', color: 'CARAMELO', active: true },
    ];
    const sheetGroups = [...groups, { id: 'sheet-group', name: 'Napa da ficha' }];

    expect(mobileMaterialSelectionIssues([{
      reference_id: 'ref-1',
      reference_name: 'BT01',
      material_variant_id: null,
      color: 'CARAMELO',
      grade: { '37': 10 },
      unit_price: 120,
    }], [sheetReference], materialVariants, sheetProducts, sheetGroups)).toEqual([]);
  });

  it('não substitui a escolha da ficha por variante só porque ambas usam o mesmo grupo', () => {
    const sheetReference = {
      ...references[0],
      upper_material_group_id: 'lining-group',
      upper_material: 'Napa Soft da ficha',
    };
    expect(mobileMaterialSelectionIssues([{
      reference_id: 'ref-1',
      reference_name: 'BT01',
      material_variant_id: null,
      color: 'PRETO',
      grade: { '37': 10 },
      unit_price: 120,
    }], [sheetReference], materialVariants, products, groups)).toEqual([]);
  });

  it('persiste material_variant_id e preço congelado no mesmo payload online/offline', () => {
    const payload = buildMobileSaleOrderItemsPayload([{
      reference_id: 'ref-1',
      reference_name: 'BT01',
      color: 'PRETO',
      grade: { '37': 10 },
      unit_price: 137.5,
      material_variant_id: 'variant-1',
      material_variant_name: 'Napa Soft',
      material_variant_sku: 'BT01-SOFT',
    }]);

    expect(payload[0]).toMatchObject({
      reference_id: 'ref-1',
      material_variant_id: 'variant-1',
      color: 'PRETO',
      quantity: 10,
      unit_price: 137.5,
    });
    expect(payload[0]).not.toHaveProperty('material_variant_name');
    expect(payload[0]).not.toHaveProperty('material_variant_sku');
  });

  it('alinha somente reference_base follow_main e preserva cores selecionadas por posição', () => {
    const lineBase = '11111111-1111-4111-8111-111111111111';
    const lineIndependent = '88888888-8888-4888-8888-888888888888';
    const lineReady = '22222222-2222-4222-8222-222222222222';
    const draft = {
      reference_id: 'ref-1',
      reference_name: 'BT01',
      color: 'OFF WHITE',
      grade: { '37': 10 },
      unit_price: 137.5,
      strap_colors: [{
        technical_strap_line_id: lineBase,
        identity_basis: 'reference_base',
        color: 'PRETO',
        color_id: '33333333-3333-4333-8333-333333333333',
      }, {
        technical_strap_line_id: lineIndependent,
        identity_basis: 'reference_base',
        color_mode: 'select_on_order',
        strap_type_id: '55555555-5555-4555-8555-555555555555',
        measure_id: '66666666-6666-4666-8666-666666666666',
        color: 'DOURADO',
        color_id: '99999999-9999-4999-8999-999999999999',
      }, {
        technical_strap_line_id: lineReady,
        identity_basis: 'finished_product_group',
        identity_group_id: '44444444-4444-4444-8444-444444444444',
        strap_type_id: '55555555-5555-4555-8555-555555555555',
        measure_id: '66666666-6666-4666-8666-666666666666',
        color: 'STRASS PRATA',
        color_id: '77777777-7777-4777-8777-777777777777',
      }],
      strap_sourcing: {
        [lineBase]: { source_mode: 'internal' as const },
        [lineIndependent]: { source_mode: 'internal' as const },
        [lineReady]: { source_mode: 'buy_ready' as const },
      },
    };
    const payload = buildMobileSaleOrderItemsPayload([draft]);

    expect(payload[0].strap_colors?.[0]).toMatchObject({
      color_mode: 'follow_main',
      color: 'OFF WHITE',
      color_id: null,
    });
    expect(payload[0].strap_colors?.[1]).toMatchObject({
      color_mode: 'select_on_order',
      color: 'DOURADO',
      color_id: '99999999-9999-4999-8999-999999999999',
    });
    expect(payload[0].strap_colors?.[2]).toMatchObject({
      color_mode: 'select_on_order',
      color: 'STRASS PRATA',
      color_id: '77777777-7777-4777-8777-777777777777',
    });
    expect(payload[0].strap_sourcing).not.toHaveProperty(lineBase);
    expect(payload[0].strap_sourcing).toHaveProperty(lineIndependent);
    expect(payload[0].strap_sourcing).toHaveProperty(lineReady);
    expect(mobileFinishedStrapIdentityIssues([draft])).toEqual([]);
  });

  it('normaliza cache offline legado sem perder color_mode nem color_id independente', () => {
    const restored = normalizeMobileDraftStrapSnapshots([{
      reference_id: 'ref-1',
      reference_name: 'BT01',
      color: 'OFF WHITE',
      grade: { '37': 10 },
      unit_price: 137.5,
      strap_colors: [{
        technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
        identity_basis: 'reference_base',
        color: 'PRETO',
        color_id: '33333333-3333-4333-8333-333333333333',
      }, {
        technical_strap_line_id: '88888888-8888-4888-8888-888888888888',
        identity_basis: 'reference_base',
        color_mode: 'select_on_order',
        color: 'DOURADO',
        color_id: '99999999-9999-4999-8999-999999999999',
      }],
    }])[0];

    expect(restored.strap_colors?.[0]).toMatchObject({
      color_mode: 'follow_main',
      color: 'OFF WHITE',
      color_id: null,
    });
    expect(restored.strap_colors?.[1]).toMatchObject({
      color_mode: 'select_on_order',
      color: 'DOURADO',
      color_id: '99999999-9999-4999-8999-999999999999',
    });
  });

  it('ao trocar material preserva as cores independentes e limpa todo sourcing para recálculo', () => {
    const lineFollow = '11111111-1111-4111-8111-111111111111';
    const lineIndependent = '88888888-8888-4888-8888-888888888888';
    const reset = resetMobileStrapsForMaterialChange({
      reference_id: 'ref-1',
      reference_name: 'BT01',
      color: 'PRETO',
      grade: { '37': 10 },
      unit_price: 137.5,
      strap_colors: [{
        technical_strap_line_id: lineFollow,
        identity_basis: 'reference_base',
        color_mode: 'follow_main',
        color: 'PRETO',
        color_id: '33333333-3333-4333-8333-333333333333',
      }, {
        technical_strap_line_id: lineIndependent,
        identity_basis: 'reference_base',
        color_mode: 'select_on_order',
        color: 'DOURADO',
        color_id: '99999999-9999-4999-8999-999999999999',
      }],
      strap_sourcing: {
        [lineFollow]: { source_mode: 'internal' },
        [lineIndependent]: { source_mode: 'internal' },
      },
    });

    expect(reset.strap_colors?.[0]).toMatchObject({ color: '', color_id: null });
    expect(reset.strap_colors?.[1]).toMatchObject({
      color_mode: 'select_on_order',
      color: 'DOURADO',
      color_id: '99999999-9999-4999-8999-999999999999',
    });
    expect(reset.strap_sourcing).toEqual({});
  });

  it('exige cor canônica em reference_base select_on_order', () => {
    const baseItem = {
      reference_id: 'ref-1',
      reference_name: 'I91',
      color: 'OFF WHITE',
      grade: { '37': 10 },
      unit_price: 137.5,
    };
    const selectable = {
      technical_strap_line_id: '88888888-8888-4888-8888-888888888888',
      identity_basis: 'reference_base',
      color_mode: 'select_on_order',
      strap_type_id: '55555555-5555-4555-8555-555555555555',
      measure_id: '66666666-6666-4666-8666-666666666666',
      label: 'Tira 2',
      color: '',
      color_id: null,
    };

    expect(mobileIndependentStrapColorIssues([{
      ...baseItem,
      strap_colors: [selectable],
    }])[0]).toContain('I91: Tira 2');
    expect(mobileIndependentStrapColorIssues([{
      ...baseItem,
      strap_colors: [{
        ...selectable,
        color: 'DOURADO',
        color_id: '99999999-9999-4999-8999-999999999999',
      }],
    }])).toEqual([]);
    expect(mobileIndependentStrapColorIssues([{
      ...baseItem,
      strap_colors: [{ ...selectable, color_mode: undefined }],
    }])).toEqual([]);
  });

  it('limpa cor e sourcing incompatíveis com o novo grupo-base', () => {
    const lineId = '88888888-8888-4888-8888-888888888888';
    const blackId = '33333333-3333-4333-8333-333333333333';
    const goldId = '99999999-9999-4999-8999-999999999999';
    const catalog = {
      colors: [
        { id: blackId, name: 'PRETO', active: true },
        { id: goldId, name: 'DOURADO', active: true },
      ],
      aliases: [],
      official_products: [{
        base_group_id: 'group-new',
        color_id: blackId,
        official_product_id: 'product-black',
        status: 'active',
      }],
      products: [{
        id: 'product-black',
        name: 'NAPA PRETO',
        group_id: 'group-new',
        color: 'PRETO',
        active: true,
      }],
      variants: [],
    } as unknown as ArtisanalStrapCatalog;
    const item = {
      reference_id: 'ref-1',
      reference_name: 'I91',
      color: 'OFF WHITE',
      grade: { '37': 10 },
      unit_price: 137.5,
      strap_colors: [{
        technical_strap_line_id: lineId,
        identity_basis: 'reference_base',
        color_mode: 'select_on_order',
        color: 'DOURADO',
        color_id: goldId,
      }],
      strap_sourcing: {
        [lineId]: {
          source_mode: 'internal' as const,
          color_id: goldId,
          strap_variant_id: '77777777-7777-4777-8777-777777777777',
        },
      },
    };

    const result = clearIncompatibleMobileStrapSelections(item, catalog, [{
      technicalStrapLineId: lineId,
      baseGroupId: 'group-new',
    }]);

    expect(result.clearedLineIds).toEqual([lineId]);
    expect(result.item.strap_colors?.[0]).toMatchObject({ color: '', color_id: null });
    expect(result.item.strap_sourcing).not.toHaveProperty(lineId);
  });

  it('valida medida/tipo e membership da cor no grupo-base efetivo', () => {
    const lineId = '88888888-8888-4888-8888-888888888888';
    const typeId = '55555555-5555-4555-8555-555555555555';
    const measureId = '66666666-6666-4666-8666-666666666666';
    const groupId = '44444444-4444-4444-8444-444444444444';
    const blackId = '33333333-3333-4333-8333-333333333333';
    const goldId = '99999999-9999-4999-8999-999999999999';
    const catalog = {
      types: [{ id: typeId, name: 'Tira chata', active: true }],
      measures: [{ id: measureId, strap_type_id: typeId, display_name: '8 mm', finished_width_mm: 8, active: true }],
      colors: [
        { id: blackId, name: 'PRETO', active: true },
        { id: goldId, name: 'DOURADO', active: true },
      ],
      aliases: [],
      width_profiles: [],
      official_products: [{
        base_group_id: groupId,
        color_id: blackId,
        official_product_id: 'product-black',
        status: 'active',
      }],
      variants: [],
      recipes: [],
      legacy_recipes: [],
      products: [{
        id: 'product-black',
        name: 'NAPA PRETO',
        group_id: groupId,
        color: 'PRETO',
        active: true,
      }],
      groups: [],
      capabilities: {
        manage_strap_catalog: false,
        administer_strap_operations: false,
        approve_strap_recipe: false,
        execute_strap_batch: false,
        resolve_strap_migration: false,
      },
    } satisfies ArtisanalStrapCatalog;
    const item = {
      reference_id: 'ref-1',
      reference_name: 'I91',
      color: 'OFF WHITE',
      grade: { '37': 10 },
      unit_price: 137.5,
      strap_colors: [{
        technical_strap_line_id: lineId,
        identity_basis: 'reference_base',
        color_mode: 'select_on_order',
        strap_type_id: typeId,
        measure_id: measureId,
        label: 'Tira 2',
        color: 'PRETO',
        color_id: blackId,
      }],
    };
    const resolved = [{ technicalStrapLineId: lineId, baseGroupId: groupId }];

    expect(mobileSelectableStrapCatalogIssues(item, catalog, resolved)).toEqual([]);
    expect(mobileSelectableStrapCatalogIssues({
      ...item,
      strap_colors: [{ ...item.strap_colors[0], color: 'DOURADO', color_id: goldId }],
    }, catalog, resolved)[0]).toContain('não pertence ao grupo-base efetivo');
    expect(mobileSelectableStrapCatalogIssues({
      ...item,
      strap_colors: [{ ...item.strap_colors[0], measure_id: blackId }],
    }, catalog, resolved)[0]).toContain('família/medida ativa e compatível');
    expect(mobileSelectableStrapCatalogIssues(item, catalog, [
      { technicalStrapLineId: lineId, baseGroupId: null },
    ])[0]).toContain('grupo-base efetivo');
  });

  it('permite enfileirar offline um snapshot completo sem depender do catálogo/preview em memória', () => {
    const item = {
      reference_id: 'ref-1',
      reference_name: 'I91',
      color: 'COR COMERCIAL FORA DO CATÁLOGO DE TIRAS',
      grade: { '37': 10 },
      unit_price: 137.5,
      strap_colors: [{
        technical_strap_line_id: '88888888-8888-4888-8888-888888888888',
        identity_basis: 'reference_base',
        color_mode: 'select_on_order',
        strap_type_id: '55555555-5555-4555-8555-555555555555',
        measure_id: '66666666-6666-4666-8666-666666666666',
        label: 'Tira 1',
        color: 'DOURADO',
        color_id: '99999999-9999-4999-8999-999999999999',
      }, {
        technical_strap_line_id: '22222222-2222-4222-8222-222222222222',
        identity_basis: 'finished_product_group',
        identity_group_id: '44444444-4444-4444-8444-444444444444',
        color_mode: 'select_on_order',
        strap_type_id: '55555555-5555-4555-8555-555555555555',
        measure_id: '66666666-6666-4666-8666-666666666666',
        label: 'Tira 2',
        color: 'STRASS PRATA',
        color_id: '77777777-7777-4777-8777-777777777777',
      }],
    };

    expect(mobileSelectableStrapValidationIssues({
      item,
      online: false,
      catalog: undefined,
      catalogLoading: true,
      catalogError: 'network unavailable',
      resolvedLines: [],
      resolvedLinesLoading: true,
      resolvedLinesFailed: true,
    })).toEqual([]);
    expect(mobileSelectableStrapValidationIssues({
      item,
      online: true,
      catalog: undefined,
      catalogLoading: false,
      catalogError: 'network unavailable',
      resolvedLines: [],
      resolvedLinesLoading: false,
      resolvedLinesFailed: true,
    })[0]).toContain('não foi possível carregar o catálogo');
  });

  it('mantém a validação estrutural obrigatória no modo offline', () => {
    const item = {
      reference_id: 'ref-1',
      reference_name: 'I91',
      color: 'OFF WHITE',
      grade: { '37': 10 },
      unit_price: 137.5,
      strap_colors: [{
        technical_strap_line_id: '88888888-8888-4888-8888-888888888888',
        identity_basis: 'reference_base',
        color_mode: 'select_on_order',
        strap_type_id: '55555555-5555-4555-8555-555555555555',
        measure_id: null,
        label: 'Tira 1',
        color: 'DOURADO',
        color_id: '99999999-9999-4999-8999-999999999999',
      }],
    };

    expect(mobileSelectableStrapValidationIssues({
      item,
      online: false,
      catalog: undefined,
      catalogLoading: false,
      catalogError: null,
      resolvedLines: [],
      resolvedLinesLoading: false,
      resolvedLinesFailed: false,
    })[0]).toContain('identidade estrutural completa');
  });

  it('resume as cores independentes na sequência TIRA N da revisão', () => {
    const lines = mobileIndependentStrapReviewLines({
      reference_id: 'ref-1',
      reference_name: 'I91',
      color: 'OFF WHITE',
      grade: { '37': 10 },
      unit_price: 137.5,
      strap_colors: [{
        identity_basis: 'reference_base',
        color_mode: 'follow_main',
        color: 'OFF WHITE',
      }, {
        technical_strap_line_id: '88888888-8888-4888-8888-888888888888',
        identity_basis: 'reference_base',
        color_mode: 'select_on_order',
        color: 'DOURADO',
      }, {
        technical_strap_line_id: '99999999-9999-4999-8999-999999999999',
        identity_basis: 'finished_product_group',
        color: 'PRETO',
      }],
    });

    expect(lines.map((line) => [line.position, line.color])).toEqual([
      ['TIRA 2', 'DOURADO'],
      ['TIRA 3', 'PRETO'],
    ]);
  });

  it('descarta callback assíncrono velho sem sobrescrever outro item', () => {
    const first = {
      reference_id: 'ref-1', reference_name: 'I91', color: 'PRETO', grade: {}, unit_price: 100,
    };
    const second = {
      reference_id: 'ref-2', reference_name: 'I90', color: 'BRANCO', grade: {}, unit_price: 120,
    };
    const current = [first, second];
    const updated = updateMobileDraftItem(current, first, 0, (item) => ({ ...item, unit_price: 130 }));

    expect(updated[0].unit_price).toBe(130);
    expect(updated[1]).toBe(second);
    expect(updateMobileDraftItem(updated, first, 0, () => ({ ...first, unit_price: 90 }))).toBe(updated);
  });

  it('não exige source client-side, mas bloqueia cor/estrutura incompleta do produto acabado', () => {
    const baseItem = {
      reference_id: 'ref-1',
      reference_name: 'BT01',
      color: 'OFF WHITE',
      grade: { '37': 10 },
      unit_price: 137.5,
    };
    const finished = {
      technical_strap_line_id: '22222222-2222-4222-8222-222222222222',
      identity_basis: 'finished_product_group',
      identity_group_id: '44444444-4444-4444-8444-444444444444',
      strap_type_id: '55555555-5555-4555-8555-555555555555',
      measure_id: '66666666-6666-4666-8666-666666666666',
      color: 'STRASS PRATA',
      color_id: '77777777-7777-4777-8777-777777777777',
    };

    expect(mobileFinishedStrapIdentityIssues([{
      ...baseItem,
      strap_colors: [finished],
      strap_sourcing: {},
    }])).toEqual([]);
    expect(mobileFinishedStrapIdentityIssues([{
      ...baseItem,
      strap_colors: [{ ...finished, color_id: null }],
      strap_sourcing: {},
    }])[0]).toContain('cor canônica própria');
    expect(mobileFinishedStrapIdentityIssues([{
      ...baseItem,
      strap_colors: [{ ...finished, identity_group_id: null }],
      strap_sourcing: {},
    }])[0]).toContain('identidade estrutural completa');
  });

  it('carrega o preço-base da ficha e respeita tabela > variante > ficha', () => {
    expect(MOBILE_TECHNICAL_SHEET_SELECT).toContain('sale_price');
    expect(MOBILE_TECHNICAL_SHEET_SELECT).toContain('status_ficha');
    expect(MOBILE_TECHNICAL_SHEET_SELECT).toContain('sizes');
    expect(MOBILE_TECHNICAL_SHEET_SELECT).toContain('upper_material_group_id');
    const lookup: PriceLookup = {
      byRefColor: new Map([['ref-1::PRETO', [
        { minQty: 1, price: 140 },
        { minQty: 100, price: 130 },
      ]]]),
      byRef: new Map(),
    };
    const item = {
      reference_id: 'ref-1',
      reference_name: 'BT01',
      material_variant_id: 'variant-1',
      color: 'PRETO',
      grade: { '37': 120 },
      unit_price: 0,
      unit_price_source: 'missing' as const,
    };
    const pricedByTable = repriceMobileDraftItems(
      [item],
      lookup,
      [{ ...references[0], sale_price: 160 }],
      [{ ...materialVariants[0], unit_price_override: 150 }],
    )[0];
    expect(pricedByTable).toMatchObject({ unit_price: 130, unit_price_source: 'table_color' });

    const pricedByVariant = repriceMobileDraftItems(
      [{ ...item, grade: { '37': 10 } }],
      { byRefColor: new Map(), byRef: new Map() },
      [{ ...references[0], sale_price: 160 }],
      [{ ...materialVariants[0], unit_price_override: 150 }],
    )[0];
    expect(pricedByVariant).toMatchObject({ unit_price: 150, unit_price_source: 'material_variant' });

    const pricedBySheet = repriceMobileDraftItems(
      [{ ...item, material_variant_id: null }],
      { byRefColor: new Map(), byRef: new Map() },
      [{ ...references[0], sale_price: 160 }],
      materialVariants,
    )[0];
    expect(pricedBySheet).toMatchObject({ unit_price: 160, unit_price_source: 'technical_sheet' });
  });

  it('usa primeiro a faixa física publicada na ficha em vez da categoria genérica', () => {
    expect(mobileReferenceSizes({
      id: 'infantil-com-faixa',
      name: 'I90',
      sizes: '25-34',
      status_ficha: 'publicada',
      shoe_category: { name: 'Adulto' },
    })).toEqual(['25', '26', '27', '28', '29', '30', '31', '32', '33', '34']);
  });

  it('recalcula faixa automática pela grade sem sobrescrever preço manual', () => {
    const lookup: PriceLookup = {
      byRefColor: new Map(),
      byRef: new Map([['ref-1', [
        { minQty: 1, price: 140 },
        { minQty: 100, price: 130 },
      ]]]),
    };
    const automatic = repriceMobileDraftItems([{
      reference_id: 'ref-1',
      reference_name: 'BT01',
      color: 'PRETO',
      grade: { '37': 120 },
      unit_price: 140,
      unit_price_source: 'table_reference',
    }], lookup, references, materialVariants)[0];
    expect(automatic).toMatchObject({ unit_price: 130, unit_price_source: 'table_reference' });

    const manual = repriceMobileDraftItems([{
      ...automatic,
      unit_price: 137.5,
      unit_price_source: 'manual',
    }], lookup, references, materialVariants)[0];
    expect(manual).toMatchObject({ unit_price: 137.5, unit_price_source: 'manual' });
  });
});

describe('defaults comerciais no cabeçalho mobile', () => {
  it('preenche condição, factoring e frete antes de criar o Rascunho', () => {
    const defaults = mobileCommercialHeaderDefaults({
      price_list_id: 'price-list-1',
      payment_condition: '30/60',
      factoring_config_id: 'factoring-1',
      modalidade_frete: 'CIF',
      transport_company_id: 'transport-1',
      discount_pct: 0,
      credit_limit: 0,
      block_new_orders: false,
      block_reason: null,
      inherited_from: 'client',
    });

    expect(defaults).toEqual({
      payment_condition: '30/60',
      factoring_config_id: 'factoring-1',
      modalidade_frete: 'CIF',
      transport_company_id: 'transport-1',
    });
    expect(mobileConfirmationCommercialIssue({
      payment_condition: '30/60',
    } as MobileSaleOrderData)).toBeNull();
  });

  it('bloqueia somente a confirmação quando não há condição padrão', () => {
    const defaults = mobileCommercialHeaderDefaults(null);
    expect(mobileConfirmationCommercialIssue(defaults as MobileSaleOrderData))
      .toContain('salvo em Rascunho');
  });
});

describe('isolamento da sessão mobile por owner', () => {
  it('detecta troca real de usuário para rotacionar client_request_id e zerar o editor', () => {
    expect(mobileOwnerSessionChanged('vendedor-a', 'vendedor-b')).toBe(true);
    expect(mobileOwnerSessionChanged('vendedor-a', 'vendedor-a')).toBe(false);
    expect(mobileOwnerSessionChanged('', 'vendedor-a')).toBe(false);
  });
});

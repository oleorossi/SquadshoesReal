import { describe, expect, it } from 'vitest';
import {
  buildMobileSaleOrderItemsPayload,
  MOBILE_TECHNICAL_SHEET_SELECT,
  mobileReferenceSizes,
  mobileFinishedStrapIdentityIssues,
  mobileCommercialHeaderDefaults,
  mobileConfirmationCommercialIssue,
  mobileMaterialSelectionIssues,
  mobileOwnerSessionChanged,
  repriceMobileDraftItems,
  referencesWithMissingStrapSnapshot,
} from '../MobileNewOrder';
import type { PriceLookup } from '@/lib/mobile/clientContext';
import type { MobileSaleOrderData } from '@/lib/mobile/offlineQueue';

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

  it('alinha reference_base ao cabedal e preserva a cor própria do produto acabado', () => {
    const lineBase = '11111111-1111-4111-8111-111111111111';
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
        technical_strap_line_id: lineReady,
        identity_basis: 'finished_product_group',
        identity_group_id: '44444444-4444-4444-8444-444444444444',
        strap_type_id: '55555555-5555-4555-8555-555555555555',
        measure_id: '66666666-6666-4666-8666-666666666666',
        color: 'STRASS PRATA',
        color_id: '77777777-7777-4777-8777-777777777777',
      }],
      strap_sourcing: {},
    };
    const payload = buildMobileSaleOrderItemsPayload([draft]);

    expect(payload[0].strap_colors?.[0]).toMatchObject({
      color: 'OFF WHITE',
      color_id: null,
    });
    expect(payload[0].strap_colors?.[1]).toMatchObject({
      color: 'STRASS PRATA',
      color_id: '77777777-7777-4777-8777-777777777777',
    });
    expect(mobileFinishedStrapIdentityIssues([draft])).toEqual([]);
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

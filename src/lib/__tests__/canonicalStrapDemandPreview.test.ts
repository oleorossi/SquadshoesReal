import { describe, expect, it } from 'vitest';
import {
  canonicalStrapCutRows,
  collapseDuplicateStaleStrapPreviews,
  formatCanonicalStrapProductName,
  parseCanonicalStrapDemandPreview,
  replaceWithCanonicalStrapRows,
  type CanonicalStrapConsumptionRow,
} from '../canonicalStrapDemandPreview';

const ctx = {
  allProducts: [
    { id: 'finished-soft', quantity: 30, reserved_stock: 5 },
    { id: 'finished-madrid', quantity: 10, reserved_stock: 0 },
  ],
  productGroups: [],
} as any;

const preview = (overrides: Record<string, unknown> = {}) => parseCanonicalStrapDemandPreview({
  sale_order_item_id: 'item-1',
  technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
  strap_variant_id: 'variant-soft',
  source_mode: 'internal',
  gross_required_m: 640,
  recipe_id: 'recipe-soft',
  base_product_id: 'base-soft',
  finished_product_id: 'finished-soft',
  blocking_reasons: [],
  resolved: {
    strap_product_name: 'TIRA CHATA 8MM · NAPA SOFT',
    measure_name: 'CHATA 8MM',
    strap_color_name: 'OFF WHITE',
    base_product_name: 'NAPA SOFT · OFF WHITE',
    confirmed_yield_m_per_m: 64,
    base_required_m: 10,
    cut_band_width_mm: 20,
    usable_base_width_mm_snapshot: 1370,
    theoretical_yield_m_per_m: 68,
  },
  ...overrides,
});

describe('preview canônica de tiras', () => {
  it('rótulo usa a medida da ficha quando o SKU acabado não veio', () => {
    const orphan = preview({
      strap_variant_id: null,
      recipe_id: null,
      base_product_id: null,
      finished_product_id: null,
      blocking_reasons: [{
        code: 'frozen_source_snapshot_stale',
        message: 'A origem congelada da tira diverge do catalogo; salve novamente o pedido antes de confirmar.',
      }],
      resolved: {
        strap_product_name: null,
        measure_name: 'CHATA 8 mm',
        strap_color_name: 'OFF WHITE',
        base_group_name: 'NAPA MADRID',
        confirmed_yield_m_per_m: null,
        base_required_m: null,
      },
    });
    expect(formatCanonicalStrapProductName(orphan)).toBe(
      'TIRA CHATA 8 mm · NAPA MADRID · OFF WHITE',
    );
  });

  it('remove fantasma OFF WHITE que só duplica a CHATA já conferida (PV-00193)', () => {
    const healthy = preview({
      sale_order_item_id: 'item-off',
      technical_strap_line_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      strap_variant_id: 'variant-madrid',
      recipe_id: 'recipe-madrid',
      base_product_id: 'base-madrid',
      finished_product_id: 'finished-madrid',
      gross_required_m: 1044,
      resolved: {
        strap_product_name: 'TIRA CHATA 8 mm · NAPA MADRID · OFF WHITE',
        measure_name: 'CHATA 8 mm',
        strap_color_name: 'OFF WHITE',
        base_group_name: 'NAPA MADRID',
        base_product_name: 'NAPA MADRID · OFF WHITE',
        confirmed_yield_m_per_m: 70,
        base_required_m: 14.91,
      },
    });
    const ghost = preview({
      sale_order_item_id: 'item-off',
      technical_strap_line_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      strap_variant_id: null,
      recipe_id: null,
      base_product_id: null,
      finished_product_id: null,
      gross_required_m: 1044,
      blocking_reasons: [
        { code: 'variant_snapshot_stale', message: 'Variante escolhida nao corresponde mais a identidade tecnica atual.' },
        { code: 'frozen_source_snapshot_stale', message: 'A origem congelada da tira diverge do catalogo; salve novamente o pedido antes de confirmar.' },
      ],
      resolved: {
        strap_product_name: null,
        measure_name: 'CHATA 8 mm',
        strap_color_name: 'OFF WHITE',
        base_group_name: 'NAPA MADRID',
        confirmed_yield_m_per_m: null,
        base_required_m: null,
      },
    });

    const collapsed = collapseDuplicateStaleStrapPreviews([healthy, ghost]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].technicalStrapLineId).toBe(healthy.technicalStrapLineId);

    const rows = replaceWithCanonicalStrapRows([], ctx, [healthy, ghost]) as CanonicalStrapConsumptionRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].groupName).toContain('CHATA 8 mm');
    expect(rows[0].artisanal?.pending).toBeFalsy();
    expect(canonicalStrapCutRows([healthy, ghost])).toHaveLength(1);
  });

  it('não apaga uma 2ª medida real bloqueada (outra metragem)', () => {
    const healthy = preview();
    const otherMeasure = preview({
      technical_strap_line_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      strap_variant_id: null,
      recipe_id: null,
      base_product_id: null,
      finished_product_id: null,
      gross_required_m: 200,
      blocking_reasons: [{
        code: 'frozen_source_snapshot_stale',
        message: 'A origem congelada da tira diverge do catalogo',
      }],
      resolved: {
        strap_product_name: null,
        measure_name: 'OVERLOCK 5MM',
        strap_color_name: 'OFF WHITE',
        base_group_name: 'NAPA SOFT',
      },
    });
    const collapsed = collapseDuplicateStaleStrapPreviews([healthy, otherMeasure]);
    expect(collapsed).toHaveLength(2);
    const [row] = replaceWithCanonicalStrapRows([], ctx, [otherMeasure]) as CanonicalStrapConsumptionRow[];
    expect(row.groupName).toBe('TIRA OVERLOCK 5MM · NAPA SOFT · OFF WHITE');
  });

  it('soma posições do mesmo material físico, mas separa snapshots com outro SKU base', () => {
    const rows = replaceWithCanonicalStrapRows([], ctx, [preview(),
      preview({ technical_strap_line_id: 'outra-posicao' }),
      preview({ technical_strap_line_id: 'sku-historico', base_product_id: 'outro-sku-soft' }),
    ]) as CanonicalStrapConsumptionRow[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ baseProductId: 'base-soft', totalQuantity: 1280 });
    expect(rows[0].artisanal?.baseQty).toBe(20);
    expect(rows[1]).toMatchObject({ baseProductId: 'outro-sku-soft', totalQuantity: 640 });
    expect(canonicalStrapCutRows([preview(), preview({ base_product_id: 'outro-sku-soft' })])).toHaveLength(2);
  });

  it('explica transformação ainda não congelada sem inventar base nem bloquear o worker', () => {
    const warning = 'A transformação física será congelada na primeira demanda.';
    const pending = preview({ resolved: {
      strap_product_name: 'TIRA TESTE', strap_color_name: 'PRETO',
      base_product_name: 'NAPA TESTE', confirmed_yield_m_per_m: null,
      base_required_m: null, snapshot_warning: warning,
    } });
    expect(pending.blockingReasons).toEqual([]);
    expect(pending.snapshotWarning).toBe(warning);
    const [row] = replaceWithCanonicalStrapRows([], ctx, [pending]) as CanonicalStrapConsumptionRow[];
    expect(row.totalQuantity).toBe(640);
    expect(row.warning).toBe(warning);
    expect(row.artisanal).toMatchObject({ pending: true, baseQty: 0 });
    const [cut] = canonicalStrapCutRows([pending]);
    expect(cut.metros_necessarios).toBe(640);
    expect(cut.canonical).toMatchObject({ baseRequiredM: 0, snapshotWarning: warning, blockingReasons: [] });
  });

  it('mantém uma pendência neutra quando a preview não provou a identidade exata', () => {
    const rows = replaceWithCanonicalStrapRows([
      {
        componentType: 'Tiras', groupName: 'TIRA CHATA', materialName: 'Tira por nome',
        productUnit: 'm', color: 'OFF WHITE', totalQuantity: 999,
      },
      {
        componentType: 'Cabedal', groupName: 'NAPA SOFT', materialName: 'Cabedal',
        productUnit: 'm', color: 'OFF WHITE', totalQuantity: 2,
      },
    ], ctx, []) as any[];

    expect(rows).toHaveLength(2);
    const unresolved = rows.find((row) => row.componentType === 'Tiras');
    expect(unresolved).toMatchObject({
      groupName: 'Demanda de tira não resolvida',
      totalQuantity: 0,
      productIds: [],
    });
    expect(unresolved.warning).toContain('permanece bloqueada');
    expect(rows.some((row) => row.totalQuantity === 999)).toBe(false);
  });

  it('usa IDs exatos e substitui a linha agregada por nome', () => {
    const rows = replaceWithCanonicalStrapRows([
      {
        componentType: 'Tiras', groupName: 'TIRA CHATA', materialName: 'Tira 1',
        productUnit: 'm', color: 'OFF WHITE', totalQuantity: 999,
      },
      {
        componentType: 'Cabedal', groupName: 'NAPA SOFT', materialName: 'Cabedal',
        productUnit: 'm', color: 'OFF WHITE', totalQuantity: 2,
      },
    ], ctx, [preview()]) as any[];

    expect(rows.filter((row) => row.componentType === 'Tiras')).toHaveLength(1);
    const strap = rows.find((row) => row.componentType === 'Tiras');
    expect(strap.strapVariantId).toBe('variant-soft');
    expect(strap.productIds).toEqual(['finished-soft']);
    expect(strap.available).toBe(25);
    expect(strap.artisanal).toEqual({
      baseName: 'NAPA SOFT', baseQty: 10, yieldPerMeter: 64,
      pending: undefined,
    });
    expect(rows.some((row) => row.totalQuantity === 999)).toBe(false);
  });

  it('não mistura SOFT e MADRID com a mesma cor', () => {
    const madrid = preview({
      technical_strap_line_id: '22222222-2222-4222-8222-222222222222',
      strap_variant_id: 'variant-madrid',
      recipe_id: 'recipe-madrid',
      base_product_id: 'base-madrid',
      finished_product_id: 'finished-madrid',
      gross_required_m: 100,
      resolved: {
        strap_product_name: 'TIRA CHATA 8MM · NAPA MADRID',
        strap_color_name: 'OFF WHITE',
        base_product_name: 'NAPA MADRID · OFF WHITE',
        confirmed_yield_m_per_m: 50,
        base_required_m: 2,
        cut_band_width_mm: 22,
        usable_base_width_mm_snapshot: 1370,
        theoretical_yield_m_per_m: 62,
      },
    });
    const rows = replaceWithCanonicalStrapRows([], ctx, [preview(), madrid]) as any[];
    expect(rows.map((row) => row.strapVariantId)).toEqual(['variant-soft', 'variant-madrid']);
    expect(rows.map((row) => row.baseProductId)).toEqual(['base-soft', 'base-madrid']);
  });

  it('coloca a tira na família do grupo, não no SKU com cor (PV-00169 Massabox)', () => {
    const massabox = preview({
      technical_strap_line_id: '33333333-3333-4333-8333-333333333333',
      strap_variant_id: 'variant-glow',
      recipe_id: 'recipe-glow',
      base_product_id: 'base-glow-cobre',
      finished_product_id: 'finished-soft',
      gross_required_m: 160,
      resolved: {
        strap_product_name: 'TIRA OVERLOCK 5MM',
        strap_color_name: 'COBRE',
        base_group_name: 'GLOW METALIC + MASSABOX',
        base_product_name: 'GLOW METALIC + MASSABOX - COBRE',
        confirmed_yield_m_per_m: 60.6,
        base_required_m: 2.64,
        cut_band_width_mm: 20,
        usable_base_width_mm_snapshot: 1370,
        theoretical_yield_m_per_m: 68,
      },
    });
    const [row] = replaceWithCanonicalStrapRows([], ctx, [massabox]) as CanonicalStrapConsumptionRow[];
    expect(row.artisanal?.baseName).toBe('GLOW METALIC + MASSABOX');
    expect(row.materialFamily).toBe('GLOW METALIC + MASSABOX');
    expect(row.color).toBe('COBRE');

    // Sem base_group_name, ainda tira o sufixo do SKU.
    const skuOnly = preview({
      technical_strap_line_id: '44444444-4444-4444-8444-444444444444',
      resolved: {
        strap_product_name: 'TIRA OVERLOCK 5MM',
        strap_color_name: 'COBRE',
        base_product_name: 'GLOW METALIC + MASSABOX COBRE',
        confirmed_yield_m_per_m: 60,
        base_required_m: 2,
      },
    });
    const [fallback] = replaceWithCanonicalStrapRows([], ctx, [skuOnly]) as CanonicalStrapConsumptionRow[];
    expect(fallback.artisanal?.baseName).toBe('GLOW METALIC + MASSABOX');
  });

  it('não deixa uma linha resolvida esconder outra sem linha técnica', () => {
    const pending = preview({
      technical_strap_line_id: null,
      strap_variant_id: null,
      source_mode: null,
      gross_required_m: 0,
      blocking_reasons: [{
        code: 'technical_line_missing',
        message: 'Linha técnica não resolvida.',
      }],
      resolved: {},
    });

    const rows = replaceWithCanonicalStrapRows([], ctx, [preview(), pending]) as CanonicalStrapConsumptionRow[];
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ strapVariantId: 'variant-soft' }),
      expect.objectContaining({
        strapVariantId: null,
        technicalStrapLineIds: [''],
        warning: 'Linha técnica não resolvida.',
      }),
    ]));
  });

  it('usa a metragem de napa e o rendimento canônicos sem reconstruir rolo fixo', () => {
    const rows = canonicalStrapCutRows([preview()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].metros_necessarios).toBe(640);
    expect(rows[0].canonical).toMatchObject({
      baseRequiredM: 10,
      confirmedYieldMPerM: 64,
      usableBaseWidthMm: 1370,
      theoreticalYieldMPerM: 68,
      transformationCostPerM: null,
    });
    expect(rows[0].cut.valid).toBe(false);
    expect(rows[0].cut.n_bandas).toBe(0);
  });

  it('extrai o custo de mão de obra do catalog e preserva R$/m na agregação', () => {
    const withCost = preview({
      resolved: {
        strap_product_name: 'TIRA CHATA 8MM · NAPA SOFT',
        strap_color_name: 'OFF WHITE',
        base_product_name: 'NAPA SOFT · OFF WHITE',
        confirmed_yield_m_per_m: 64,
        base_required_m: 10,
        cut_band_width_mm: 20,
        usable_base_width_mm_snapshot: 1370,
        theoretical_yield_m_per_m: 68,
        catalog: { transformation_cost_per_m: 1.25 },
      },
    });
    expect(withCost.transformationCostPerM).toBe(1.25);

    const fromTopLevel = preview({
      sale_order_item_id: 'item-2',
      gross_required_m: 320,
      resolved: {
        strap_product_name: 'TIRA CHATA 8MM · NAPA SOFT',
        strap_color_name: 'OFF WHITE',
        base_product_name: 'NAPA SOFT · OFF WHITE',
        confirmed_yield_m_per_m: 64,
        base_required_m: 5,
        transformation_cost_per_m: 1.25,
      },
    });
    const [cut] = canonicalStrapCutRows([withCost, fromTopLevel]);
    expect(cut.metros_necessarios).toBe(960);
    expect(cut.canonical?.baseRequiredM).toBe(15);
    expect(cut.canonical?.transformationCostPerM).toBe(1.25);
  });

  it('mantém bloqueio acionável quando a receita exata não existe', () => {
    const blocked = preview({
      recipe_id: null,
      blocking_reasons: [{ code: 'recipe_missing', message: 'Cadastre e aprove a receita exata.' }],
      resolved: {
        strap_product_name: 'TIRA CHATA 8MM · NAPA SOFT',
        strap_color_name: 'OFF WHITE',
        base_product_name: 'NAPA SOFT · OFF WHITE',
        confirmed_yield_m_per_m: null,
        base_required_m: null,
        cut_band_width_mm: null,
      },
    });
    const [row] = replaceWithCanonicalStrapRows([], ctx, [blocked]) as any[];
    expect(row.artisanal.pending).toBe(true);
    expect(row.warning).toContain('Cadastre e aprove');
  });
});

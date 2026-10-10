/**
 * R-Consumo (spec `specs/tiras-redesenho.md`, D8/D9/D10/D15) travado pelo
 * PV-00224 — item DÁLIA, 12 pares, grade {34:1,35:1,36:2,37:3,38:2,39:2,40:1},
 * 4 linhas de tira Fazer (50/50/52/42 cm/par) com rendimento 70 m/m.
 *
 * Conta manual: 12 × 50 / 100 = 6,00 m · 12 × 52 / 100 = 6,24 m ·
 * 12 × 42 / 100 = 5,04 m. Napa = metros a fazer ÷ 70.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalStrapCutRows,
  parseCanonicalStrapDemandPreview,
  replaceWithCanonicalStrapRows,
  strapNapaBlockReason,
  strapSizeBreakdown,
  type CanonicalStrapConsumptionRow,
  type StrapLineSpec,
  type StrapScopeInfo,
} from '../canonicalStrapDemandPreview';
import { annotateConsumptionAvailability, type ConsumptionRow } from '../consumptionRows';
import {
  countShort,
  rowShortfall,
  STRAP_METER_TOTAL_UNIT,
  subtotalUnitKey,
  toPurchaseDecisionRows,
  topShortfalls,
  unitTotals,
} from '../consumptionAvailability';
import { aggregateStrapNapaSector } from '../strapRollCut';
import { buildBuyList } from '../buyList';
import { buildOrderReferencePartitions } from '../consumptionPartitions';
import { alignConsumptionRowsToDisplayUnit } from '../alignConsumptionToStockUnit';
import { buildMaterialConsumptionReportHtml } from '../materialConsumptionReport';
import {
  strapNapaDisplay,
  strapSizeMetersText,
  strapStockSplitText,
} from '../strapConsumptionDisplay';

const SALE_ORDER = '8b84c32d-81a5-4aa6-b7ba-a43cec23af1f';
const ITEM_DALIA = '1328e6aa-3c0e-46aa-9dca-f32553a1c27d';
const ITEM_PRATA = '470fcbd3-0000-4000-8000-000000000000';
const REF_G01 = '88e1ef41-e422-4d47-bf6e-26a62f3749d0';
const GRADE = { 34: 1, 35: 1, 36: 2, 37: 3, 38: 2, 39: 2, 40: 1 };
const SIZES = ['34', '35', '36', '37', '38', '39', '40'];

const LINE_IDS = [
  '0ac6b8ab-9feb-4261-9d7d-a22fe3e7c05a',
  '62299082-d444-4923-ae09-1664f2babda7',
  'c83e5873-9245-4125-9747-18d8da657569',
  '5a01b2d8-dc26-457f-80e0-a5fa172ebb14',
];
const CM_PER_PAIR = [50, 50, 52, 42];
const LABELS = ['TIRA 1', 'TIRA 2', 'TRASEIRA', 'TRASEIRA'];

const flatPerSize = (cm: number) => Object.fromEntries(SIZES.map((size) => [size, cm]));

const lineSpecs = new Map<string, StrapLineSpec>(LINE_IDS.map((id, index) => [id, {
  label: LABELS[index],
  consumptionPerSize: flatPerSize(CM_PER_PAIR[index]),
  consumption: CM_PER_PAIR[index],
}]));

const scopeByKey = new Map<string, StrapScopeInfo>([
  [ITEM_DALIA, { saleOrderId: SALE_ORDER, referenceId: REF_G01, pairs: 12, grade: { ...GRADE } }],
  [ITEM_PRATA, { saleOrderId: SALE_ORDER, referenceId: REF_G01, pairs: 12, grade: { ...GRADE } }],
]);

/** Shape real devolvido por `calculate_consumption_report_batch` (PV-00224). */
const rawPreview = (overrides: {
  item?: string;
  ordinal: number;
  color?: string;
  colorId?: string;
  finishedAvailableM?: number;
  resolved?: Record<string, unknown>;
  [key: string]: unknown;
}) => {
  const { item = ITEM_DALIA, ordinal, color = 'DÁLIA', colorId = 'color-dalia',
    finishedAvailableM = 0, resolved = {}, ...rest } = overrides;
  const gross = (12 * CM_PER_PAIR[ordinal - 1]) / 100;
  return parseCanonicalStrapDemandPreview({
    scope_key: item,
    scope_type: 'sale_order_item',
    sale_order_id: SALE_ORDER,
    sale_order_item_id: item,
    line_ordinal: ordinal,
    technical_strap_line_id: LINE_IDS[ordinal - 1],
    strap_variant_id: `variant-chata-8-${colorId}`,
    source_mode: 'internal',
    gross_required_m: gross,
    recipe_id: 'recipe-chata-8-soft',
    base_product_id: 'napa-soft',
    finished_product_id: `finished-chata-8-${colorId}`,
    blocking_reasons: [],
    resolved: {
      color_id: colorId,
      measure_name: '8 mm',
      strap_color_name: color,
      strap_product_name: `TIRA CHATA 8 mm · NAPA SOFT · ${color}`,
      base_group_name: 'NAPA SOFT',
      base_product_name: 'NAPA SOFT',
      confirmed_yield_m_per_m: 70,
      base_required_m: gross / 70,
      cut_band_width_mm: 18,
      usable_base_width_mm_snapshot: 1370,
      theoretical_yield_m_per_m: 76,
      catalog: { color_id: colorId, finished_available_m: finishedAvailableM },
      ...resolved,
    },
    ...rest,
  });
};

const pv00224Dalia = () => [1, 2, 3, 4].map((ordinal) => rawPreview({ ordinal }));

const ctx = { allProducts: [], productGroups: [] } as unknown as Parameters<typeof replaceWithCanonicalStrapRows>[1];
const opts = { scopeByKey, lineSpecs, allocateFinishedStock: true };

const strapRows = (rows: unknown[]) =>
  (rows as CanonicalStrapConsumptionRow[]).filter((row) => row.componentType === 'Tiras');

describe('R-Consumo · PV-00224 (DÁLIA, 12 pares, 4 linhas Fazer, rendimento 70)', () => {
  it('cada linha de tira aparece com metros de TIRA, pares e napa = a fazer ÷ rendimento', () => {
    const rows = strapRows(replaceWithCanonicalStrapRows([], ctx, pv00224Dalia(), opts));
    expect(rows).toHaveLength(4);
    const byLine = (id: string) => rows.find((row) => row.technicalStrapLineIds.includes(id))!;

    const expectedMeters = [6, 6, 6.24, 5.04];
    const expectedNapa = [0.0857, 0.0857, 0.0891, 0.072];
    LINE_IDS.forEach((id, index) => {
      const row = byLine(id);
      expect(row.totalQuantity).toBeCloseTo(expectedMeters[index], 6);
      expect(row.productUnit).toBe('m');
      expect(row.color).toBe('DÁLIA');
      expect(row.materialName).toBe(`Prestador · ${LABELS[index]}`);
      expect(row.strap.origin).toBe('fazer');
      expect(row.strap.pairs).toBe(12);
      expect(row.strap.toMakeM).toBeCloseTo(expectedMeters[index], 6);
      expect(row.strap.napaM).toBeCloseTo(expectedNapa[index], 4);
      expect(row.artisanal?.baseQty).toBeCloseTo(expectedMeters[index] / 70, 9);
      expect(row.artisanal?.pending).toBeFalsy();
    });
  });

  it('metros por numeração = pares × cm/par ÷ 100 e fecham com o motor', () => {
    const rows = strapRows(replaceWithCanonicalStrapRows([], ctx, pv00224Dalia(), opts));
    const tira1 = rows.find((row) => row.technicalStrapLineIds.includes(LINE_IDS[0]))!;
    expect(tira1.strap.pairsBySize).toEqual(GRADE);
    expect(tira1.strap.metersBySize).toEqual({
      34: 0.5, 35: 0.5, 36: 1, 37: 1.5, 38: 1, 39: 1, 40: 0.5,
    });
    expect(strapSizeMetersText(tira1)).toBe(
      '34: 0,50 m · 35: 0,50 m · 36: 1,00 m · 37: 1,50 m · 38: 1,00 m · 39: 1,00 m · 40: 0,50 m',
    );
    const traseira42 = rows.find((row) => row.technicalStrapLineIds.includes(LINE_IDS[3]))!;
    expect(traseira42.strap.metersBySize?.['37']).toBeCloseTo(1.26, 9);
  });

  it('não inventa metros por numeração quando a ficha não fecha com o motor', () => {
    const wrongSpec = new Map(lineSpecs);
    wrongSpec.set(LINE_IDS[0], { label: 'TIRA 1', consumptionPerSize: flatPerSize(30), consumption: 30 });
    const rows = strapRows(replaceWithCanonicalStrapRows([], ctx, [rawPreview({ ordinal: 1 })], {
      ...opts, lineSpecs: wrongSpec,
    }));
    expect(rows[0].totalQuantity).toBeCloseTo(6, 6);
    expect(rows[0].strap.metersBySize).toBeNull();
    expect(rows[0].strap.pairsBySize).toEqual(GRADE);
  });

  it('grade por ficha × fichas inteiras vira pares do item; fração não inventa grade', () => {
    expect(strapSizeBreakdown(12, { saleOrderId: null, referenceId: null, pairs: 24,
      grade: { 34: 6, 35: 6 } }, { label: null, consumptionPerSize: {}, consumption: 50 }))
      .toEqual({ pairs: 24, pairsBySize: { 34: 12, 35: 12 }, metersBySize: { 34: 6, 35: 6 } });
    expect(strapSizeBreakdown(5, { saleOrderId: null, referenceId: null, pairs: 10,
      grade: { 34: 3, 35: 4 } }, undefined))
      .toEqual({ pairs: 10, pairsBySize: null, metersBySize: null });
  });

  it('tira Fazer convertida NÃO some: segue na lista após anotação e no PDF', async () => {
    const { rows, artisanalStrapRows } = await annotateConsumptionAvailability(
      [], ctx, pv00224Dalia(), opts,
    );
    expect(strapRows(rows)).toHaveLength(4);
    expect(artisanalStrapRows).toHaveLength(1);
    const html = buildMaterialConsumptionReportHtml({
      rows, artisanalStrapRows, title: 'PV-00224', generatedAt: new Date('2026-10-10T12:00:00Z'),
    });
    expect(html).toContain('TIRA CHATA 8 mm · NAPA SOFT · DÁLIA');
    expect(html).toContain('Prestador · TIRA 1');
    expect(html).toContain('6,24');
    expect(html).toContain('5,04');
    expect(html).toContain('12 pares');
    expect(html).toContain('≈ 0,0857 m NAPA SOFT');
    // §03: napa total = 23,28 ÷ 70 = 0,3326 m
    expect(html).toContain('0,3326 m');
  });

  it('totais nunca somam metro de tira com metro de napa; compra = napa', async () => {
    const { rows } = await annotateConsumptionAvailability([], ctx, pv00224Dalia(), opts);
    const totals = unitTotals(rows);
    expect(totals.get('m')).toBeCloseTo(23.28 / 70, 6);
    expect(totals.has(STRAP_METER_TOTAL_UNIT)).toBe(false);
    const purchase = toPurchaseDecisionRows(rows);
    expect(purchase.filter((row) => row.componentType === 'Tiras')).toHaveLength(0);
    const napa = purchase.find((row) => row.groupName === 'NAPA SOFT')!;
    expect(napa.totalQuantity).toBeCloseTo(23.28 / 70, 9);
    // A linha da tira não vira falta de tira (não se compra tira Fazer).
    expect(rows.filter((row) => row.componentType === 'Tiras').every((row) => rowShortfall(row) === 0))
      .toBe(true);
    expect(subtotalUnitKey(rows[0])).toBe(STRAP_METER_TOTAL_UNIT);
  });
});

describe('D9 · bloqueio consistente em linha, bloco, PDF e compra', () => {
  // Overlay com rendimento antigo + overlay_recipe_missing: a linha convertia
  // (yield > 0) enquanto o bloco mostrava "—" — a compra contava napa negada.
  const blockedWithYield = () => parseCanonicalStrapDemandPreview({
    scope_key: ITEM_DALIA,
    sale_order_id: SALE_ORDER,
    sale_order_item_id: ITEM_DALIA,
    line_ordinal: 5,
    technical_strap_line_id: 'f3dee711-3ba4-46d0-b14b-b3a850376825',
    strap_variant_id: 'variant-overlock-cobre',
    source_mode: 'internal',
    gross_required_m: 6.88,
    recipe_id: null,
    base_product_id: 'glow-cobre',
    finished_product_id: 'finished-overlock-cobre',
    blocking_reasons: [{
      code: 'overlay_recipe_missing',
      field: 'recipe_id',
      message: 'Não há receita aprovada para este tipo×napa; o consumo de base não pode usar o rendimento antigo. Cadastre no Hub de Tiras.',
    }],
    resolved: {
      color_id: 'color-cobre',
      strap_color_name: 'COBRE',
      measure_name: 'Overlock Redonda 6 mm',
      strap_product_name: 'TIRA OVERLOCK 5 mm · GLOW METALIC · COBRE',
      base_group_name: 'GLOW METALIC',
      confirmed_yield_m_per_m: 70,
      base_required_m: null,
    },
  });

  it('linha: metros de tira, napa “—” com o motivo, fora da compra', () => {
    const [row] = strapRows(replaceWithCanonicalStrapRows([], ctx, [blockedWithYield()], opts));
    expect(row.totalQuantity).toBeCloseTo(6.88, 6);
    expect(row.artisanal).toMatchObject({ pending: true, baseQty: 0 });
    expect(row.strap.napaM).toBeNull();
    expect(row.strap.napaBlockedReason).toContain('Não há receita aprovada');
    expect(row.warning).toContain('Não há receita aprovada');
    const napa = strapNapaDisplay(row);
    expect(napa?.kind).toBe('blocked');
    expect(napa?.text).toContain('—');

    expect(toPurchaseDecisionRows([row as ConsumptionRow])).toHaveLength(0);
    expect(unitTotals([row as ConsumptionRow]).size).toBe(0);
    expect(countShort([row as ConsumptionRow])).toBe(0);
    expect(topShortfalls([row as ConsumptionRow])).toEqual([]);
    expect(buildBuyList([row as ConsumptionRow]).families).toEqual([]);
  });

  it('bloco: mesma decisão (napa 0, “cadastro incompleto” + motivo)', () => {
    const [cut] = canonicalStrapCutRows([blockedWithYield()]);
    expect(cut.metros_necessarios).toBeCloseTo(6.88, 6);
    expect(cut.canonical).toMatchObject({ baseRequiredM: 0, napaBlocked: true });
    const sector = aggregateStrapNapaSector([cut]);
    expect(sector.types[0]).toMatchObject({ blocked: true, napaM: 0 });
    expect(sector.types[0].blockedReason).toContain('Não há receita aprovada');
    expect(sector.totalNapaM).toBe(0);
  });

  it('PDF: napa “—”, motivo e nada de napa no total', () => {
    const rows = strapRows(replaceWithCanonicalStrapRows([], ctx, [blockedWithYield()], opts)) as ConsumptionRow[];
    const html = buildMaterialConsumptionReportHtml({
      rows,
      artisanalStrapRows: canonicalStrapCutRows([blockedWithYield()]),
      title: 'PV-00224',
      generatedAt: new Date('2026-10-10T12:00:00Z'),
    });
    expect(html).toContain('TIRA OVERLOCK 5 mm · GLOW METALIC · COBRE');
    expect(html).toContain('6,88');
    expect(html).toContain('napa GLOW METALIC: —');
    expect(html).toContain('cadastro incompleto');
    expect(html).toContain('Não há receita aprovada');
  });

  it('bloqueado sem rendimento (shape real: base null, yield ausente) também é D9', () => {
    const preview = blockedWithYield();
    const noYield = { ...preview, confirmedYieldMPerM: null };
    expect(strapNapaBlockReason(noYield)).toContain('Não há receita aprovada');
    const [row] = strapRows(replaceWithCanonicalStrapRows([], ctx, [noYield], opts));
    expect(row.artisanal?.pending).toBe(true);
  });

  it('linha bloqueada não contamina a napa das convertíveis do mesmo tipo × cor', () => {
    const ok = rawPreview({ ordinal: 1 });
    const blocked = { ...rawPreview({ ordinal: 2 }), recipeId: null,
      blockingReasons: ['Receita ausente'], blockingCodes: ['overlay_recipe_missing'] };
    const sector = aggregateStrapNapaSector(canonicalStrapCutRows([ok, blocked]));
    const okType = sector.types.find((type) => !type.blocked)!;
    const blockedType = sector.types.find((type) => type.blocked)!;
    expect(okType.napaM).toBeCloseTo(6 / 70, 9);
    expect(blockedType.napaM).toBe(0);
    expect(sector.totalNapaM).toBeCloseTo(6 / 70, 9);
  });
});

describe('Comprar (buy_ready) e estoque de tira pronta (D15)', () => {
  const strass = (finishedAvailableM = 0) => parseCanonicalStrapDemandPreview({
    scope_key: ITEM_DALIA,
    sale_order_id: SALE_ORDER,
    sale_order_item_id: ITEM_DALIA,
    line_ordinal: 3,
    technical_strap_line_id: '79f835a2-fd44-483e-99cc-7d92c0c0f8b3',
    strap_variant_id: 'variant-strass-rosado',
    source_mode: 'buy_ready',
    gross_required_m: 6.96,
    recipe_id: null,
    base_product_id: null,
    finished_product_id: 'finished-strass-rosado',
    blocking_reasons: [],
    resolved: {
      color_id: 'color-rosado',
      strap_color_name: 'ROSADO COM FUNDO ROSADO',
      strap_product_name: 'Tira Strass 6mm Rosado com fundo rosado',
      base_group_name: 'TIRA STRASS 6MM',
      base_required_m: 0,
      catalog: { finished_available_m: finishedAvailableM },
    },
  });

  it('Comprar não tem napa; total vai em “m de tira”; falta = só o que o estoque não cobre', () => {
    const [row] = strapRows(replaceWithCanonicalStrapRows([], ctx, [strass(2)], opts));
    expect(row.materialName).toBe('Comprar pronto');
    expect(row.artisanal).toBeUndefined();
    expect(row.strap).toMatchObject({ origin: 'comprar', napaM: null, fromStockM: 2 });
    expect(row.strap.toMakeM).toBeCloseTo(4.96, 9);
    expect(row.available).toBe(2);
    expect(strapNapaDisplay(row)).toBeNull();
    expect(strapStockSplitText(row)).toBe('2,00 m do estoque · 4,96 m a comprar');
    expect(rowShortfall(row as ConsumptionRow)).toBeCloseTo(4.96, 9);
    expect(canonicalStrapCutRows([strass(2)])).toHaveLength(0);

    const totals = unitTotals([row as ConsumptionRow]);
    expect(totals.get(STRAP_METER_TOTAL_UNIT)).toBeCloseTo(6.96, 9);
    expect(totals.has('m')).toBe(false);
  });

  it('Fazer consome a tira pronta primeiro e só a falta vira napa (linha e bloco)', () => {
    // SKU pronto DÁLIA com 4 m: TIRA 1 (6 m) usa os 4, TIRA 2 (6 m) não acha saldo.
    const previews = [
      rawPreview({ ordinal: 1, finishedAvailableM: 4 }),
      rawPreview({ ordinal: 2, finishedAvailableM: 4 }),
    ];
    const rows = strapRows(replaceWithCanonicalStrapRows([], ctx, previews, opts));
    const tira1 = rows.find((row) => row.technicalStrapLineIds.includes(LINE_IDS[0]))!;
    const tira2 = rows.find((row) => row.technicalStrapLineIds.includes(LINE_IDS[1]))!;
    expect(tira1.strap).toMatchObject({ fromStockM: 4 });
    expect(tira1.strap.toMakeM).toBeCloseTo(2, 9);
    expect(tira1.strap.napaM).toBeCloseTo(2 / 70, 9);
    expect(strapStockSplitText(tira1)).toBe('4,00 m do estoque · 2,00 m pelo prestador');
    expect(tira2.strap.fromStockM).toBe(0);
    expect(tira2.strap.napaM).toBeCloseTo(6 / 70, 9);

    const [cut] = canonicalStrapCutRows(previews, { allocateFinishedStock: true });
    expect(cut.metros_necessarios).toBeCloseTo(8, 9);
    expect(cut.canonical?.baseRequiredM).toBeCloseTo(8 / 70, 9);
    expect(cut.canonical?.fromStockM).toBe(4);
  });
});

describe('agrupamento por cor e identidade de PV/modelo', () => {
  it('duas cores da mesma referência/linha nunca se fundem (linha e bloco)', () => {
    const dalia = rawPreview({ ordinal: 1 });
    const prata = rawPreview({ ordinal: 1, item: ITEM_PRATA, color: 'PRATA', colorId: 'color-prata',
      strap_variant_id: 'variant-chata-8-shared', finished_product_id: 'finished-shared' });
    const daliaSharedVariant = { ...dalia, strapVariantId: 'variant-chata-8-shared', finishedProductId: 'finished-shared' };
    const rows = strapRows(replaceWithCanonicalStrapRows([], ctx, [daliaSharedVariant, prata], opts));
    expect(rows.map((row) => row.color).sort()).toEqual(['DÁLIA', 'PRATA']);
    expect(rows.every((row) => Math.abs(row.totalQuantity - 6) < 1e-9)).toBe(true);
    const cuts = canonicalStrapCutRows([daliaSharedVariant, prata]);
    expect(cuts.map((cut) => cut.color).sort()).toEqual(['DÁLIA', 'PRATA']);
  });

  it('mesma linha e cor em dois itens soma metros e pares', () => {
    const a = rawPreview({ ordinal: 1 });
    const b = rawPreview({ ordinal: 1, item: ITEM_PRATA });
    const rows = strapRows(replaceWithCanonicalStrapRows([], ctx, [a, b], opts));
    expect(rows).toHaveLength(1);
    expect(rows[0].totalQuantity).toBeCloseTo(12, 9);
    expect(rows[0].strap.pairs).toBe(24);
    expect(rows[0].strap.metersBySize?.['37']).toBeCloseTo(3, 9);
    expect(rows[0].artisanal?.baseQty).toBeCloseTo(12 / 70, 9);
  });

  it('modo “Por PV e modelo”: tira carrega PV e referência (não cai em SEM REF)', () => {
    const rows = strapRows(replaceWithCanonicalStrapRows([], ctx, pv00224Dalia(), {
      ...opts,
      partition: 'order_reference',
      orderNumberBySaleOrderId: new Map([[SALE_ORDER, 'PV-00224']]),
      referenceLabelById: new Map([[REF_G01, { code: 'G01', name: 'G01' }]]),
    })) as ConsumptionRow[];
    expect(rows.every((row) => row.saleOrderId === SALE_ORDER && row.referenceId === REF_G01)).toBe(true);
    const partitions = buildOrderReferencePartitions(rows);
    expect(partitions).toHaveLength(1);
    expect(partitions[0].orderNumber).toBe('PV-00224');
    expect(partitions[0].models.map((model) => model.referenceLabel)).toEqual(['G01']);
    expect(partitions[0].models[0].rows).toHaveLength(4);
  });
});

describe('alinhamento de unidade não toca na napa da tira', () => {
  it('quantidade, estoque e napa ficam em metros; só o preço vira R$/m', () => {
    const [row] = strapRows(replaceWithCanonicalStrapRows([], ctx, [rawPreview({ ordinal: 1 })], opts));
    const priced = { ...row, available: 3, unitPrice: 0.05 } as ConsumptionRow;
    const [aligned] = alignConsumptionRowsToDisplayUnit([priced], [{
      id: row.productIds![0],
      unit: 'cm',
      product_groups: { consumption_unit: 'm' },
    }]);
    expect(aligned.totalQuantity).toBeCloseTo(6, 9);
    expect(aligned.productUnit).toBe('m');
    expect(aligned.available).toBe(3);
    expect(aligned.artisanal?.baseQty).toBeCloseTo(6 / 70, 9);
    expect(aligned.unitPrice).toBeCloseTo(5, 9);

    // SKU em metros (caso real): nada muda, nem converte duas vezes.
    const [same] = alignConsumptionRowsToDisplayUnit([priced], [{
      id: row.productIds![0], unit: 'm', product_groups: { consumption_unit: 'm' },
    }]);
    expect(same).toBe(priced);
  });
});

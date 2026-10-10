/**
 * Pipeline completo do Consumo de Materiais para tiras (R-Consumo), com o
 * supabase mockado: relatório canônico (shape do PV-00224) →
 * `materializeCanonicalConsumptionReport` → linhas de tira com pares, metros
 * por numeração (cm/par da ficha), PV/modelo e bloco “Napa para tiras”.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tables: Record<string, unknown[]> = {};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        in: () => Promise.resolve({ data: tables[table] || [], error: null }),
      }),
    }),
    rpc: vi.fn(),
  },
}));

import {
  buildStrapScopeInfo,
  materializeCanonicalConsumptionReport,
  parseStrapLineSpecs,
  type CanonicalConsumptionReport,
} from '../canonicalConsumptionReport';
import { buildOrderReferencePartitions } from '../consumptionPartitions';
import { aggregateStrapNapaSector } from '../strapRollCut';

const SALE_ORDER = '8b84c32d-81a5-4aa6-b7ba-a43cec23af1f';
const ITEM = '1328e6aa-3c0e-46aa-9dca-f32553a1c27d';
const REF = '88e1ef41-e422-4d47-bf6e-26a62f3749d0';
const NAPA = 'c94ec81b-c33a-4fe5-8d88-1310faa776ea';
const FINISHED = '3c32df34-82dc-41e9-8cf5-f541e52176fa';
const GRADE = { 34: 1, 35: 1, 36: 2, 37: 3, 38: 2, 39: 2, 40: 1 };
const LINES = [
  { id: '0ac6b8ab-9feb-4261-9d7d-a22fe3e7c05a', label: 'TIRA 1', cm: 50 },
  { id: '62299082-d444-4923-ae09-1664f2babda7', label: 'TIRA 2', cm: 50 },
  { id: 'c83e5873-9245-4125-9747-18d8da657569', label: 'TRASEIRA', cm: 52 },
  { id: '5a01b2d8-dc26-457f-80e0-a5fa172ebb14', label: 'TRASEIRA', cm: 42 },
];
const perSize = (cm: number) => Object.fromEntries(Object.keys(GRADE).map((size) => [size, cm]));

const report = (): CanonicalConsumptionReport => ({
  version: 1,
  engine: 'calculate_order_consumption_by_grade',
  lines: [{
    line_kind: 'material',
    scope_key: ITEM,
    scope_type: 'sale_order_item',
    sale_order_id: SALE_ORDER,
    sale_order_item_id: ITEM,
    reference_id: REF,
    quantity: 12,
    effective_grade: { ...GRADE },
    component: 'Cabedal',
    product_name: 'NAPA SOFT DÁLIA',
    product_unit: 'm',
    required: 1.2,
    available: 0,
    stock_ok: false,
    debit_mode: 'soft',
    product_id: NAPA,
    product_group_name: 'NAPA SOFT',
    color: 'DÁLIA',
  }] as CanonicalConsumptionReport['lines'],
  strap_previews: LINES.map((line, index) => ({
    scope_key: ITEM,
    scope_type: 'sale_order_item',
    sale_order_id: SALE_ORDER,
    sale_order_item_id: ITEM,
    line_ordinal: index + 1,
    technical_strap_line_id: line.id,
    strap_variant_id: '27994263-ba30-42e1-9172-f49b6d4b5397',
    source_mode: 'internal',
    gross_required_m: (12 * line.cm) / 100,
    recipe_id: '7a7a83f7-7282-4a28-88bc-18727569f57a',
    base_product_id: NAPA,
    finished_product_id: FINISHED,
    blocking_reasons: [],
    resolved: {
      color_id: '2fbc4215-1e68-44e4-a508-604222d3183e',
      measure_name: '8 mm',
      strap_color_name: 'DÁLIA',
      strap_product_name: 'TIRA CHATA 8 mm · NAPA SOFT · DÁLIA',
      base_group_name: 'NAPA SOFT',
      base_product_name: 'NAPA SOFT',
      confirmed_yield_m_per_m: 70,
      base_required_m: (12 * line.cm) / 100 / 70,
      cut_band_width_mm: 18,
      usable_base_width_mm_snapshot: 1370,
      catalog: { finished_available_m: 0, color_id: '2fbc4215-1e68-44e4-a508-604222d3183e' },
    },
  })) as CanonicalConsumptionReport['strap_previews'],
});

beforeEach(() => {
  tables.products = [
    { id: NAPA, name: 'NAPA SOFT DÁLIA', unit: 'm', quantity: 0, reserved_stock: 0, group_id: 'g-soft' },
    { id: FINISHED, name: 'TIRA CHATA 8 mm · NAPA SOFT · DÁLIA', unit: 'm', quantity: 0, reserved_stock: 0 },
  ];
  tables.box_types = [];
  tables.technical_sheets = [{
    id: REF,
    strap_colors: LINES.map((line) => ({
      id: line.id,
      technical_strap_line_id: line.id,
      label: line.label,
      consumption: line.cm,
      consumption_per_size: perSize(line.cm),
    })),
  }];
});

describe('materializeCanonicalConsumptionReport · tiras (PV-00224)', () => {
  it('linhas de tira com metros, pares, numeração e napa; bloco soma a napa', async () => {
    const { rows, artisanalStrapRows } = await materializeCanonicalConsumptionReport(report());
    const straps = rows.filter((row) => row.componentType === 'Tiras');
    expect(straps.map((row) => Number(row.totalQuantity.toFixed(2))).sort()).toEqual([5.04, 6, 6, 6.24]);
    for (const row of straps) {
      expect(row.strap?.pairs).toBe(12);
      expect(row.strap?.metersBySize).not.toBeNull();
      const sum = Object.values(row.strap!.metersBySize!).reduce((total, value) => total + value, 0);
      expect(sum).toBeCloseTo(row.totalQuantity, 9);
      expect(row.artisanal?.baseQty).toBeCloseTo(row.totalQuantity / 70, 9);
    }
    expect(straps.map((row) => row.materialName).sort()).toEqual([
      'Fazer · TIRA 1', 'Fazer · TIRA 2', 'Fazer · TRASEIRA', 'Fazer · TRASEIRA',
    ]);

    const sector = aggregateStrapNapaSector(artisanalStrapRows);
    expect(sector.totalStrapM).toBeCloseTo(23.28, 9);
    expect(sector.totalNapaM).toBeCloseTo(23.28 / 70, 9);
  });

  it('“Por PV e modelo”: tiras ficam sob o PV e o modelo, nunca em SEM REF', async () => {
    const { rows } = await materializeCanonicalConsumptionReport(report(), undefined, {
      partition: 'order_reference',
      orderNumberBySaleOrderId: new Map([[SALE_ORDER, 'PV-00224']]),
      referenceLabelById: new Map([[REF, { code: 'G01', name: 'G01' }]]),
    });
    const partitions = buildOrderReferencePartitions(rows);
    expect(partitions).toHaveLength(1);
    expect(partitions[0].models.map((model) => model.referenceLabel)).toEqual(['G01']);
    expect(partitions[0].models[0].rows.filter((row) => row.componentType === 'Tiras')).toHaveLength(4);
  });

  it('sem ficha carregada, mostra pares/grade mas não inventa metros por numeração', async () => {
    tables.technical_sheets = [];
    const { rows } = await materializeCanonicalConsumptionReport(report());
    const strap = rows.find((row) => row.componentType === 'Tiras')!;
    expect(strap.strap?.pairsBySize).toEqual(GRADE);
    expect(strap.strap?.metersBySize).toBeNull();
  });
});

describe('helpers de escopo e ficha', () => {
  it('buildStrapScopeInfo lê PV, modelo, pares e grade das linhas', () => {
    const scope = buildStrapScopeInfo(report().lines);
    expect(scope.get(ITEM)).toEqual({ saleOrderId: SALE_ORDER, referenceId: REF, pairs: 12, grade: GRADE });
  });

  it('parseStrapLineSpecs usa technical_strap_line_id e ignora cm inválido', () => {
    const specs = parseStrapLineSpecs([{ strap_colors: [
      { technical_strap_line_id: 'l1', label: ' TIRA 1 ', consumption: 50, consumption_per_size: { 34: 50, 35: 'x' } },
      { id: 'l2', consumption: null },
      'lixo',
    ] }]);
    expect(specs.get('l1')).toEqual({ label: 'TIRA 1', consumptionPerSize: { 34: 50 }, consumption: 50 });
    expect(specs.get('l2')).toEqual({ label: null, consumptionPerSize: {}, consumption: null });
  });
});

import { describe, expect, it } from 'vitest';
import {
  CanonicalConsumptionReportError,
  adaptCanonicalConsumptionLines,
  canonicalStrapPreviews,
  validateCanonicalConsumptionReport,
} from '@/lib/canonicalConsumptionReport';

const IDS = {
  scope1: '11111111-1111-4111-8111-111111111111',
  scope2: '22222222-2222-4222-8222-222222222222',
  saleOrder: '33333333-3333-4333-8333-333333333333',
  saleItem: '44444444-4444-4444-8444-444444444444',
  reference: '55555555-5555-4555-8555-555555555555',
  product: '66666666-6666-4666-8666-666666666666',
  group: '77777777-7777-4777-8777-777777777777',
  box: '88888888-8888-4888-8888-888888888888',
  strapLine: '99999999-9999-4999-8999-999999999999',
};

const materialLine = (scopeKey = IDS.scope1, required = 12.5) => ({
  scope_key: scopeKey,
  scope_type: 'production_order',
  sale_order_id: IDS.saleOrder,
  sale_order_item_id: IDS.saleItem,
  reference_id: IDS.reference,
  quantity: 10,
  effective_grade: { '34': 4, '35': 6, _source: 'absolute' },
  line_kind: 'material',
  component: 'Solado',
  product_id: IDS.product,
  product_name: 'SOLADO 204 PRETO',
  product_unit: 'par',
  product_category: 'Solado',
  product_color: 'PRETO',
  product_group_id: IDS.group,
  product_group_name: 'SOLADO 204',
  color: 'PRETO',
  required,
  available: 20,
  stock_ok: true,
  debit_mode: 'hard',
});

const response = (lines: unknown[], strapPreviews: unknown[] = []) => ({
  version: 1,
  engine: 'calculate_order_consumption_by_grade',
  lines,
  strap_previews: strapPreviews,
});

describe('canonicalConsumptionReport', () => {
  it('preserva a quantidade SQL e agrega somente a apresentação/grade', () => {
    const parsed = validateCanonicalConsumptionReport(response([
      materialLine(IDS.scope1, 12.5),
      materialLine(IDS.scope2, 7.5),
    ]));

    const rows = adaptCanonicalConsumptionLines(parsed.lines);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      componentType: 'Solado',
      groupName: 'SOLADO 204',
      totalQuantity: 20,
      productIds: [IDS.product],
      soleProductId: IDS.product,
      sizeBreakdown: { '34': 8, '35': 12 },
    });
  });

  it('mantém identidade de box_types separada de products', () => {
    const packaging = {
      ...materialLine(),
      line_kind: 'packaging',
      component: 'Embalagem',
      product_name: 'CAIXA INDIVIDUAL 11',
      product_unit: 'un',
      required: 10,
      box_type_id: IDS.box,
      packaging_type: 'individual',
      unit_price: 1.2,
      supplier_id: null,
    };
    delete (packaging as Record<string, unknown>).product_id;

    const parsed = validateCanonicalConsumptionReport(response([packaging]));
    const [row] = adaptCanonicalConsumptionLines(parsed.lines);

    expect(row.componentType).toBe('Embalagem');
    expect(row.productIds).toEqual([]);
    expect(row.boxTypeIds).toEqual([IDS.box]);
    expect(row.totalQuantity).toBe(10);
  });

  it('preserva BOM e Componente Direto da RPC — fivela não vira Outros', () => {
    const bom = {
      ...materialLine(),
      component: 'BOM',
      product_name: 'FIVELA 20MM',
      product_category: 'BOM',
      product_group_name: 'FIVELA 20MM',
      product_unit: 'un',
      required: 8,
    };
    const direto = {
      ...materialLine(IDS.scope2, 4),
      component: 'Componente Direto',
      product_name: 'ILHOS 8MM',
      product_category: 'Componente Direto',
      product_group_name: 'ILHOS 8MM',
      product_unit: 'un',
    };

    const parsed = validateCanonicalConsumptionReport(response([bom, direto]));
    const rows = adaptCanonicalConsumptionLines(parsed.lines);

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ componentType: 'BOM', groupName: 'FIVELA 20MM', totalQuantity: 8 }),
      expect.objectContaining({ componentType: 'Componente Direto', groupName: 'ILHOS 8MM', totalQuantity: 4 }),
    ]));
  });

  it('mantém cor sem SKU como pendência sem atribuir o produto fallback', () => {
    const blocked = {
      ...materialLine(),
      component: 'Cabedal',
      product_id: null,
      product_name: 'Cabedal sem SKU para LIMONCELLO',
      product_unit: 'm',
      color: 'LIMONCELLO',
      required: 0,
      available: 0,
      stock_ok: false,
      matched_by: 'color_mismatch',
      conversion_warning: 'material_color_not_registered:Cabedal:LIMONCELLO',
    };

    const parsed = validateCanonicalConsumptionReport(response([blocked]));
    const [row] = adaptCanonicalConsumptionLines(parsed.lines);

    expect(row).toMatchObject({
      componentType: 'Cabedal',
      materialName: 'Cabedal sem SKU para LIMONCELLO',
      color: 'LIMONCELLO',
      totalQuantity: 0,
      productIds: [],
      warning: 'Cabedal · LIMONCELLO: não existe SKU dessa cor no grupo físico.',
    });
  });

  it.each([
    ['quantidade negativa', { ...materialLine(), required: -1 }],
    ['material positivo sem UUID', { ...materialLine(), product_id: null }],
  ])('falha fechado em %s', (_label, line) => {
    expect(() => validateCanonicalConsumptionReport(response([line])))
      .toThrow(CanonicalConsumptionReportError);
  });

  it('aceita tira sem UUID técnico somente quando a pendência vem explícita', () => {
    const blocked = {
      scope_key: IDS.scope1,
      scope_type: 'production_order',
      sale_order_id: IDS.saleOrder,
      sale_order_item_id: IDS.saleItem,
      line_ordinal: 1,
      technical_strap_line_id: null,
      strap_variant_id: null,
      source_mode: null,
      gross_required_m: 4,
      recipe_id: null,
      base_product_id: null,
      finished_product_id: null,
      blocking_reasons: [{ code: 'technical_line_missing', message: 'Linha pendente.' }],
      resolved: {},
    };
    const parsed = validateCanonicalConsumptionReport(response([], [blocked]));
    const [preview] = canonicalStrapPreviews(parsed);

    expect(preview.preview.technicalStrapLineId).toBe('');
    expect(preview.preview.blockingReasons).toEqual(['Linha pendente.']);

    expect(() => validateCanonicalConsumptionReport(response([], [{
      ...blocked,
      blocking_reasons: [],
    }] as unknown[]))).toThrow(CanonicalConsumptionReportError);
  });

  it('preserva preview resolvida por UUID sem inferir identidade por texto', () => {
    const parsed = validateCanonicalConsumptionReport(response([], [{
      scope_key: IDS.scope1,
      scope_type: 'production_order',
      sale_order_id: IDS.saleOrder,
      sale_order_item_id: IDS.saleItem,
      line_ordinal: 1,
      technical_strap_line_id: IDS.strapLine,
      strap_variant_id: null,
      source_mode: 'buy_ready',
      gross_required_m: 9.75,
      recipe_id: null,
      base_product_id: null,
      finished_product_id: IDS.product,
      blocking_reasons: [],
      resolved: {
        strap_product_name: 'TIRA PRONTA 8MM',
        strap_color_name: 'PRETO',
      },
    }]));
    const [preview] = canonicalStrapPreviews(parsed);

    expect(preview.preview).toMatchObject({
      technicalStrapLineId: IDS.strapLine,
      sourceMode: 'buy_ready',
      grossRequiredM: 9.75,
      finishedProductId: IDS.product,
    });
  });
});

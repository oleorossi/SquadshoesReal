import { describe, expect, it } from 'vitest';
import { validateCanonicalConsumptionReport } from '@/lib/canonicalConsumptionReport';
import { scopedCanonicalRows } from '@/lib/canonicalConsumptionByScope';

const IDS = {
  scope1: '11111111-1111-4111-8111-111111111111',
  scope2: '22222222-2222-4222-8222-222222222222',
  saleOrder: '33333333-3333-4333-8333-333333333333',
  saleItem: '44444444-4444-4444-8444-444444444444',
  reference: '55555555-5555-4555-8555-555555555555',
  product: '66666666-6666-4666-8666-666666666666',
  group: '77777777-7777-4777-8777-777777777777',
};

const materialLine = (scopeKey: string, required: number, component = 'BOM', name = 'FIVELA 20MM') => ({
  scope_key: scopeKey,
  scope_type: 'production_order' as const,
  sale_order_id: IDS.saleOrder,
  sale_order_item_id: IDS.saleItem,
  reference_id: IDS.reference,
  quantity: 10,
  effective_grade: { '34': 4, '35': 6 },
  line_kind: 'material' as const,
  component,
  product_id: IDS.product,
  product_name: name,
  product_unit: 'un',
  product_category: component,
  product_color: 'PRETO',
  product_group_id: IDS.group,
  product_group_name: name,
  color: 'PRETO',
  required,
  available: 20,
  stock_ok: true,
  debit_mode: 'soft' as const,
});

describe('canonicalConsumptionByScope', () => {
  it('parte o consumo por scope_key sem misturar OPs do mesmo PV', () => {
    const report = validateCanonicalConsumptionReport({
      version: 1,
      engine: 'calculate_order_consumption_by_grade',
      lines: [
        materialLine(IDS.scope1, 8, 'BOM', 'FIVELA 20MM'),
        materialLine(IDS.scope2, 3, 'Cabedal', 'NAPA PRETA'),
      ],
      strap_previews: [],
    });

    const op1 = scopedCanonicalRows(report, IDS.scope1);
    const op2 = scopedCanonicalRows(report, IDS.scope2);

    expect(op1).toHaveLength(1);
    expect(op1[0]).toMatchObject({ componentType: 'BOM', totalQuantity: 8 });
    expect(op2).toHaveLength(1);
    expect(op2[0]).toMatchObject({ componentType: 'Cabedal', totalQuantity: 3 });
  });
});

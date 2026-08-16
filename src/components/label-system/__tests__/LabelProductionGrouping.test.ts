import { describe, expect, it } from 'vitest';
import { groupOrdersByReference } from '../LabelProductionTab';

const saleOrders = new Map([['pv-1', { order_number: 'PV-1', packaging_mode: 'colmeia' }]]);
const base = {
  sale_order_id: 'pv-1',
  reference_id: 'ref-1',
  color: 'PRETO',
  quantity: 12,
  grade: { '35': 12 },
  technical_sheets: { name: 'I100', code: 'I100' },
};

describe('groupOrdersByReference — identidade física da etiqueta', () => {
  it('não mistura variantes de material da mesma referência/cor', () => {
    const groups = groupOrdersByReference([
      { ...base, id: 'op-1', material_variant_id: 'var-a' },
      { ...base, id: 'op-2', material_variant_id: 'var-b' },
    ], saleOrders);
    expect(groups).toHaveLength(2);
  });

  it('modo por OP separa ordens que o lote pode consolidar', () => {
    const orders = [
      { ...base, id: 'op-1', material_variant_id: 'var-a' },
      { ...base, id: 'op-2', material_variant_id: 'var-a' },
    ];
    expect(groupOrdersByReference(orders, saleOrders)).toHaveLength(1);
    expect(groupOrdersByReference(orders, saleOrders, undefined, true)).toHaveLength(2);
  });

  it('não mistura nomes históricos diferentes da mesma variante viva', () => {
    const groups = groupOrdersByReference([
      {
        ...base,
        id: 'op-1',
        material_variant_id: 'var-a',
        material_variant_commercial_snapshot: { material_name: 'NAPA SOFT' },
      },
      {
        ...base,
        id: 'op-2',
        material_variant_id: 'var-a',
        material_variant_commercial_snapshot: { material_name: 'NAPA MADRI' },
      },
    ], saleOrders);
    expect(groups).toHaveLength(2);
  });
});

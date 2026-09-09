import { describe, expect, it } from 'vitest';
import {
  attributeServiceOrderToPv,
  dedupeAndSortPvServiceOrders,
} from './pvServiceOrderAttribution';

describe('dedupeAndSortPvServiceOrders', () => {
  it('deduplica caminhos de vínculo e ordena pela criação mais recente', () => {
    const rows = dedupeAndSortPvServiceOrders([
      { id: 'a', order_number: 'OS-9', created_at: '2026-08-20T10:00:00Z' },
      { id: 'b', order_number: 'OS-10', created_at: '2026-08-21T10:00:00Z' },
      { id: 'a', order_number: 'OS-9', created_at: '2026-08-20T10:00:00Z' },
    ]);

    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
  });
});

describe('attributeServiceOrderToPv', () => {
  it('soma só as linhas ativas do PV num contêiner compartilhado', () => {
    const result = attributeServiceOrderToPv(
      { id: 'os', linked_sale_order_ids: ['pv-a', 'pv-b'], quantity: 999, total_value: 9999 },
      'pv-a',
      [
        { service_order_id: 'os', sale_order_id: 'pv-a', order_id: 'op-a', quantity: 40, total_value: 120, line_status: 'Pendente' },
        { service_order_id: 'os', sale_order_id: 'pv-a', order_id: 'op-a2', quantity: 10, total_value: 30, line_status: 'Cancelado' },
        { service_order_id: 'os', sale_order_id: 'pv-b', order_id: 'op-b', quantity: 70, total_value: 210, line_status: 'Pendente' },
      ],
      [],
      [
        { id: 'op-a', sale_order_id: 'pv-a', order_number: 'OP-10' },
        { id: 'op-a2', sale_order_id: 'pv-a', order_number: 'OP-11' },
        { id: 'op-b', sale_order_id: 'pv-b', order_number: 'OP-20' },
      ],
    );

    expect(result).toEqual({
      quantity: 40,
      totalValue: 120,
      opNumbers: ['OP-10', 'OP-11'],
      sharedAcrossPvs: true,
      source: 'lines',
    });
  });

  it('não inventa rateio para cabeçalho multi-PV sem linhas', () => {
    const result = attributeServiceOrderToPv(
      { id: 'os', linked_sale_order_ids: ['pv-a', 'pv-b'], quantity: 100, total_value: 500 },
      'pv-a',
      [],
      [],
      [],
    );

    expect(result.quantity).toBeNull();
    expect(result.totalValue).toBeNull();
    expect(result.source).toBe('shared-unallocated');
  });

  it('resolve vínculo e OP por selected_sale_order_item_ids sem diluir o cabeçalho exclusivo', () => {
    const result = attributeServiceOrderToPv(
      { id: 'os', selected_sale_order_item_ids: ['item-a'], quantity: 25, total_value: 75 },
      'pv-a',
      [],
      [{ id: 'item-a', sale_order_id: 'pv-a', quantity: 25 }],
      [{ id: 'op-a', sale_order_id: 'pv-a', sale_order_item_id: 'item-a', order_number: 'OP-7' }],
    );

    expect(result).toMatchObject({
      quantity: 25,
      totalValue: 75,
      opNumbers: ['OP-7'],
      sharedAcrossPvs: false,
      source: 'header',
    });
  });

  it('resolve linha que chega ao PV somente por order_id', () => {
    const result = attributeServiceOrderToPv(
      { id: 'os' },
      'pv-a',
      [{ service_order_id: 'os', order_id: 'op-a', quantity: 12, total_value: 36 }],
      [],
      [{ id: 'op-a', sale_order_id: 'pv-a', order_number: 'OP-3' }],
    );

    expect(result).toMatchObject({ quantity: 12, totalValue: 36, opNumbers: ['OP-3'], source: 'lines' });
  });
});

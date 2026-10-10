import { describe, expect, it } from 'vitest';
import { groupCommitmentsByPv, sumOpenQty, type CommitmentRow } from '@/lib/productReservationGroups';

function row(partial: Partial<CommitmentRow> & Pick<CommitmentRow, 'reservation_id' | 'open_qty'>): CommitmentRow {
  return {
    sale_order_id: null,
    sale_order_number: null,
    client_name: null,
    quantity_reserved: partial.open_qty,
    quantity_consumed: 0,
    status: 'reserved',
    kind: 'component',
    order_id: null,
    order_number: null,
    priority_score: null,
    billing_week: null,
    ...partial,
  };
}

describe('groupCommitmentsByPv', () => {
  it('agrupa por PV e soma open_qty no pai', () => {
    const groups = groupCommitmentsByPv([
      row({
        reservation_id: 'r1',
        sale_order_id: 'pv1',
        sale_order_number: 'PV-001',
        client_name: 'ACME',
        order_id: 'op1',
        order_number: 'OP-1',
        open_qty: 10,
        billing_week: 'W10',
      }),
      row({
        reservation_id: 'r2',
        sale_order_id: 'pv1',
        sale_order_number: 'PV-001',
        client_name: 'ACME',
        order_id: 'op2',
        order_number: 'OP-2',
        open_qty: 5,
        billing_week: 'W10',
      }),
      row({
        reservation_id: 'r3',
        sale_order_id: 'pv2',
        sale_order_number: 'PV-002',
        client_name: 'BETA',
        order_id: 'op3',
        order_number: 'OP-3',
        open_qty: 3,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].saleOrderNumber).toBe('PV-001');
    expect(groups[0].openQty).toBe(15);
    expect(groups[0].ops).toHaveLength(2);
    expect(groups[1].openQty).toBe(3);
    expect(sumOpenQty(groups)).toBe(18);
  });

  it('órfãs sem sale_order_id vão para Sem PV', () => {
    const groups = groupCommitmentsByPv([
      row({
        reservation_id: 'r1',
        order_id: 'op1',
        order_number: 'OP-9',
        open_qty: 7,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].saleOrderId).toBeNull();
    expect(groups[0].key).toBe('__sem_pv__');
    expect(groups[0].openQty).toBe(7);
    expect(groups[0].ops[0].orderNumber).toBe('OP-9');
  });
});

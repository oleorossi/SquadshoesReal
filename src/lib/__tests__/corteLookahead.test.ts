import { describe, expect, it } from 'vitest';
import {
  corteLookaheadScore,
  freeQtyExcludingOtherOrders,
  rankCorteLookaheadRows,
  remainingBillableValue,
  sheetHasCorteSector,
} from '@/lib/corteLookahead';

describe('corteLookahead', () => {
  it('sheetHasCorteSector aceita alias Palmilha · Fibra', () => {
    expect(sheetHasCorteSector(['Palmilha · Fibra', 'Expedição'], 'Corte Fibra')).toBe(true);
    expect(sheetHasCorteSector(['Costura Cabedal'], 'Corte Cabedal')).toBe(false);
  });

  it('score favorece PV caro com prazo perto', () => {
    const today = new Date('2026-09-29T12:00:00');
    const urgent = corteLookaheadScore({
      remainingBillableValue: 1000,
      deliveryDeadline: '2026-09-30',
      today,
    });
    const later = corteLookaheadScore({
      remainingBillableValue: 1000,
      deliveryDeadline: '2026-10-20',
      today,
    });
    expect(urgent).toBeGreaterThan(later);
    expect(corteLookaheadScore({ remainingBillableValue: 1000, deliveryDeadline: null, today })).toBe(0);
  });

  it('remainingBillableValue proporcional aos pares sem OP', () => {
    expect(remainingBillableValue({
      saleOrderTotal: 1000,
      pairsWithoutOp: 40,
      pairsTotalOnPv: 100,
    })).toBe(400);
  });

  it('freeQty ignora reserva do próprio PV e desconta outros', () => {
    const free = freeQtyExcludingOtherOrders({
      quantity: 100,
      productId: 'p1',
      ownSaleOrderId: 'so1',
      reservations: [
        { productId: 'p1', saleOrderId: 'so1', quantityReserved: 30, quantityConsumed: 0, status: 'reserved' },
        { productId: 'p1', saleOrderId: 'so2', quantityReserved: 20, quantityConsumed: 5, status: 'reserved' },
      ],
    });
    expect(free).toBe(85);
  });

  it('rank aplica alocação simulada e chips', () => {
    const ranked = rankCorteLookaheadRows([
      {
        itemId: 'a',
        createdAt: '2026-01-02',
        liberableBase: true,
        stock: { productId: 'napa', productName: 'NAPA PRETO', freeQty: 10, requiredQty: 8 },
        score: 50,
        completionPct: 10,
      },
      {
        itemId: 'b',
        createdAt: '2026-01-01',
        liberableBase: true,
        stock: { productId: 'napa', productName: 'NAPA PRETO', freeQty: 10, requiredQty: 8 },
        score: 80,
        completionPct: 50,
      },
    ], { deadlineByItemId: { a: '2026-10-01', b: '2026-09-30' }, today: new Date('2026-09-29T12:00:00') });

    expect(ranked[0].itemId).toBe('b');
    expect(ranked[0].liberable).toBe(true);
    expect(ranked[1].itemId).toBe('a');
    expect(ranked[1].liberable).toBe(false);
    expect(ranked[0].chips.some((c) => c.key === 'estoque' && c.tone === 'ok')).toBe(true);
    expect(ranked[1].chips.some((c) => c.key === 'estoque' && c.tone === 'blocked')).toBe(true);
  });
});

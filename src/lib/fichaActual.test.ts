import { describe, expect, it } from 'vitest';
import { mergeActualQty, qtyFromReservation } from './fichaActual';

describe('fichaActual', () => {
  it('reserva reserved sem consumo não conta como real', () => {
    expect(qtyFromReservation({ product_id: 'a', status: 'reserved', quantity_reserved: 10, quantity_consumed: 0 })).toBe(0);
  });

  it('consumed/converted usa quantity_consumed e cai no reserved se consumido zerado', () => {
    expect(qtyFromReservation({ product_id: 'a', status: 'consumed', quantity_consumed: 7, quantity_reserved: 10 })).toBe(7);
    expect(qtyFromReservation({ product_id: 'a', status: 'converted', quantity_consumed: 0, quantity_reserved: 10 })).toBe(10);
  });

  it('não soma reserva + movimento do mesmo material — pega o maior', () => {
    const actual = mergeActualQty({
      reservations: [{ product_id: 'napa', status: 'consumed', quantity_consumed: 12 }],
      movements: [{ product_id: 'napa', quantity: 12 }, { product_id: 'cola', quantity: 1 }],
    });
    const napa = actual.find((l) => l.productId === 'napa');
    const cola = actual.find((l) => l.productId === 'cola');
    expect(napa?.qty).toBe(12);
    expect(cola?.qty).toBe(1);
  });
});

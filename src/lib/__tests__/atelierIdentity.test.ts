import { describe, expect, it } from 'vitest';
import { atelierIdentityLabel, atelierJobIdentityLine, atelierLotIdentityLines } from '@/lib/atelierIdentity';

describe('identidade do cartão do Ateliê', () => {
  it('mostra pedido, referência, cor e pares', () => {
    expect(atelierIdentityLabel({
      orderNumber: 'PV-00110',
      reference: 'BT01',
      color: 'PRETO',
      pairs: 48,
    })).toBe('PV-00110 · BT01 · PRETO · 48p');
  });

  it('o job usa o pedido dele e a referência da cor do lote', () => {
    expect(atelierJobIdentityLine(
      { order_number: 'PV-00110', pairs: 960 },
      { reference_code: 'BT01', color: 'PRETO' },
    )).toEqual({
      orderNumber: 'PV-00110',
      reference: 'BT01',
      color: 'PRETO',
      pairs: 960,
    });
  });

  it('lote com vários pedidos lista uma combinação por PV', () => {
    expect(atelierLotIdentityLines({
      reference_code: 'BT01',
      color: 'PRETO',
      orders: [
        { order_number: 'PV-00110', pairs: 480 },
        { order_number: 'PV-00111', pairs: 480 },
      ],
    }).map(atelierIdentityLabel)).toEqual([
      'PV-00110 · BT01 · PRETO · 480p',
      'PV-00111 · BT01 · PRETO · 480p',
    ]);
  });
});

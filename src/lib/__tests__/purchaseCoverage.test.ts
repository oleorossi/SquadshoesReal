import { describe, expect, it } from 'vitest';
import {
  materialCoverageStatus,
  orderReadyForProduction,
  subtractOpenPurchasePending,
} from '@/lib/purchaseCoverage';

describe('abate de OC aberta', () => {
  it('não sugere de novo o que já está comprado e pendente de entrada', () => {
    const lines = subtractOpenPurchasePending(
      [
        { saleOrderId: 'pv-238', productId: 'eva', quantity: 48.4 },
        { saleOrderId: 'pv-238', productId: 'cola', quantity: 19 },
        { saleOrderId: 'pv-239', productId: 'eva', quantity: 10 },
      ],
      new Map([['pv-238:eva', 48.4]]),
    );
    expect(lines.map((line) => line.productId)).toEqual(['cola', 'eva']);
    expect(lines.find((line) => line.saleOrderId === 'pv-239')?.quantity).toBe(10);
  });

  it('abate só o saldo pendente e mantém a falta', () => {
    const [line] = subtractOpenPurchasePending(
      [{ saleOrderId: 'pv-250', productId: 'napa', quantity: 30 }],
      new Map([['pv-250:napa', 12]]),
    );
    expect(line.quantity).toBe(18);
  });

  it('marca falta, comprado, recebido e reservado', () => {
    expect(materialCoverageStatus({ required: 10, reserved: 2, short: 8, openPending: 0, received: 0 })).toBe('falta');
    expect(materialCoverageStatus({ required: 10, reserved: 2, short: 8, openPending: 8, received: 0 })).toBe('comprado');
    expect(materialCoverageStatus({ required: 10, reserved: 2, short: 8, openPending: 0, received: 10 })).toBe('recebido');
    expect(materialCoverageStatus({ required: 10, reserved: 10, short: 0, openPending: 0, received: 0 })).toBe('reservado');
  });

  it('pedido fica pronto para produção quando nada falta comprar nem receber', () => {
    expect(orderReadyForProduction([
      { status: 'reservado' },
      { status: 'recebido' },
    ])).toBe(true);
    expect(orderReadyForProduction([
      { status: 'reservado' },
      { status: 'comprado' },
    ])).toBe(false);
  });
});

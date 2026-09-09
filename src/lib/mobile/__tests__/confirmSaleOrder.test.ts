import { beforeEach, describe, expect, it, vi } from 'vitest';

const { preflightSaleOrderCommand, executeSaleOrderCommand } = vi.hoisted(() => ({
  preflightSaleOrderCommand: vi.fn(),
  executeSaleOrderCommand: vi.fn(),
}));

vi.mock('@/lib/saleOrderCommand', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/saleOrderCommand')>();
  return {
    ...actual,
    preflightSaleOrderCommand,
    executeSaleOrderCommand,
  };
});

import {
  confirmMobileSaleOrder,
  mobileSaleOrderConfirmationKey,
} from '../confirmSaleOrder';

describe('confirmação canônica do PV mobile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('usa ação confirm e chave idempotente estável por pedido/versão', async () => {
    preflightSaleOrderCommand.mockResolvedValue({
      ready: true,
      blockers: [],
      warnings: [],
      order_version: 7,
      gate_enabled: true,
    });
    executeSaleOrderCommand.mockResolvedValue({ receipt_id: 'receipt-1' });

    await confirmMobileSaleOrder('order-1');
    await confirmMobileSaleOrder('order-1');

    expect(mobileSaleOrderConfirmationKey('order-1', 7)).toBe('pv:order-1:confirm:v7');
    expect(executeSaleOrderCommand).toHaveBeenNthCalledWith(1, {
      saleOrderId: 'order-1',
      command: 'confirm',
      expectedOrderVersion: 7,
      idempotencyKey: 'pv:order-1:confirm:v7',
      payload: {},
    });
    expect(executeSaleOrderCommand.mock.calls[1][0].idempotencyKey)
      .toBe(executeSaleOrderCommand.mock.calls[0][0].idempotencyKey);
  });

  it('não executa confirmação quando o preflight bloqueia', async () => {
    preflightSaleOrderCommand.mockResolvedValue({
      ready: false,
      blockers: [{ code: 'missing_sheet', message: 'Ficha não publicada' }],
      warnings: [],
      order_version: 2,
      gate_enabled: true,
    });

    await expect(confirmMobileSaleOrder('order-1')).rejects.toThrow('Ficha não publicada');
    expect(executeSaleOrderCommand).not.toHaveBeenCalled();
  });
});

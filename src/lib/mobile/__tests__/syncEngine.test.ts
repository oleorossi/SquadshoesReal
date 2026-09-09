import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listPendingOrders,
  completeQueuedOrderCreate,
  markAttemptFailed,
  submitMobileSaleOrderAtomic,
  classifyMobileOrderError,
  confirmMobileSaleOrder,
} = vi.hoisted(() => ({
  listPendingOrders: vi.fn(),
  completeQueuedOrderCreate: vi.fn(),
  markAttemptFailed: vi.fn(),
  submitMobileSaleOrderAtomic: vi.fn(),
  classifyMobileOrderError: vi.fn((error: unknown) => (
    error && typeof error === 'object' && 'failureKind' in error
      ? (error as { failureKind: string }).failureKind
      : 'transient'
  )),
  confirmMobileSaleOrder: vi.fn(),
}));

vi.mock('@/lib/mobile/offlineQueue', () => ({
  listPendingOrders,
  completeQueuedOrderCreate,
  markAttemptFailed,
  MOBILE_SALE_ORDER_DRAFT_STATUS: 'Rascunho',
}));
vi.mock('@/lib/mobile/atomicSaleOrder', () => ({ submitMobileSaleOrderAtomic, classifyMobileOrderError }));
vi.mock('@/lib/mobile/confirmSaleOrder', () => ({ confirmMobileSaleOrder }));

import { installAutoSync, triggerSync } from '../syncEngine';

const ownerId = 'owner-1';

function queued(overrides: Record<string, unknown> = {}) {
  const payload = {
    ownerId,
    order: { client_request_id: 'request-1', status: 'Rascunho' },
    items: [{
      reference_id: 'ref-1',
      material_variant_id: 'variant-1',
      color: 'PRETO',
      quantity: 10,
      grade: { '37': 10 },
      unit_price: 137.5,
    }],
  };
  return {
    storage_key: `${ownerId}:request-1`,
    ownerId,
    client_request_id: 'request-1',
    payload,
    createdAt: 1,
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    failureKind: null,
    ...overrides,
  };
}

describe('replay offline do PV mobile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    confirmMobileSaleOrder.mockResolvedValue({ receipt_id: 'receipt-1' });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    });
  });

  afterEach(() => vi.useRealTimers());

  it('reenvia o mesmo payload Rascunho sem reescrever o hash idempotente', async () => {
    const queuedOrder = queued();
    listPendingOrders.mockResolvedValue([queuedOrder]);
    submitMobileSaleOrderAtomic.mockResolvedValue({ order_id: 'order-1', idempotent_replay: false });

    const resultPromise = triggerSync(ownerId);
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toMatchObject({ succeeded: 1, failed: 0 });
    expect(listPendingOrders).toHaveBeenCalledWith(ownerId);
    expect(submitMobileSaleOrderAtomic).toHaveBeenCalledWith(queuedOrder.payload);
    expect(submitMobileSaleOrderAtomic.mock.calls[0][0]).toBe(queuedOrder.payload);
    expect(queuedOrder.payload).toMatchObject({
      ownerId,
      order: { client_request_id: 'request-1', status: 'Rascunho' },
      items: [expect.objectContaining({ material_variant_id: 'variant-1', unit_price: 137.5 })],
    });
    expect(completeQueuedOrderCreate).toHaveBeenCalledWith(ownerId, 'request-1');
    expect(confirmMobileSaleOrder).toHaveBeenCalledWith('order-1');
  });

  it('remove a fila de CREATE e expõe Rascunho quando a confirmação é bloqueada', async () => {
    listPendingOrders.mockResolvedValue([queued()]);
    submitMobileSaleOrderAtomic.mockResolvedValue({ order_id: 'order-1', idempotent_replay: false });
    confirmMobileSaleOrder.mockRejectedValue(Object.assign(
      new Error('Condição de pagamento é obrigatória.'),
      { failureKind: 'permanent' },
    ));

    const resultPromise = triggerSync(ownerId);
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toMatchObject({
      succeeded: 0,
      failed: 0,
      createdAsDraft: 1,
      confirmationUnknown: 0,
      confirmationErrors: [expect.objectContaining({ order_id: 'order-1', outcome: 'draft' })],
    });
    expect(completeQueuedOrderCreate).toHaveBeenCalledWith(ownerId, 'request-1');
    expect(markAttemptFailed).not.toHaveBeenCalled();
    expect(submitMobileSaleOrderAtomic).toHaveBeenCalledTimes(1);
  });

  it('recusa envelope ou payload pertencente a outro usuário sem submetê-lo', async () => {
    listPendingOrders.mockResolvedValue([queued({ ownerId: 'owner-2' })]);

    await expect(triggerSync(ownerId)).resolves.toMatchObject({ failed: 1, succeeded: 0 });
    expect(submitMobileSaleOrderAtomic).not.toHaveBeenCalled();
    expect(completeQueuedOrderCreate).not.toHaveBeenCalled();
  });

  it('classifica erro permanente, registra e não o reenvia na rodada seguinte', async () => {
    const permanent = Object.assign(new Error('cliente bloqueado'), { failureKind: 'permanent' });
    listPendingOrders.mockResolvedValueOnce([queued()]);
    submitMobileSaleOrderAtomic.mockRejectedValue(permanent);

    const first = triggerSync(ownerId);
    await vi.runAllTimersAsync();
    await expect(first).resolves.toMatchObject({ failed: 1 });
    expect(markAttemptFailed).toHaveBeenCalledWith(ownerId, 'request-1', 'cliente bloqueado', 'permanent');
    expect(completeQueuedOrderCreate).not.toHaveBeenCalled();

    vi.clearAllMocks();
    listPendingOrders.mockResolvedValueOnce([queued({
      attempts: 1,
      failureKind: 'permanent',
      lastError: 'cliente bloqueado',
    })]);
    await expect(triggerSync(ownerId)).resolves.toMatchObject({ failed: 1 });
    expect(submitMobileSaleOrderAtomic).not.toHaveBeenCalled();
  });

  it('entrega ao layout o resultado do auto-sync para não ocultar confirmação ambígua', async () => {
    listPendingOrders.mockResolvedValue([queued()]);
    submitMobileSaleOrderAtomic.mockResolvedValue({ order_id: 'order-1', idempotent_replay: false });
    confirmMobileSaleOrder.mockRejectedValue(Object.assign(new Error('timeout'), { failureKind: 'transient' }));
    const onResult = vi.fn();

    const cleanup = installAutoSync(ownerId, onResult);
    await vi.advanceTimersByTimeAsync(1700);

    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      confirmationUnknown: 1,
      confirmationErrors: [expect.objectContaining({ order_id: 'order-1', outcome: 'unknown' })],
    }));
    cleanup();
  });

  it('cancela o boot agendado quando a sessão/owner sai do layout', async () => {
    listPendingOrders.mockResolvedValue([]);
    const onResult = vi.fn();

    const cleanup = installAutoSync(ownerId, onResult);
    cleanup();
    await vi.advanceTimersByTimeAsync(1700);

    expect(listPendingOrders).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});

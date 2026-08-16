import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listPendingOrders, removeFromQueue, markAttemptFailed, submitMobileSaleOrderAtomic } = vi.hoisted(() => ({
  listPendingOrders: vi.fn(),
  removeFromQueue: vi.fn(),
  markAttemptFailed: vi.fn(),
  submitMobileSaleOrderAtomic: vi.fn(),
}));

vi.mock('@/lib/mobile/offlineQueue', () => ({ listPendingOrders, removeFromQueue, markAttemptFailed }));
vi.mock('@/lib/mobile/atomicSaleOrder', () => ({ submitMobileSaleOrderAtomic }));

import { triggerSync } from '../syncEngine';

describe('replay offline do PV mobile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    });
  });

  afterEach(() => vi.useRealTimers());

  it('reenvia o payload enfileirado sem perder material_variant_id nem preço', async () => {
    const payload = {
      order: { client_request_id: 'request-1' },
      items: [{
        reference_id: 'ref-1',
        material_variant_id: 'variant-1',
        color: 'PRETO',
        quantity: 10,
        grade: { '37': 10 },
        unit_price: 137.5,
      }],
    };
    listPendingOrders.mockResolvedValue([{
      client_request_id: 'request-1',
      payload,
      createdAt: 1,
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    }]);
    submitMobileSaleOrderAtomic.mockResolvedValue({ idempotent_replay: false });

    const resultPromise = triggerSync();
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toMatchObject({ succeeded: 1, failed: 0 });
    expect(submitMobileSaleOrderAtomic).toHaveBeenCalledWith(payload);
    expect(removeFromQueue).toHaveBeenCalledWith('request-1');
  });
});

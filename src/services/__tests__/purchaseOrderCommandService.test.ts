import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc },
}));

import {
  createPurchaseOrderFromQuotation,
  executePurchaseOrderCommand,
} from '@/services/purchaseOrderCommandService';

const success = (requestId = 'server-request') => ({
  data: {
    purchase_order_id: 'po-1',
    receipt_id: 'receipt-1',
    client_request_id: requestId,
    request_hash: 'hash',
    replayed: false,
  },
  error: null,
});

describe('purchaseOrderCommandService', () => {
  beforeEach(() => {
    window.localStorage.clear();
    rpc.mockReset();
  });

  it('reusa o request UUID após falha de transporte ambígua', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'network', code: '' } })
      .mockResolvedValueOnce(success());

    const input = {
      command: 'receive' as const,
      purchaseOrderId: 'po-1',
      payload: { receive_all: true },
      logicalKey: 'receive:po-1',
    };
    await expect(executePurchaseOrderCommand(input)).rejects.toMatchObject({ message: 'network' });
    const firstRequest = rpc.mock.calls[0][1].p_client_request_id;
    await executePurchaseOrderCommand(input);
    expect(rpc.mock.calls[1][1].p_client_request_id).toBe(firstRequest);
  });

  it('descarta envelope após erro SQL confirmado e aceita payload corrigido', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'CAS', code: '40001' } })
      .mockResolvedValueOnce(success());

    await expect(executePurchaseOrderCommand({
      command: 'edit',
      purchaseOrderId: 'po-1',
      expectedUpdatedAt: '2026-01-01T00:00:00Z',
      payload: { items: [{ item_id: 'item-1', quantity: 2 }] },
      logicalKey: 'edit:po-1',
    })).rejects.toMatchObject({ code: '40001' });
    const firstRequest = rpc.mock.calls[0][1].p_client_request_id;

    await executePurchaseOrderCommand({
      command: 'edit',
      purchaseOrderId: 'po-1',
      expectedUpdatedAt: '2026-01-02T00:00:00Z',
      payload: { items: [{ item_id: 'item-1', quantity: 3 }] },
      logicalKey: 'edit:po-1',
    });
    expect(rpc.mock.calls[1][1].p_client_request_id).not.toBe(firstRequest);
    expect(rpc.mock.calls[1][1].p_payload).toEqual({
      items: [{ item_id: 'item-1', quantity: 3 }],
    });
  });

  it('não troca silenciosamente o payload de uma tentativa ambígua pendente', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'network', code: '' } });
    await expect(executePurchaseOrderCommand({
      command: 'append',
      purchaseOrderId: 'po-1',
      payload: { items: [{ product_id: 'product-1', quantity: 1 }] },
      logicalKey: 'append:po-1',
    })).rejects.toMatchObject({ message: 'network' });

    await expect(executePurchaseOrderCommand({
      command: 'append',
      purchaseOrderId: 'po-1',
      payload: { items: [{ product_id: 'product-1', quantity: 2 }] },
      logicalKey: 'append:po-1',
    })).rejects.toThrow('tentativa pendente diferente');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('reusa o UUID do command auxiliar após falha de transporte ambígua', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'network', code: '' } })
      .mockResolvedValueOnce(success());

    await expect(createPurchaseOrderFromQuotation('quotation-1'))
      .rejects.toMatchObject({ message: 'network' });
    const firstRequest = rpc.mock.calls[0][1].p_client_request_id;
    await createPurchaseOrderFromQuotation('quotation-1');
    expect(rpc.mock.calls[1][1].p_client_request_id).toBe(firstRequest);
  });

  it('libera o UUID do command auxiliar após erro SQL confirmado', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'invalid', code: '22023' } })
      .mockResolvedValueOnce(success());

    await expect(createPurchaseOrderFromQuotation('quotation-2'))
      .rejects.toMatchObject({ code: '22023' });
    const firstRequest = rpc.mock.calls[0][1].p_client_request_id;
    await createPurchaseOrderFromQuotation('quotation-2');
    expect(rpc.mock.calls[1][1].p_client_request_id).not.toBe(firstRequest);
  });
});

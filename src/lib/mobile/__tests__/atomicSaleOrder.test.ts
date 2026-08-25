import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, getUser, from, fetchClientSalesContext } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  fetchClientSalesContext: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc, from, auth: { getUser } },
}));
vi.mock('@/lib/mobile/clientContext', () => ({
  fetchClientSalesContext,
  clientCommercialBlockMessage: (defaults: { block_reason?: string | null }) => defaults.block_reason || 'Cliente bloqueado',
}));

import {
  MobileOrderSubmissionError,
  classifyMobileOrderError,
  mobileSaleOrderCreateIdempotencyKey,
  submitMobileSaleOrderAtomic,
} from '../atomicSaleOrder';
import type { PendingOrderPayload } from '../offlineQueue';

const payload = {
  ownerId: 'owner-1',
  order: {
    client_request_id: '11111111-1111-4111-8111-111111111111',
    client_id: 'client-1',
    client_name: 'Cliente',
    client_cnpj: '',
    client_contact: '',
    client_order_number: '',
    representative: '',
    payment_condition: '',
    delivery_deadline: null,
    delivery_week: '',
    delivery_month: '',
    notes: '',
    status: 'Rascunho',
    nfe: '',
    remessa: '',
    is_factoring: false,
    factoring_config_id: '',
    packaging_mode: 'colmeia',
  },
  items: [
    { reference_id: 'ref-1', material_variant_id: 'variant-1', color: 'PRETO', quantity: 10, grade: { '37': 10 }, unit_price: 100, strap_colors: [], strap_sourcing: {} },
    { reference_id: 'ref-2', material_variant_id: null, color: 'BRANCO', quantity: 5, grade: { '38': 5 }, unit_price: 120, strap_colors: [], strap_sourcing: {} },
  ],
  client_id: 'client-1',
} satisfies PendingOrderPayload;

describe('submitMobileSaleOrderAtomic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    fetchClientSalesContext.mockResolvedValue({
      commercialDefaults: { block_new_orders: false, block_reason: null },
      priceLookup: { byRefColor: new Map(), byRef: new Map() },
    });
    from.mockImplementation((table: string) => ({
      select: () => ({
        in: async () => table === 'technical_sheets'
          ? { data: [
            { id: 'ref-1', status_ficha: 'publicada' },
            { id: 'ref-2', status_ficha: 'publicada' },
          ], error: null }
          : { data: [{ id: 'variant-1', reference_id: 'ref-1', active: true }], error: null },
      }),
    }));
  });

  it('revalida e envia cabeçalho/itens juntos com o mesmo client_request_id', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        command: 'create',
        receipt_id: 'receipt-1',
        sale_order_id: 'order-1',
        order_version_after: 1,
        result: { order_id: 'order-1', item_ids: ['item-1', 'item-2'] },
        idempotent_replay: false,
      },
      error: null,
    });

    await expect(submitMobileSaleOrderAtomic(payload)).resolves.toMatchObject({ order_id: 'order-1' });
    expect(fetchClientSalesContext).toHaveBeenCalledWith('client-1');
    expect(mobileSaleOrderCreateIdempotencyKey(payload.order.client_request_id))
      .toBe(`pv:create:${payload.order.client_request_id}`);
    expect(rpc).toHaveBeenCalledWith('create_sale_order_command', expect.objectContaining({
      p_client_request_id: payload.order.client_request_id,
      p_items: payload.items,
      p_idempotency_key: `pv:create:${payload.order.client_request_id}`,
      p_header: expect.objectContaining({ status: 'Rascunho' }),
    }));
  });

  it('recusa status Aprovado antes de qualquer leitura ou writer', async () => {
    await expect(submitMobileSaleOrderAtomic({
      ...payload,
      order: { ...payload.order, status: 'Aprovado' },
    })).rejects.toMatchObject({
      code: 'DRAFT_STATUS_REQUIRED',
      failureKind: 'permanent',
    });
    expect(getUser).not.toHaveBeenCalled();
    expect(fetchClientSalesContext).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('recusa replay de outro usuário antes de consultar o writer', async () => {
    await expect(submitMobileSaleOrderAtomic({ ...payload, ownerId: 'owner-2' }))
      .rejects.toMatchObject({ code: 'OWNER_MISMATCH', failureKind: 'permanent' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('torna block_new_orders efetivo e não enfileirável como erro de rede', async () => {
    fetchClientSalesContext.mockResolvedValue({
      commercialDefaults: { block_new_orders: true, block_reason: 'Inadimplência' },
      priceLookup: { byRefColor: new Map(), byRef: new Map() },
    });
    const error = await submitMobileSaleOrderAtomic(payload).catch((caught) => caught);
    expect(error).toMatchObject({ code: 'CLIENT_BLOCKED', failureKind: 'permanent' });
    expect(classifyMobileOrderError(error)).toBe('permanent');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('aceita material da própria ficha (material_variant_id null)', async () => {
    const sheetMaterialPayload = {
      ...payload,
      items: [payload.items[1]],
    };
    rpc.mockResolvedValue({
      data: {
        ok: true,
        command: 'create',
        receipt_id: 'receipt-1',
        sale_order_id: 'order-1',
        result: { order_id: 'order-1', item_ids: ['item-2'] },
        idempotent_replay: false,
      },
      error: null,
    });
    await expect(submitMobileSaleOrderAtomic(sheetMaterialPayload)).resolves.toMatchObject({ order_id: 'order-1' });
  });

  it('trata ok=true como CREATE definitivo mesmo se o resumo de item_ids vier incompleto', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        command: 'create',
        receipt_id: 'receipt-1',
        sale_order_id: 'order-1',
        result: { order_id: 'order-1', item_ids: ['item-1'] },
        idempotent_replay: true,
      },
      error: null,
    });
    await expect(submitMobileSaleOrderAtomic(payload)).resolves.toMatchObject({
      order_id: 'order-1',
      item_ids: ['item-1'],
      receipt_warning: expect.stringContaining('confirmou o PV'),
    });
  });

  it('trata envelope ok=false como recusa permanente, mesmo sem erro PostgREST', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: false,
        command: 'create',
        receipt_id: 'receipt-failed',
        error: { code: 'PZ114', message: 'create command cria somente rascunho' },
      },
      error: null,
    });

    const error = await submitMobileSaleOrderAtomic(payload).catch((caught) => caught);
    expect(error).toMatchObject({ message: 'create command cria somente rascunho' });
    expect(classifyMobileOrderError(error)).toBe('permanent');
  });

  it('reenvia envelope command_in_progress como estado transitório', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: false,
        command: 'create',
        receipt_id: 'receipt-running',
        error: {
          code: 'command_in_progress',
          message: 'Comando idempotente ainda está em processamento.',
        },
      },
      error: null,
    });

    const error = await submitMobileSaleOrderAtomic(payload).catch((caught) => caught);
    expect(classifyMobileOrderError(error)).toBe('transient');
  });

  it('distingue falha de rede de erro permanente', () => {
    expect(classifyMobileOrderError(new TypeError('Failed to fetch'))).toBe('transient');
    expect(classifyMobileOrderError({
      message: 'TypeError: Failed to fetch',
      details: 'FetchError: conexão encerrada',
      code: '',
    })).toBe('transient');
    expect(classifyMobileOrderError(new Error('violates check constraint'))).toBe('permanent');
    expect(classifyMobileOrderError(new MobileOrderSubmissionError('bloqueado', 'permanent', 'BLOCKED')))
      .toBe('permanent');
  });
});

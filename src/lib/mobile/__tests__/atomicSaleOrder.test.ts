import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc },
}));

import { submitMobileSaleOrderAtomic } from '../atomicSaleOrder';

const payload = {
  order: {
    client_request_id: '11111111-1111-4111-8111-111111111111',
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
    status: 'Aprovado',
    total: 0,
  },
  items: [
    { reference_id: 'ref-1', material_variant_id: 'variant-1', color: 'PRETO', quantity: 10, grade: { '37': 10 }, unit_price: 100, strap_colors: [], strap_sourcing: {} },
    { reference_id: 'ref-2', color: 'BRANCO', quantity: 5, grade: { '38': 5 }, unit_price: 120, strap_colors: [], strap_sourcing: {} },
  ],
  client_id: 'client-1',
} as any;

describe('submitMobileSaleOrderAtomic', () => {
  beforeEach(() => rpc.mockReset());

  it('envia cabeçalho e itens juntos com o mesmo client_request_id', async () => {
    rpc.mockResolvedValue({
      data: { order_id: 'order-1', item_ids: ['item-1', 'item-2'], idempotent_replay: false },
      error: null,
    });

    await expect(submitMobileSaleOrderAtomic(payload)).resolves.toMatchObject({ order_id: 'order-1' });
    expect(rpc).toHaveBeenCalledWith('create_sale_order_atomic', expect.objectContaining({
      p_client_request_id: payload.order.client_request_id,
      p_items: payload.items,
    }));
    expect(rpc.mock.calls[0][1].p_items[0]).toMatchObject({ material_variant_id: 'variant-1' });
  });

  it('rejeita replay parcial para a fila não ser removida', async () => {
    rpc.mockResolvedValue({
      data: { order_id: 'order-1', item_ids: ['item-1'], idempotent_replay: true },
      error: null,
    });

    await expect(submitMobileSaleOrderAtomic(payload)).rejects.toThrow('Replay atômico incompleto');
  });

  it('mantém a falha da RPC como erro de retry', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('network') });
    await expect(submitMobileSaleOrderAtomic(payload)).rejects.toThrow('network');
  });
});

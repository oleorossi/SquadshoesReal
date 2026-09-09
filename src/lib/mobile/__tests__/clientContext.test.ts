import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc, from },
}));

import { fetchClientSalesContext } from '../clientContext';

describe('contexto comercial autoritativo do cliente', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({
      data: [{
        price_list_id: 'tabela-herdada',
        payment_condition: '30/60',
        factoring_config_id: null,
        modalidade_frete: null,
        transport_company_id: null,
        discount_pct: 0,
        credit_limit: 0,
        block_new_orders: false,
        block_reason: null,
        inherited_from: 'economic_group',
      }],
      error: null,
    });
    from.mockImplementation((table: string) => {
      if (table === 'clients') throw new Error('não deve reler a tabela direta do cliente');
      if (table === 'price_lists') {
        return {
          select: () => ({
            eq: (_column: string, id: string) => ({
              maybeSingle: async () => ({
                data: {
                  id,
                  name: 'Tabela do grupo',
                  active: true,
                  valid_from: '2026-01-01',
                  valid_to: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: async (_column: string, id: string) => ({
            data: id === 'tabela-herdada'
              ? [{ id: 'faixa-1', reference_id: 'ref-1', color: null, unit_price: 100, min_quantity: 1 }]
              : [],
            error: null,
          }),
        }),
      };
    });
  });

  it('precifica pela tabela efetiva herdada do RPC, não pelo campo direto do cliente', async () => {
    const context = await fetchClientSalesContext('cliente-1');

    expect(rpc).toHaveBeenCalledWith('get_client_commercial_defaults', { p_client_id: 'cliente-1' });
    expect(from).not.toHaveBeenCalledWith('clients');
    expect(context.priceLookup.context).toMatchObject({ id: 'tabela-herdada', effective: true });
    expect(context.priceLookup.byRef.get('ref-1')).toEqual([
      expect.objectContaining({ price: 100, minQty: 1 }),
    ]);
  });
});

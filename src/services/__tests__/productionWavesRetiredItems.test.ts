import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import { listPendingSaleOrdersForWeek } from '../productionWavesService';

describe('listPendingSaleOrdersForWeek · itens retirados da produção', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('soma apenas itens produtivos e remove PV cujo total produtivo ficou zerado', async () => {
    const saleOrders = [
      {
        id: 'pv-misto',
        order_number: 'PV-001',
        client_cnpj: null,
        delivery_deadline: '2026-08-31',
        clients: { razao_social: 'Cliente A' },
        sale_order_items: [
          { quantity: 12, production_excluded_at: null },
          { quantity: 900, production_excluded_at: '2026-08-30T12:00:00Z' },
        ],
        orders: [{ order_number: 'OP-001' }],
      },
      {
        id: 'pv-so-retirado',
        order_number: 'PV-002',
        client_cnpj: null,
        delivery_deadline: '2026-08-31',
        clients: { razao_social: 'Cliente B' },
        sale_order_items: [
          { quantity: 50, production_excluded_at: '2026-08-30T12:00:00Z' },
        ],
        orders: [],
      },
      {
        id: 'pv-atribuido',
        order_number: 'PV-003',
        client_cnpj: null,
        delivery_deadline: '2026-08-31',
        clients: { razao_social: 'Cliente C' },
        sale_order_items: [{ quantity: 30, production_excluded_at: null }],
        orders: [],
      },
    ];

    fromMock.mockImplementation((table: string) => {
      if (table === 'production_wave_item_sources') {
        return {
          select: () => ({
            in: vi.fn().mockResolvedValue({
              data: [{ sale_order_id: 'pv-atribuido' }],
              error: null,
            }),
          }),
        };
      }

      if (table === 'sale_orders') {
        return {
          select: () => ({
            in: () => ({
              lte: vi.fn().mockResolvedValue({ data: saleOrders, error: null }),
            }),
          }),
        };
      }

      throw new Error(`Tabela inesperada no teste: ${table}`);
    });

    const result = await listPendingSaleOrdersForWeek('2026-08-25');

    expect(result).toEqual([
      expect.objectContaining({ id: 'pv-misto', total_pairs: 12 }),
    ]);
  });
});

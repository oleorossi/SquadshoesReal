import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc },
}));

import { preflightSaleOrderCommand } from '@/lib/saleOrderCommand';

describe('preflightSaleOrderCommand RPC', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('envia target_status no payload da transição', async () => {
    rpc.mockResolvedValue({
      data: {
        ready: true,
        blockers: [],
        warnings: [],
        order_version: 9,
      },
      error: null,
    });

    await preflightSaleOrderCommand({
      saleOrderId: '11111111-1111-4111-8111-111111111111',
      command: 'transition',
      expectedOrderVersion: 9,
      payload: { target_status: 'Faturado' },
    });

    expect(rpc).toHaveBeenCalledWith('preflight_sale_order_command', {
      p_sale_order_id: '11111111-1111-4111-8111-111111111111',
      p_command: 'transition',
      p_expected_order_version: 9,
      p_override_id: null,
      p_payload: { target_status: 'Faturado' },
    });
  });

  it('envia objeto vazio de forma explícita nos demais comandos', async () => {
    rpc.mockResolvedValue({
      data: { ready: true, blockers: [], warnings: [], order_version: 2 },
      error: null,
    });

    await preflightSaleOrderCommand({
      saleOrderId: '22222222-2222-4222-8222-222222222222',
      command: 'confirm',
      expectedOrderVersion: 2,
    });

    expect(rpc).toHaveBeenCalledWith(
      'preflight_sale_order_command',
      expect.objectContaining({ p_payload: {} }),
    );
  });
});

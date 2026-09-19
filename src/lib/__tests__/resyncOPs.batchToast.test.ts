import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeSaleOrderCommand = vi.fn();
const from = vi.fn();

vi.mock('@/lib/saleOrderCommand', () => ({
  executeSaleOrderCommand: (...args: unknown[]) => executeSaleOrderCommand(...args),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (...args: unknown[]) => from(...args) },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn() },
}));

describe('resyncOPRecords — lote ordenado e parcial', () => {
  beforeEach(() => {
    executeSaleOrderCommand.mockReset();
    from.mockReset();
  });

  it('ordena por order_number e reporta attempted / erros parciais', async () => {
    from.mockReturnValue({
      select: () => ({
        in: () => Promise.resolve({
          data: [
            { id: 'pv-1', order_version: 3 },
          ],
          error: null,
        }),
      }),
    });

    executeSaleOrderCommand
      .mockResolvedValueOnce({ result: { ok: true } })
      .mockRejectedValueOnce(new Error('PZ105 fato físico'))
      .mockResolvedValueOnce({ result: { ok: true } });

    const {
      resyncOPRecords,
      sortResyncOpsByOrderNumber,
    } = await import('../resyncOPs');

    const unsorted = [
      { id: 'c', order_number: 'OP-2026-04065', sale_order_id: 'pv-1' },
      { id: 'a', order_number: 'OP-2026-04059', sale_order_id: 'pv-1' },
      { id: 'b', order_number: 'OP-2026-04061', sale_order_id: 'pv-1' },
    ];
    expect(sortResyncOpsByOrderNumber(unsorted).map((o) => o.order_number)).toEqual([
      'OP-2026-04059',
      'OP-2026-04061',
      'OP-2026-04065',
    ]);

    const summary = await resyncOPRecords(unsorted);
    expect(summary.attempted).toBe(3);
    expect(summary.totalResyncedOPs).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toEqual([
      'OP OP-2026-04061: PZ105 fato físico',
    ]);
    expect(executeSaleOrderCommand.mock.calls.map((c) => c[0].payload.order_id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('formatResyncBatchToast + invalidação', () => {
  it('toast parcial é warning com N de M e lista de falhas', async () => {
    const { formatResyncBatchToast } = await import('../resyncOPs');
    const msg = formatResyncBatchToast({
      attempted: 7,
      totalResyncedOPs: 6,
      skipped: 0,
      errors: ['OP OP-2026-04059: timeout'],
    });
    expect(msg.tone).toBe('warning');
    expect(msg.title).toBe('6 de 7 OP(s) resincronizada(s)');
    expect(msg.description).toContain('OP-2026-04059');
  });

  it('toast total é success com N de M', async () => {
    const { formatResyncBatchToast } = await import('../resyncOPs');
    const msg = formatResyncBatchToast({
      attempted: 7,
      totalResyncedOPs: 7,
      skipped: 0,
      errors: [],
    });
    expect(msg.tone).toBe('success');
    expect(msg.title).toContain('7 de 7');
    expect(msg.title).toContain('sem apagar identidade ou histórico');
  });

  it('RESYNC_INVALIDATION_QUERY_KEYS inclui badge e consumo do PV', async () => {
    const { RESYNC_INVALIDATION_QUERY_KEYS } = await import('../resyncOPs');
    const keys = RESYNC_INVALIDATION_QUERY_KEYS.map((k) => k.join('/'));
    expect(keys).toContain('pv_outdated_status');
    expect(keys).toContain('pv-consumption');
    expect(keys).toContain('sale_orders');
    expect(keys).toContain('material_reservations');
  });
});

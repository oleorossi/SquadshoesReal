import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc },
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

describe('autoResyncUnstartedOps helpers', () => {
  beforeEach(() => {
    rpc.mockReset();
    toastSuccess.mockReset();
    toastWarning.mockReset();
  });

  it('parseia o payload da RPC da ficha inclusive delta', async () => {
    rpc.mockResolvedValue({
      data: {
        resynced: 2,
        skipped_inactive: 1,
        skipped_started: 3,
        delta_reserved: 2,
        delta_shortfalls: 1,
        errors: [{ order_number: 'OP-1', message: 'estoque' }],
      },
      error: null,
    });
    const { autoResyncUnstartedOpsForSheet } = await import('../resyncOPs');
    const summary = await autoResyncUnstartedOpsForSheet('sheet-1');
    expect(rpc).toHaveBeenCalledWith('auto_resync_unstarted_ops_for_sheet', {
      p_sheet_id: 'sheet-1',
    });
    expect(summary).toEqual({
      resynced: 2,
      skippedInactive: 1,
      skippedStarted: 3,
      deltaReserved: 2,
      deltaShortfalls: 1,
      errors: [{ order_number: 'OP-1', message: 'estoque' }],
    });
  });

  it('toast menciona delta reservado e shortfalls; prioriza falhas', async () => {
    const { toastAutoResyncSummary } = await import('../resyncOPs');
    toastAutoResyncSummary({
      resynced: 2,
      skippedInactive: 0,
      skippedStarted: 1,
      deltaReserved: 0,
      deltaShortfalls: 0,
      errors: [],
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      '2 OPs com consumo atualizado · 1 já iniciada (só sinalizada)',
      { duration: 6000 },
    );

    toastSuccess.mockReset();
    toastAutoResyncSummary({
      resynced: 0,
      skippedInactive: 0,
      skippedStarted: 2,
      deltaReserved: 2,
      deltaShortfalls: 0,
      errors: [],
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      '2 OPs com materiais faltantes reservados',
      { duration: 6000 },
    );

    toastSuccess.mockReset();
    toastAutoResyncSummary({
      resynced: 1,
      skippedInactive: 0,
      skippedStarted: 1,
      deltaReserved: 1,
      deltaShortfalls: 3,
      errors: [],
    });
    expect(toastWarning).toHaveBeenCalledWith(
      '1 OP com consumo atualizado · 1 OP com materiais faltantes reservados · 3 materiais sem estoque livre',
      { duration: 8000 },
    );

    toastSuccess.mockReset();
    toastAutoResyncSummary(
      {
        resynced: 0,
        skippedInactive: 0,
        skippedStarted: 0,
        deltaReserved: 0,
        deltaShortfalls: 0,
        errors: [],
      },
      { emptyMessage: 'nada a fazer' },
    );
    expect(toastSuccess).toHaveBeenCalledWith('nada a fazer');
  });
});

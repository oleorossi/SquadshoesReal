import { describe, expect, it, vi, beforeEach } from 'vitest';
import { applyPointing, promoteOpFromFilaIfNeeded } from '../pointingPlan';
import type { KanbanCardData } from '../kanbanDerive';
import type { OrderStage } from '@/hooks/useOrderStages';

const rpc = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const stage = (name: string, over: Partial<OrderStage> = {}): OrderStage => ({
  id: `st-${name}`,
  order_id: 'op-1',
  stage_name: name,
  stage_order: 1,
  status: 'pendente',
  quantity_processed: 0,
  quantity_total: 100,
  started_at: null,
  completed_at: null,
  completed_by: null,
  observations: '',
  defects: '',
  created_at: '',
  updated_at: '',
  standard_time_minutes: 0,
  cost_per_hour: 0,
  actual_time_minutes: 0,
  cost_per_pair: 0,
  ...over,
} as OrderStage);

function card(over: Partial<KanbanCardData['q']> = {}): KanbanCardData {
  const col = stage('Corte Fibra');
  return {
    key: 'op-1::Corte Fibra',
    parallelSiblings: [],
    q: {
      order_id: 'op-1',
      order_number: 'OP-1',
      quantity: 100,
      queue_status: 'na_fila',
      order_status: 'Reservado',
      sale_order_number: 'PV-00100',
      client_name: 'Cliente',
      ...over,
    } as KanbanCardData['q'],
    stages: [col],
    column: 'Corte Fibra',
    front: null,
    delivered: 0,
    isPartial: false,
    columnStage: col,
    upstreamGap: null,
  };
}

describe('promoteOpFromFilaIfNeeded', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('chama transition Reservado → Em Produção quando na_fila', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await promoteOpFromFilaIfNeeded(card());
    expect(rpc).toHaveBeenCalledWith(
      'execute_production_order_command',
      expect.objectContaining({
        p_command: 'transition',
        p_order_id: 'op-1',
        p_payload: { target_status: 'Em Produção', expected_status: 'Reservado' },
      }),
    );
  });

  it('não promove OP já Em Produção', async () => {
    await promoteOpFromFilaIfNeeded(card({
      queue_status: 'em_producao',
      order_status: 'Em Produção',
    }));
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('applyPointing — promove antes de apontar a partir da Fila', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it('promove e depois aponta', async () => {
    const apontar = {
      mutateAsync: vi.fn().mockResolvedValue({ needs_confirmation: false }),
    };
    const c = card();
    const plan = {
      pointedStage: c.columnStage!,
      isBackward: false,
      skipped: [] as string[],
      remaining: 100,
      stageRemaining: 100,
      available: true,
    };
    const res = await applyPointing({
      card: c,
      plan,
      target: 'Corte Fibra',
      qty: 50,
      apontar: apontar as never,
    });
    expect(res.status).toBe('ok');
    expect(rpc).toHaveBeenCalled();
    expect(apontar.mutateAsync).toHaveBeenCalled();
    const promoteOrder = rpc.mock.invocationCallOrder[0];
    const apontarOrder = apontar.mutateAsync.mock.invocationCallOrder[0];
    expect(promoteOrder).toBeLessThan(apontarOrder);
  });
});

import { describe, it, expect } from 'vitest';
import { buildPointingPlan, moveOptions } from '../pointingPlan';
import type { KanbanCardData } from '../kanbanDerive';
import type { OrderStage } from '@/hooks/useOrderStages';

/**
 * Guard da REGRA ÚNICA de mover card → apontar. O diálogo de um card só e o
 * movimento em lote passam pelos mesmos cálculos: se pulo/estorno/elegibilidade
 * divergirem, o lote grava diferente do individual (bug silencioso no ledger).
 */

const FLOW = new Map<string, number>([
  ['Corte Palmilha', 1], ['Corte Forração', 2], ['Costura', 3],
  ['Aviamento', 4], ['Silk', 5], ['Montagem', 6],
]);

const stage = (name: string, order: number, over: Partial<OrderStage> = {}): OrderStage => ({
  id: `st-${name}`,
  order_id: 'op-1',
  stage_name: name,
  stage_order: order,
  status: 'pendente',
  quantity_processed: 0,
  quantity_total: 100,
  started_at: null, completed_at: null, completed_by: null,
  observations: '', defects: '', created_at: '', updated_at: '',
  standard_time_minutes: 0, cost_per_hour: 0, actual_time_minutes: 0, cost_per_pair: 0,
  ...over,
});

/** Card com o fluxo completo, parado no setor `column`. */
function makeCard(over: {
  stages: OrderStage[];
  column: string;
  front?: OrderStage | null;
}): KanbanCardData {
  const columnStage = over.stages.find(s => s.stage_name === over.column) ?? null;
  return {
    q: { order_id: 'op-1', order_number: 'OP-1', quantity: 100 } as KanbanCardData['q'],
    stages: over.stages,
    column: over.column,
    front: over.front ?? null,
    delivered: 0,
    isPartial: false,
    columnStage,
  };
}

describe('buildPointingPlan', () => {
  it('avança pro próximo setor sem pular nada', () => {
    const stages = [
      stage('Corte Palmilha', 1), stage('Corte Forração', 2), stage('Costura', 3),
    ];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Palmilha' }), 'Corte Forração', FLOW);
    expect(plan.available).toBe(true);
    expect(plan.isBackward).toBe(false);
    expect(plan.skipped).toEqual([]);
    // Aponta no setor ONDE o card está (o trabalho que acabou de acontecer)
    expect(plan.pointedStage?.stage_name).toBe('Corte Palmilha');
    expect(plan.remaining).toBe(100);
  });

  it('lista os setores intermediários quando o destino pula etapas', () => {
    const stages = [
      stage('Corte Palmilha', 1), stage('Corte Forração', 2), stage('Costura', 3), stage('Aviamento', 4),
    ];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Palmilha' }), 'Aviamento', FLOW);
    expect(plan.skipped).toEqual(['Corte Forração', 'Costura']);
    expect(plan.pointedStage?.stage_name).toBe('Corte Palmilha');
  });

  it('setor já concluído não conta como pulo (sai da sequência pendente)', () => {
    const stages = [
      stage('Corte Palmilha', 1, { status: 'concluido', quantity_processed: 100 }),
      stage('Corte Forração', 2), stage('Costura', 3),
    ];
    const front = stages[0];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Forração', front }), 'Costura', FLOW);
    expect(plan.skipped).toEqual([]);
    expect(plan.pointedStage?.stage_name).toBe('Corte Forração');
  });

  it('voltar no fluxo estorna no último setor com progresso', () => {
    const stages = [
      stage('Corte Palmilha', 1, { status: 'concluido', quantity_processed: 100 }),
      stage('Corte Forração', 2),
    ];
    const front = stages[0];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Forração', front }), 'Corte Palmilha', FLOW);
    expect(plan.isBackward).toBe(true);
    expect(plan.available).toBe(true);
    expect(plan.pointedStage?.stage_name).toBe('Corte Palmilha');
    expect(plan.remaining).toBe(100); // pares disponíveis pra estornar
  });

  it('sem nenhum apontamento não há o que estornar', () => {
    const stages = [stage('Corte Palmilha', 1), stage('Corte Forração', 2)];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Forração', front: null }), 'Corte Palmilha', FLOW);
    expect(plan.isBackward).toBe(true);
    expect(plan.available).toBe(false);
    expect(plan.unavailableReason).toMatch(/estornar/i);
  });

  it('destino fora do fluxo da OP fica indisponível (não inventa etapa)', () => {
    const stages = [stage('Corte Palmilha', 1), stage('Corte Forração', 2)];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Palmilha' }), 'Silk', FLOW);
    expect(plan.available).toBe(false);
    expect(plan.unavailableReason).toMatch(/não passa por Silk/i);
  });

  it('sem destino aponta no próprio setor atual', () => {
    const stages = [stage('Corte Palmilha', 1, { quantity_processed: 40 }), stage('Costura', 3)];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Palmilha' }), null, FLOW);
    expect(plan.available).toBe(true);
    expect(plan.isBackward).toBe(false);
    expect(plan.skipped).toEqual([]);
    expect(plan.remaining).toBe(60);
  });
});

describe('moveOptions', () => {
  it('oferece os setores pendentes à frente e o anterior pra voltar', () => {
    const stages = [
      stage('Corte Palmilha', 1, { status: 'concluido', quantity_processed: 100 }),
      stage('Corte Forração', 2), stage('Costura', 3), stage('Aviamento', 4),
    ];
    const front = stages[0];
    const opts = moveOptions(makeCard({ stages, column: 'Corte Forração', front }), FLOW);
    expect(opts.fwdOptions).toEqual(['Costura', 'Aviamento']);
    expect(opts.backOption).toBe('Corte Palmilha');
  });

  it('sem progresso não oferece volta', () => {
    const stages = [stage('Corte Palmilha', 1), stage('Costura', 3)];
    const opts = moveOptions(makeCard({ stages, column: 'Corte Palmilha', front: null }), FLOW);
    expect(opts.backOption).toBeNull();
    expect(opts.fwdOptions).toEqual(['Costura']);
  });
});

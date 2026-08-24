import { describe, expect, it } from 'vitest';
import type { OrderStage } from '@/hooks/useOrderStages';
import type { KanbanCardData } from '../kanbanDerive';
import {
  addUniqueOrderCards,
  buildBulkMoveBatch,
  pruneSelectedCardKeys,
  toggleUniqueOrderCard,
  uniqueCardsByOrder,
} from '../bulkMovePlan';

const FLOW = new Map<string, number>([
  ['Corte Palmilha', 1],
  ['Corte Forração', 1],
  ['Costura', 2],
]);

const stage = (orderId: string, name: string, order: number): OrderStage => ({
  id: `${orderId}-${name}`,
  order_id: orderId,
  stage_name: name,
  stage_order: order,
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
});

function card(orderId: string, column: string, stages?: OrderStage[]): KanbanCardData {
  const route = stages || [
    stage(orderId, 'Corte Palmilha', 1),
    stage(orderId, 'Corte Forração', 2),
    stage(orderId, 'Costura', 3),
  ];
  return {
    key: `${orderId}::${column}`,
    parallelSiblings: [],
    q: {
      order_id: orderId,
      order_number: `OP-${orderId}`,
      quantity: 100,
    } as KanbanCardData['q'],
    stages: route,
    column,
    front: null,
    delivered: 0,
    isPartial: false,
    columnStage: route.find(item => item.stage_name === column) || null,
    upstreamGap: null,
  };
}

describe('seleção em lote do Kanban', () => {
  it('mantém uma única ocorrência de cada OP', () => {
    const cards = [
      card('1', 'Corte Palmilha'),
      card('1', 'Corte Forração'),
      card('2', 'Corte Palmilha'),
    ];
    expect(uniqueCardsByOrder(cards).map(item => item.key)).toEqual([
      '1::Corte Palmilha',
      '2::Corte Palmilha',
    ]);
  });

  it('troca o card paralelo marcado sem duplicar a OP', () => {
    const primeiro = card('1', 'Corte Palmilha');
    const irmao = card('1', 'Corte Forração');
    const outra = card('2', 'Corte Palmilha');
    const selected = new Set([primeiro.key, outra.key]);

    expect([...toggleUniqueOrderCard(selected, [primeiro, irmao, outra], irmao)]).toEqual([
      outra.key,
      irmao.key,
    ]);
  });

  it('remove chaves que sumiram depois da movimentação realtime', () => {
    const atual = card('1', 'Costura');
    const previous = new Set(['1::Corte Palmilha', '2::Corte Palmilha']);
    expect([...pruneSelectedCardKeys(previous, [atual])]).toEqual([]);
  });

  it('soma a busca sem perder seleção manual nem trocar o irmão escolhido', () => {
    const op1 = card('1', 'Corte Palmilha');
    const op2Manual = card('2', 'Corte Forração');
    const op2Busca = card('2', 'Corte Palmilha');
    const op9 = card('9', 'Costura');
    const selected = new Set([op2Manual.key, op9.key]);

    expect([...addUniqueOrderCards(
      selected,
      [op1, op2Manual, op2Busca, op9],
      [op1, op2Busca],
    )]).toEqual([op2Manual.key, op9.key, op1.key]);
  });
});

describe('prévia da distribuição em lote', () => {
  it('bloqueia cards que já estão no setor de destino', () => {
    const current = card('1', 'Corte Palmilha');
    const batch = buildBulkMoveBatch([current], 'Corte Palmilha', FLOW);
    expect(batch.steps).toHaveLength(0);
    expect(batch.blocked[0].reason).toMatch(/já está/i);
  });

  it('deduplica setores paralelos antes de montar os passos', () => {
    const stages = [
      stage('1', 'Corte Palmilha', 1),
      { ...stage('1', 'Corte Forração', 2), status: 'concluido', quantity_processed: 100 },
      stage('1', 'Costura', 3),
    ];
    const batch = buildBulkMoveBatch([
      card('1', 'Corte Palmilha', stages),
      card('1', 'Corte Forração', stages),
    ], 'Costura', FLOW);

    expect(batch.steps).toHaveLength(1);
    expect(batch.duplicateCards).toBe(1);
  });

  it('mantém pulos de setor fora do lote até haver gravação atômica', () => {
    const serialFlow = new Map<string, number>([
      ['Corte Palmilha', 1], ['Corte Forração', 2], ['Costura', 3],
    ]);
    const batch = buildBulkMoveBatch(
      [card('1', 'Corte Palmilha')],
      'Costura',
      serialFlow,
    );

    expect(batch.steps).toHaveLength(0);
    expect(batch.blocked[0].reason).toMatch(/movimentação individual/i);
  });
});

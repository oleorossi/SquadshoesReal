import { describe, expect, it } from 'vitest';
import {
  sortKanbanColumnCards,
  type KanbanSortMode,
} from '@/components/production/kanban/kanbanSort';
import type { KanbanCardData } from '@/components/production/kanban/kanbanDerive';

function card(partial: Partial<KanbanCardData['q']> & { order_id: string }): KanbanCardData {
  return {
    key: partial.order_id,
    column: 'Corte',
    isPartial: false,
    columnStage: null,
    q: {
      order_id: partial.order_id,
      order_number: partial.order_number || partial.order_id,
      reference_id: partial.reference_id ?? 'ref-a',
      reference_name: partial.reference_name ?? 'REF',
      color: partial.color ?? null,
      late_days: partial.late_days ?? 0,
      pinned_position: partial.pinned_position ?? null,
      quantity: 12,
      sale_order_number: null,
      client_name: null,
      client_fantasia: null,
      client_group_name: null,
      due_date: null,
      ...partial,
    } as KanbanCardData['q'],
  } as KanbanCardData;
}

describe('sortKanbanColumnCards', () => {
  it('default atraso: mais atrasada primeiro; pin no topo', () => {
    const mode: KanbanSortMode = 'atraso';
    const sorted = sortKanbanColumnCards([
      card({ order_id: '1', late_days: 2, order_number: 'OP-1' }),
      card({ order_id: '2', late_days: 5, order_number: 'OP-2' }),
      card({ order_id: '3', late_days: 1, pinned_position: 1, order_number: 'OP-3' }),
    ], mode);
    expect(sorted.map((c) => c.q.order_id)).toEqual(['3', '2', '1']);
  });

  it('setup: agrupa solado+cor; dentro do bloco, atraso', () => {
    const sole = new Map<string, string>([
      ['ref-a::PRETO', 'sole-01'],
      ['ref-b::PRETO', 'sole-01'],
      ['ref-c::OFF', 'sole-02'],
    ]);
    const sorted = sortKanbanColumnCards([
      card({ order_id: 'a', reference_id: 'ref-a', color: 'PRETO', late_days: 1 }),
      card({ order_id: 'c', reference_id: 'ref-c', color: 'OFF', late_days: 9 }),
      card({ order_id: 'b', reference_id: 'ref-b', color: 'PRETO', late_days: 4 }),
    ], 'setup', sole);
    // sole-01 PRETO (b late 4, a late 1) depois sole-02 OFF
    expect(sorted.map((c) => c.q.order_id)).toEqual(['b', 'a', 'c']);
  });
});

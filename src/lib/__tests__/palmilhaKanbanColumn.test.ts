import { describe, expect, it } from 'vitest';
import {
  collapsePalmilhaColumns,
  foldPalmilhaCardsForColumn,
  palmilhaCheckState,
  palmilhaColumnComplete,
  resolvePalmilhaPointingTarget,
} from '@/lib/palmilhaKanbanColumn';

describe('collapsePalmilhaColumns', () => {
  it('colapsa fibra+forração numa coluna Palmilha', () => {
    expect(collapsePalmilhaColumns([
      'Palmilha · Fibra', 'Palmilha · Forração', 'Corte Cabedal', 'Montagem',
    ])).toEqual(['Palmilha', 'Corte Cabedal', 'Montagem']);
  });
  it('aceita grafias legadas', () => {
    expect(collapsePalmilhaColumns(['Corte Fibra', 'Corte Forração', 'Silk']))
      .toEqual(['Palmilha', 'Silk']);
  });
});

describe('palmilhaCheckState / column complete', () => {
  it('esconde lado N/A (Q14=B)', () => {
    const s = palmilhaCheckState([
      { stage_name: 'Palmilha · Fibra', status: 'pendente', quantity_processed: 0, quantity_total: 12 },
    ]);
    expect(s.showFibra).toBe(true);
    expect(s.showForracao).toBe(false);
    expect(palmilhaColumnComplete(s)).toBe(false);
  });
  it('completo só quando checks visíveis feitos', () => {
    const s = palmilhaCheckState([
      { stage_name: 'Palmilha · Fibra', status: 'concluido', quantity_processed: 12, quantity_total: 12 },
      { stage_name: 'Palmilha · Forração', status: 'concluido', quantity_processed: 12, quantity_total: 12 },
    ]);
    expect(palmilhaColumnComplete(s)).toBe(true);
  });
  it('só forração: um check basta', () => {
    const s = palmilhaCheckState([
      { stage_name: 'Corte Forração', status: 'concluido', quantity_processed: 10, quantity_total: 10 },
    ]);
    expect(s.showFibra).toBe(false);
    expect(s.showForracao).toBe(true);
    expect(palmilhaColumnComplete(s)).toBe(true);
  });
});

describe('fold + resolve pointing', () => {
  it('um card por OP — prefere fibra aberta', () => {
    const cards = [
      {
        q: { order_id: 'op1' },
        column: 'Palmilha · Fibra',
        columnStage: { status: 'pendente', quantity_processed: 0, quantity_total: 12 },
      },
      {
        q: { order_id: 'op1' },
        column: 'Palmilha · Forração',
        columnStage: { status: 'pendente', quantity_processed: 0, quantity_total: 12 },
      },
      {
        q: { order_id: 'op2' },
        column: 'Montagem',
        columnStage: { status: 'pendente', quantity_processed: 0, quantity_total: 12 },
      },
    ];
    const folded = foldPalmilhaCardsForColumn(cards);
    expect(folded).toHaveLength(2);
    expect(folded.find(c => c.q.order_id === 'op1')?.column).toBe('Palmilha · Fibra');
  });

  it('resolve apontamento pro lado incompleto', () => {
    expect(resolvePalmilhaPointingTarget([
      { stage_name: 'Palmilha · Fibra', status: 'concluido', quantity_processed: 12, quantity_total: 12 },
      { stage_name: 'Palmilha · Forração', status: 'pendente', quantity_processed: 0, quantity_total: 12 },
    ])).toBe('Palmilha · Forração');
  });
});

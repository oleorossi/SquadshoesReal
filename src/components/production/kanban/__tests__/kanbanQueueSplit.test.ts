import { describe, expect, it } from 'vitest';
import {
  cardCommercialPrimary,
  countsForConstraint,
  filterCardsForChao,
  filterCardsForFila,
  filterQueueByMode,
  isChaoQueueStatus,
  isFilaQueueStatus,
  partialRemaining,
} from '../kanbanQueueSplit';
import type { KanbanCardData } from '../kanbanDerive';
import type { QueueDetailRow } from '@/hooks/useProductionEngine';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const q = (over: Partial<QueueDetailRow>): QueueDetailRow =>
  ({ order_id: 'op-1', order_number: 'OP-1', quantity: 12, queue_status: 'em_producao', ...over }) as QueueDetailRow;

const card = (over: Partial<QueueDetailRow>): KanbanCardData =>
  ({
    key: 'op-1::Corte',
    parallelSiblings: [],
    q: q(over),
    stages: [],
    column: 'Corte Fibra',
    front: null,
    delivered: 0,
    isPartial: false,
    columnStage: null,
    upstreamGap: null,
  });

describe('kanbanQueueSplit — Chão vs Fila', () => {
  it('reconhece em_producao / na_fila', () => {
    expect(isChaoQueueStatus('em_producao')).toBe(true);
    expect(isFilaQueueStatus('na_fila')).toBe(true);
    expect(isChaoQueueStatus('na_fila')).toBe(false);
  });

  it('filterQueueByMode separa reservadas do chão', () => {
    const rows = [
      q({ order_id: 'a', queue_status: 'em_producao' }),
      q({ order_id: 'b', queue_status: 'na_fila' }),
      q({ order_id: 'c', queue_status: 'em_producao' }),
    ];
    expect(filterQueueByMode(rows, 'chao').map(r => r.order_id)).toEqual(['a', 'c']);
    expect(filterQueueByMode(rows, 'fila').map(r => r.order_id)).toEqual(['b']);
  });

  it('filterCardsForChao / Fila espelham o status da fila', () => {
    const cards = [
      card({ order_id: 'a', queue_status: 'em_producao' }),
      card({ order_id: 'b', queue_status: 'na_fila' }),
    ];
    expect(filterCardsForChao(cards)).toHaveLength(1);
    expect(filterCardsForFila(cards)[0].q.order_id).toBe('b');
  });

  it('countsForConstraint ignora na_fila (WIP/gargalo só no chão)', () => {
    expect(countsForConstraint(card({ queue_status: 'em_producao' }))).toBe(true);
    expect(countsForConstraint(card({ queue_status: 'na_fila' }))).toBe(false);
  });
});

describe('kanbanQueueSplit — face do card', () => {
  it('prioriza PV + fantasia/grupo/razão social', () => {
    expect(cardCommercialPrimary({
      sale_order_number: 'PV-00199',
      client_name: 'RAZAO LTDA',
      client_fantasia: 'LOJA NALIN',
      client_group_name: 'GRUPO X',
    })).toEqual({ pv: 'PV-00199', client: 'LOJA NALIN' });

    expect(cardCommercialPrimary({
      sale_order_number: null,
      client_name: 'RAZAO',
      client_fantasia: null,
      client_group_name: 'GRUPO',
    })).toEqual({ pv: '—', client: 'GRUPO' });
  });

  it('partialRemaining é o saldo preso no setor', () => {
    expect(partialRemaining(84, 120)).toBe(36);
    expect(partialRemaining(120, 120)).toBe(0);
  });
});

describe('promote_op_on_first_pointing — contrato da migration', () => {
  it('trigger promove Reservado → Em Produção no INSERT de pointing qty>0', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../../../supabase/migrations/20270101027000_promote_op_on_first_pointing.sql'),
      'utf8',
    );
    expect(sql).toContain('tg_promote_op_on_first_pointing');
    expect(sql).toContain("status = 'Em Produção'");
    expect(sql).toContain("o.status = 'Reservado'");
    expect(sql).toContain('NEW.quantity <= 0');
    expect(sql).toContain('AFTER INSERT ON public.production_pointings');
  });
});

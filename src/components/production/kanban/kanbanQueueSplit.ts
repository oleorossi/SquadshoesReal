import type { QueueDetailRow } from '@/hooks/useProductionEngine';
import type { KanbanCardData } from './kanbanDerive';

/** Modo da Central: chão = só em produção; fila = reservadas. */
export type KanbanBoardMode = 'chao' | 'fila';

/** OP liberada no quadro de chão (status sync → em_producao). */
export function isChaoQueueStatus(status: string | null | undefined): boolean {
  return status === 'em_producao';
}

/** OP reservada — lista da Fila, fora das colunas. */
export function isFilaQueueStatus(status: string | null | undefined): boolean {
  return status === 'na_fila';
}

export function filterQueueByMode(
  queue: QueueDetailRow[],
  mode: KanbanBoardMode,
): QueueDetailRow[] {
  return queue.filter(q =>
    mode === 'chao' ? isChaoQueueStatus(q.queue_status) : isFilaQueueStatus(q.queue_status),
  );
}

/** Cards do quadro: só `em_producao`. */
export function filterCardsForChao(cards: KanbanCardData[]): KanbanCardData[] {
  return cards.filter(c => isChaoQueueStatus(c.q.queue_status));
}

/** Cards da Fila: `na_fila` (pode haver 1+ por OP em paralelo — dedupe depois). */
export function filterCardsForFila(cards: KanbanCardData[]): KanbanCardData[] {
  return cards.filter(c => isFilaQueueStatus(c.q.queue_status));
}

/**
 * Gargalo / WIP: só trabalho liberado no chão.
 *
 * Reservadas saíram do quadro; se ainda aparecerem (legado), não contam.
 */
export function countsForConstraint(c: KanbanCardData): boolean {
  return isChaoQueueStatus(c.q.queue_status);
}

/** Texto principal do card: PV + cliente (fantasia/grupo quando ajuda). */
export function cardCommercialPrimary(q: Pick<
  QueueDetailRow,
  'sale_order_number' | 'client_name' | 'client_fantasia' | 'client_group_name'
>): { pv: string; client: string } {
  const pv = (q.sale_order_number || '').trim() || '—';
  const client =
    (q.client_fantasia || '').trim()
    || (q.client_group_name || '').trim()
    || (q.client_name || '').trim()
    || '—';
  return { pv, client };
}

/** Pares ainda presos neste setor (parcial). */
export function partialRemaining(
  delivered: number,
  total: number,
): number {
  return Math.max(0, total - delivered);
}

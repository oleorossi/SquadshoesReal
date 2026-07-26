import type { QueueDetailRow } from '@/hooks/useProductionEngine';
import type { OrderStage } from '@/hooks/useOrderStages';

export const norm = (s: string) => (s === 'Mesa' ? 'Aviamento' : s);
export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
export const todayISO = () => new Date().toISOString().slice(0, 10);

export interface KanbanCardData {
  q: QueueDetailRow;
  stages: OrderStage[];          // estágios da OP em ordem de fluxo
  column: string;                // setor onde o card está (R5.1)
  front: OrderStage | null;      // último setor com progresso (entrega pro column)
  delivered: number;             // pares entregues pro setor do card
  isPartial: boolean;            // amarelo (R5.3)
  columnStage: OrderStage | null;
}

/**
 * Ordem REAL das etapas de UMA OP = `order_stages.stage_order` (a rota daquela
 * ficha), não a `sector_settings.flow_order` global.
 *
 * ⚠ Não inverter isso (auditoria 2026-07-26 contra o banco de produção): hoje
 * `sector_settings` tem Aviamento(30) ANTES de Costura(40), enquanto 229 das
 * 232 OPs têm Costura(3) antes de Aviamento(4) — e é o `stage_order` da OP que
 * o servidor valida em `apontar_producao_setor`. Ordenar pela config global
 * fazia "mover Corte Forração → Costura" enxergar Aviamento no meio do caminho
 * e FECHÁ-LO com 0 pares (setor pulado sem produção). `flow_order` só serve
 * pra ordenar as COLUNAS na tela; a rota de cada OP manda no resto.
 */
export function orderStagesByRoute(stages: OrderStage[], flowOrder: Map<string, number>): OrderStage[] {
  return [...stages].sort(
    (a, b) =>
      (a.stage_order - b.stage_order) ||
      ((flowOrder.get(norm(a.stage_name)) ?? 0) - (flowOrder.get(norm(b.stage_name)) ?? 0)),
  );
}

/**
 * Posição do card (decisão do dono, entrevista 2026-07-12): UM card só por OP,
 * na coluna MAIS AVANÇADA. Arrastar Corte→Costura apontando 120/300 move o card
 * pra Costura mostrando 120/300 em AMARELO — os 180 não cortados ficam
 * implícitos no contador. O card normaliza quando a entrega completa (R5.3/5.4).
 */
export function deriveCard(q: QueueDetailRow, stagesRaw: OrderStage[], flowOrder: Map<string, number>): KanbanCardData | null {
  const stages = orderStagesByRoute(stagesRaw, flowOrder);
  const hasProgress = (s: OrderStage) => s.quantity_processed > 0 || s.status === 'concluido';
  let front: OrderStage | null = null;
  for (const s of stages) if (hasProgress(s)) front = s;

  let column: OrderStage | null = null;
  if (!front) {
    column = stages.find(s => s.status !== 'concluido') ?? null;
  } else {
    const idx = stages.indexOf(front);
    column = stages.slice(idx + 1).find(s => s.status !== 'concluido') ?? null;
    if (!column) {
      // front é o último setor: parcial fica nele; completo = OP saindo do quadro
      if (front.status !== 'concluido' && front.quantity_processed < front.quantity_total) column = front;
      else return null;
    }
  }
  if (!column) return null;

  const delivered = !front ? 0
    : front === column ? column.quantity_processed
    : (front.status === 'concluido' ? front.quantity_total : front.quantity_processed);
  const total = column.quantity_total || q.quantity;
  return {
    q, stages,
    column: norm(column.stage_name),
    front,
    delivered,
    isPartial: !!front && delivered < total,
    columnStage: column,
  };
}

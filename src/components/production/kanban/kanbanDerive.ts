import type { QueueDetailRow } from '@/hooks/useProductionEngine';
import type { OrderStage } from '@/hooks/useOrderStages';

export const norm = (s: string) => (s === 'Mesa' ? 'Aviamento' : s);
export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

/**
 * Data de HOJE no fuso LOCAL — reexporta o helper canônico de `@/lib/date`.
 *
 * ⚠ Não voltar pra `new Date().toISOString().slice(0,10)`: aquilo é UTC, e em
 * São Paulo (UTC-3) já retorna o dia SEGUINTE a partir das ~21h. O cabeçalho de
 * capacidade das colunas ("hoje: 600/600 pares") passava a noite inteira
 * mostrando a grade de AMANHÃ rotulada como hoje — quem programa o turno da
 * noite decidia em cima do dia errado.
 */
export { todayISO } from '@/lib/date';

export interface KanbanCardData {
  q: QueueDetailRow;
  stages: OrderStage[];          // estágios da OP em ordem de fluxo
  column: string;                // setor onde o card está (R5.1)
  front: OrderStage | null;      // último setor com progresso (entrega pro column)
  delivered: number;             // pares entregues pro setor do card
  isPartial: boolean;            // amarelo (R5.3)
  columnStage: OrderStage | null;
  /**
   * Primeiro setor ANTES da coluna do card que ficou com saldo aberto — o buraco
   * que o pulo de setor deixa pra trás. `null` quando a rota até aqui está
   * íntegra. Ver `deriveCard`.
   */
  upstreamGap: { sector: string; missing: number } | null;
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

  /**
   * Pares ENTREGUES pro setor do card = o que o setor de trás de fato apontou.
   *
   * ⚠ Não voltar a ler `quantity_total` quando o front está `concluido`
   * (auditoria 2026-08-06 contra o banco de produção): setor PULADO é fechado
   * com `quantity_processed = 0`, então "concluído" NÃO implica "produzido".
   * Trocar o número real (0) pelo nominal fazia o card da OP-2026-01191 anunciar
   * `288/288` no Acabamento com 180 pares cortados — e, como `delivered` batia
   * com o total, `isPartial` dava false: saía verde, sem o âmbar que existe
   * exatamente pra esse caso (R5.3). Quem programa o turno alocava gente pra
   * acabar 288 pares que não existiam.
   *
   * Setor concluído de verdade tem `quantity_processed == quantity_total`, então
   * ler o processado não muda nada no caminho normal — só para de mentir no pulo.
   */
  const delivered = !front ? 0
    : front === column ? column.quantity_processed
    : front.quantity_processed;
  const total = column.quantity_total || q.quantity;

  // Buraco deixado pra trás: primeiro setor ANTES da coluna que não fechou o
  // total. É o saldo abandonado na origem quando se pula com quantidade parcial
  // (OP-2026-01191: 108 pares nunca cortados; OP-2026-01195: 24).
  const colIdx = stages.indexOf(column);
  const gapStage = stages.slice(0, colIdx).find(s => s.quantity_processed < s.quantity_total) ?? null;
  const upstreamGap = gapStage
    ? { sector: norm(gapStage.stage_name), missing: gapStage.quantity_total - gapStage.quantity_processed }
    : null;

  return {
    q, stages,
    column: norm(column.stage_name),
    front,
    delivered,
    // Parcial também quando a rota ATRÁS ficou com saldo: o card pode ter
    // recebido o lote cheio do setor imediatamente anterior e ainda assim haver
    // pares que nunca passaram por um setor pulado lá atrás.
    isPartial: !!front && (delivered < total || !!upstreamGap),
    columnStage: column,
    upstreamGap,
  };
}

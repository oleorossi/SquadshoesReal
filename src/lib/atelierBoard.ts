/**
 * Quadro e visão por PV do Ateliê.
 *
 * O cartão anda por JOB. O corte continua no LOTE (uma faca, um débito de napa).
 * Nada aqui grava: as RPCs existentes é que mudam status.
 */
import {
  ATELIER_PIPELINE_LABEL,
  ATELIER_SECTOR_LABEL,
  atelierEffectiveMode,
  atelierJobBlocksProduction,
  atelierNextInternalOk,
  atelierNextStreetOk,
  type AtelierExecutionMode,
  type AtelierPipelineStatus,
  type AtelierSector,
} from '@/lib/atelier';
import { normalizeFilaText } from '@/lib/atelierFilaFilters';
import { daysUntilDeadline } from '@/lib/production/productionSequence';

export type AtelierBoardRail = 'antes' | 'prestador' | 'interno';

export interface AtelierBoardColumn {
  id: AtelierPipelineStatus;
  title: string;
  rail: AtelierBoardRail;
}

/** Colunas do quadro, na ordem do fluxo. Interno e prestador são trilhas paralelas depois do corte. */
export const ATELIER_BOARD_COLUMNS: readonly AtelierBoardColumn[] = [
  { id: 'awaiting_cut', title: 'Aguardando corte', rail: 'antes' },
  { id: 'cut', title: 'Cortado', rail: 'antes' },
  { id: 'sent_to_contractor', title: 'Enviado ao prestador', rail: 'prestador' },
  { id: 'realized', title: 'Realizado', rail: 'prestador' },
  { id: 'partially_received', title: 'Recebido parcial', rail: 'prestador' },
  { id: 'received_at_factory', title: 'Recebido e conferido', rail: 'prestador' },
  { id: 'in_progress', title: 'Em realização', rail: 'interno' },
  { id: 'partially_done', title: 'Concluído parcial', rail: 'interno' },
  { id: 'done', title: 'Concluído', rail: 'interno' },
];

export const ATELIER_RAIL_LABEL: Record<AtelierBoardRail, string | null> = {
  antes: null,
  prestador: 'Prestador',
  interno: 'Interno',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECTOR_TOKEN: Record<string, string> = {
  costura: ATELIER_SECTOR_LABEL.costura_cabedal,
  costura_cabedal: ATELIER_SECTOR_LABEL.costura_cabedal,
  aviamento: ATELIER_SECTOR_LABEL.aviamento,
  corte: ATELIER_SECTOR_LABEL.corte_cabedal,
  corte_cabedal: ATELIER_SECTOR_LABEL.corte_cabedal,
};

/** Coluna do quadro para um job. Cancelado não entra. */
export function atelierJobBoardColumn(
  status: AtelierPipelineStatus | string | null | undefined,
): AtelierPipelineStatus | null {
  if (!status || status === 'cancelled') return null;
  return ATELIER_BOARD_COLUMNS.some((c) => c.id === status) ? (status as AtelierPipelineStatus) : null;
}

/**
 * O selo do PV recebe `uuid · costura · awaiting_cut` do banco.
 * A tela mostra setor e etapa em português, sem o id.
 */
export function humanizeAtelierPendingJobToken(token: string): string {
  const parts = token.split('·').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  let sector = parts[0];
  let status = parts[1] ?? '';
  if (parts.length >= 3 && UUID_RE.test(parts[0])) {
    sector = parts[1];
    status = parts.slice(2).join(' · ');
  }
  const sectorLabel = SECTOR_TOKEN[sector] ?? sector;
  const statusLabel = ATELIER_PIPELINE_LABEL[status as AtelierPipelineStatus] ?? status;
  return statusLabel ? `${sectorLabel} · ${statusLabel}` : sectorLabel;
}

export function humanizeAtelierPendingJobs(raw: string | null | undefined): string {
  return String(raw ?? '')
    .split(';')
    .map((t) => humanizeAtelierPendingJobToken(t.trim()))
    .filter(Boolean)
    .join('; ');
}

/** Troca `status: awaiting_cut` pelo rótulo da etapa, no motivo do portão. */
export function humanizeAtelierBlockReason(reason: string): string {
  let out = reason;
  for (const [key, label] of Object.entries(ATELIER_PIPELINE_LABEL)) {
    out = out.split(`status: ${key}`).join(`status: ${label}`);
  }
  return out;
}

export { atelierJobBlocksProduction };

/** Atraso contra a data em que o job deveria voltar (`target_end`), não contra a entrega do PV. */
export function atelierJobIsLate(
  targetEnd: string | null | undefined,
  status: AtelierPipelineStatus | string | null | undefined,
  mode: AtelierExecutionMode | string | null | undefined,
  today = new Date(),
): boolean {
  if (!atelierJobBlocksProduction(mode, status, undefined)) return false;
  const days = daysUntilDeadline(targetEnd, today);
  return days != null && days < 0;
}

export function atelierFilaHref(orderNumber: string): string {
  return `/atelie?view=fila&pedido=${encodeURIComponent(orderNumber)}`;
}

export type AtelierBatchAction = 'realized' | 'received' | 'internal_start' | 'internal_done';

export type AtelierSingleAction = AtelierBatchAction | 'sent';

/** Próximo OK legal. Envio não entra em lote: escolhe prestador e pode debitar o kit. */
export function atelierBatchAction(job: {
  execution_mode?: AtelierExecutionMode | string | null;
  pipeline_status: AtelierPipelineStatus | string;
}): AtelierBatchAction | null {
  const mode = atelierEffectiveMode(job.execution_mode);
  if (mode === 'internal') {
    const next = atelierNextInternalOk(job.pipeline_status);
    if (next === 'in_progress') return 'internal_start';
    if (next === 'done') return 'internal_done';
    return null;
  }
  const next = atelierNextStreetOk(job.pipeline_status);
  if (next === 'realized') return 'realized';
  if (next === 'received_at_factory') return 'received';
  return null;
}

export function atelierSingleAction(job: {
  execution_mode?: AtelierExecutionMode | string | null;
  pipeline_status: AtelierPipelineStatus | string;
}): AtelierSingleAction | null {
  const batched = atelierBatchAction(job);
  if (batched) return batched;
  if (atelierEffectiveMode(job.execution_mode) === 'contractor'
    && atelierNextStreetOk(job.pipeline_status) === 'sent_to_contractor') {
    return 'sent';
  }
  return null;
}

export function sharedBatchAction(
  actions: readonly (AtelierBatchAction | null | undefined)[],
): AtelierBatchAction | null {
  const live = actions.filter((a): a is AtelierBatchAction => !!a);
  if (live.length === 0) return null;
  return live.every((a) => a === live[0]) ? live[0] : null;
}

export function atelierBatchButtonLabel(action: AtelierBatchAction, count: number): string {
  const n = String(count);
  switch (action) {
    case 'realized':
      return `Marcar realizado (${n})`;
    case 'received':
      return `Conferir selecionados (${n})`;
    case 'internal_start':
      return `Em realização (${n})`;
    case 'internal_done':
      return `Concluir selecionados (${n})`;
    default:
      return `Avançar (${n})`;
  }
}

export function atelierTimeline(mode: AtelierExecutionMode | string | null | undefined): {
  id: AtelierPipelineStatus;
  label: string;
}[] {
  const head: { id: AtelierPipelineStatus; label: string }[] = [
    { id: 'awaiting_cut', label: ATELIER_PIPELINE_LABEL.awaiting_cut },
    { id: 'cut', label: ATELIER_PIPELINE_LABEL.cut },
  ];
  if (atelierEffectiveMode(mode) === 'internal') {
    return [
      ...head,
      { id: 'in_progress', label: ATELIER_PIPELINE_LABEL.in_progress },
      { id: 'partially_done', label: 'Parcial' },
      { id: 'done', label: ATELIER_PIPELINE_LABEL.done },
    ];
  }
  return [
    ...head,
    { id: 'sent_to_contractor', label: 'Enviado' },
    { id: 'realized', label: ATELIER_PIPELINE_LABEL.realized },
    { id: 'partially_received', label: 'Parcial' },
    { id: 'received_at_factory', label: 'Conferido' },
  ];
}

export interface AtelierBoardFilters {
  orderNumber: string;
  color: string;
  sector: '' | 'costura_cabedal' | 'aviamento';
  mode: '' | AtelierExecutionMode;
  lateOnly: boolean;
  blocksProductionOnly: boolean;
}

export const EMPTY_ATELIER_BOARD_FILTERS: AtelierBoardFilters = {
  orderNumber: '',
  color: '',
  sector: '',
  mode: '',
  lateOnly: false,
  blocksProductionOnly: false,
};

export function atelierBoardFiltersActive(filters: AtelierBoardFilters): boolean {
  return Boolean(
    filters.orderNumber
    || filters.color
    || filters.sector
    || filters.mode
    || filters.lateOnly
    || filters.blocksProductionOnly,
  );
}

export function matchesAtelierBoardJob(
  job: {
    order_number: string;
    sector: string;
    execution_mode?: AtelierExecutionMode | string | null;
    pipeline_status: string;
    target_end?: string | null;
    received_pairs?: number | null;
  },
  lot: { color?: string | null },
  filters: AtelierBoardFilters,
  today = new Date(),
): boolean {
  if (filters.orderNumber && job.order_number !== filters.orderNumber) return false;
  if (filters.color) {
    const needle = normalizeFilaText(filters.color);
    if (needle && !normalizeFilaText(lot.color).includes(needle)) return false;
  }
  if (filters.sector && job.sector !== filters.sector) return false;
  if (filters.mode && atelierEffectiveMode(job.execution_mode) !== filters.mode) return false;
  if (filters.lateOnly && !atelierJobIsLate(job.target_end, job.pipeline_status, job.execution_mode, today)) {
    return false;
  }
  if (filters.blocksProductionOnly && !atelierJobBlocksProduction(job.execution_mode, job.pipeline_status, job.received_pairs)) {
    return false;
  }
  return true;
}

export interface LotCutLine {
  lot_number: string;
  reference_code?: string | null;
  color?: string | null;
  orders: readonly { order_number: string }[];
}

function uniqueOrderNumbers(orders: readonly { order_number: string }[]): string[] {
  return [...new Set(orders.map((o) => o.order_number).filter(Boolean))];
}

/**
 * Confirmação do corte. Lote com mais de um PV nomeia os outros:
 * o corte debita a napa de todo mundo que está na mesma faca.
 */
export function lotCutConfirmMessage(lots: readonly LotCutLine[], focusOrderNumber?: string): string {
  const heads = lots.map((lot) => lot.lot_number).filter(Boolean);
  const intro = lots.length === 1
    ? `Confirmar o corte do ${heads[0] || 'lote'}?`
    : `Confirmar o corte de ${lots.length} lotes?`;
  const sharing = lots.flatMap((lot) => {
    const numbers = uniqueOrderNumbers(lot.orders);
    if (numbers.length <= 1) return [];
    const who = [lot.reference_code, lot.color].filter(Boolean).join(' ');
    const label = who ? `${lot.lot_number} (${who})` : lot.lot_number;
    if (focusOrderNumber) {
      const others = numbers.filter((n) => n !== focusOrderNumber);
      if (others.length === 0) return [];
      return [`${label} também leva ${others.join(', ')}.`];
    }
    return [`${label} junta ${numbers.join(', ')}.`];
  });
  const extra = sharing.length > 0 ? `\n${sharing.join('\n')}` : '';
  return `${intro} A napa do kit sai do estoque agora.${extra}`;
}

export interface AtelierOrderGroup<L, J> {
  orderNumber: string;
  clientName: string | null;
  deliveryDeadline: string | null;
  pairs: number;
  entries: { lot: L; job: J }[];
  /** Lotes ainda abertos que incluem este PV. Cortar um deles corta os outros PVs da mesma faca. */
  openLots: L[];
}

export function groupAtelierJobsByOrder<
  L extends {
    id: string;
    status: string;
    orders: readonly {
      order_number: string;
      client_name?: string | null;
      delivery_deadline?: string | null;
      pairs?: number;
    }[];
    jobs: readonly { order_number: string; pipeline_status: string }[];
  },
>(lots: readonly L[]): AtelierOrderGroup<L, L['jobs'][number]>[] {
  const byOrder = new Map<string, AtelierOrderGroup<L, L['jobs'][number]>>();

  const bucket = (orderNumber: string) => {
    let group = byOrder.get(orderNumber);
    if (!group) {
      group = {
        orderNumber,
        clientName: null,
        deliveryDeadline: null,
        pairs: 0,
        entries: [],
        openLots: [],
      };
      byOrder.set(orderNumber, group);
    }
    return group;
  };

  for (const lot of lots) {
    for (const order of lot.orders) {
      if (!order.order_number) continue;
      const group = bucket(order.order_number);
      if (!group.clientName && order.client_name) group.clientName = order.client_name;
      if (
        order.delivery_deadline
        && (!group.deliveryDeadline || order.delivery_deadline < group.deliveryDeadline)
      ) {
        group.deliveryDeadline = order.delivery_deadline;
      }
      const pairs = Number(order.pairs);
      if (Number.isFinite(pairs) && pairs > 0) group.pairs += pairs;
      if (lot.status === 'open' && !group.openLots.some((l) => l.id === lot.id)) {
        group.openLots.push(lot);
      }
      for (const job of lot.jobs) {
        if (job.order_number !== order.order_number) continue;
        if (job.pipeline_status === 'cancelled') continue;
        group.entries.push({ lot, job });
      }
    }
  }

  return [...byOrder.values()].sort((a, b) => {
    const da = a.deliveryDeadline || '';
    const db = b.deliveryDeadline || '';
    if (!da && db) return 1;
    if (da && !db) return -1;
    return da.localeCompare(db) || a.orderNumber.localeCompare(b.orderNumber, 'pt-BR');
  });
}

export interface BatchFailure {
  label: string;
  reason: string;
}

export function errorReason(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return 'Falha ao avançar';
}

/** Roda uma RPC por item. Uma falha não interrompe as outras. */
export async function runLabeledBatch(
  items: readonly { label: string; run: () => Promise<unknown> }[],
): Promise<{ ok: number; failed: BatchFailure[] }> {
  const failed: BatchFailure[] = [];
  let ok = 0;
  for (const item of items) {
    try {
      await item.run();
      ok += 1;
    } catch (error) {
      failed.push({ label: item.label, reason: errorReason(error) });
    }
  }
  return { ok, failed };
}

export function jobFailureLabel(job: {
  sector: AtelierSector | string;
  order_number: string;
}, lot?: { reference_code?: string | null; color?: string | null; lot_number?: string }): string {
  const sector = ATELIER_SECTOR_LABEL[job.sector as AtelierSector] ?? job.sector;
  const where = [lot?.reference_code, lot?.color].filter(Boolean).join(' ');
  return [sector, job.order_number, where, lot?.lot_number].filter(Boolean).join(' · ');
}

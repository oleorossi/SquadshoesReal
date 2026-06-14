/**
 * Service Order (OS) Status State Machine
 *
 * Espelho do `saleOrderStateMachine.ts`, mas para Ordens de Serviço (terceirização).
 * Centraliza o vocabulário canônico de status que estava espalhado em Contractors.tsx
 * e nos triggers do banco. O DB mistura grafias por razões históricas:
 *   - 'Concluído' (do form) vs 'received'/'finalizado' (fluxo de gargalos)
 *   - 'Cancelado' vs 'cancelled' (legacy)
 *   - 'pending_quote'/'quoted_unconfirmed'/'quoted' (cotação pré-execução do /gargalos)
 * `normalizeOsStatus` mapeia tudo para 1 dos 4 estados canônicos.
 */

export const OS_STATUS = {
  PENDENTE: 'Pendente',
  EM_ANDAMENTO: 'Em Andamento',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
} as const;

export type OsStatus = (typeof OS_STATUS)[keyof typeof OS_STATUS];

// Grafias cruas → estado canônico. Lowercase na lookup pra cobrir variações de caixa.
const NORMALIZE: Record<string, OsStatus> = {
  pendente: OS_STATUS.PENDENTE,
  pending: OS_STATUS.PENDENTE,
  // cotação pré-execução do fluxo de gargalos = ainda pendente de fato
  pending_quote: OS_STATUS.PENDENTE,
  quoted: OS_STATUS.PENDENTE,
  quoted_unconfirmed: OS_STATUS.PENDENTE,
  'em andamento': OS_STATUS.EM_ANDAMENTO,
  em_andamento: OS_STATUS.EM_ANDAMENTO,
  'em processamento': OS_STATUS.EM_ANDAMENTO,
  processando: OS_STATUS.EM_ANDAMENTO,
  enviada: OS_STATUS.EM_ANDAMENTO,
  enviado: OS_STATUS.EM_ANDAMENTO,
  'concluído': OS_STATUS.CONCLUIDO,
  concluido: OS_STATUS.CONCLUIDO,
  finalizado: OS_STATUS.CONCLUIDO,
  received: OS_STATUS.CONCLUIDO,
  entregue: OS_STATUS.CONCLUIDO,
  cancelado: OS_STATUS.CANCELADO,
  cancelada: OS_STATUS.CANCELADO,
  cancelled: OS_STATUS.CANCELADO,
  estornado: OS_STATUS.CANCELADO,
};

/** Reduz qualquer grafia de status a um dos 4 canônicos. Default = Pendente. */
export function normalizeOsStatus(s: string | null | undefined): OsStatus {
  if (!s) return OS_STATUS.PENDENTE;
  return NORMALIZE[s.trim().toLowerCase()] ?? OS_STATUS.PENDENTE;
}

// ── Conjuntos canônicos (compat com os filtros existentes) ───────────────────
export const OS_DONE_STATUSES = ['Concluído', 'Concluido', 'concluido', 'received', 'finalizado', 'Finalizado'];
export const OS_CANCELLED_STATUSES = ['Cancelado', 'cancelled', 'cancelado', 'estornado'];
export const OS_PENDING_STATUSES = ['Pendente', 'pending_quote', 'quoted_unconfirmed', 'quoted'];

export const isOsDone = (s: string | null | undefined) => normalizeOsStatus(s) === OS_STATUS.CONCLUIDO;
export const isOsCancelled = (s: string | null | undefined) => normalizeOsStatus(s) === OS_STATUS.CANCELADO;
export const isOsActive = (s: string | null | undefined) => !isOsDone(s) && !isOsCancelled(s);

/**
 * Labels amigáveis no vocabulário do dono:
 * 'Em Andamento' → "Em Processamento", 'Concluído'/'received' → "Entregue".
 * Mantém as etapas de cotação do fluxo de gargalos com label próprio.
 */
export function osStatusLabel(s: string | null | undefined): string {
  const raw = (s ?? '').trim();
  if (raw === 'pending_quote' || raw === 'quoted_unconfirmed') return 'Aguardando prazo';
  if (raw === 'quoted') return 'Prazo confirmado';
  switch (normalizeOsStatus(s)) {
    case OS_STATUS.PENDENTE: return 'Pendente';
    case OS_STATUS.EM_ANDAMENTO: return 'Em Processamento';
    case OS_STATUS.CONCLUIDO: return 'Entregue';
    case OS_STATUS.CANCELADO: return 'Cancelada';
  }
}

/** Variante do <Badge> shadcn por status. */
export function osStatusBadgeVariant(s: string | null | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (normalizeOsStatus(s)) {
    case OS_STATUS.CONCLUIDO: return 'default';
    case OS_STATUS.EM_ANDAMENTO: return 'secondary';
    case OS_STATUS.CANCELADO: return 'destructive';
    default: return 'outline';
  }
}

/**
 * Transições válidas entre estados canônicos. Espelha as regras já aplicadas em
 * `useUpdateServiceOrder` (não rebaixa Concluído sem passar por Cancelado) e no
 * trigger `tg_apply_service_order_return` (Pendente→Em Andamento→Concluído).
 */
export const VALID_OS_TRANSITIONS: Record<OsStatus, OsStatus[]> = {
  [OS_STATUS.PENDENTE]: [OS_STATUS.EM_ANDAMENTO, OS_STATUS.CONCLUIDO, OS_STATUS.CANCELADO],
  [OS_STATUS.EM_ANDAMENTO]: [OS_STATUS.CONCLUIDO, OS_STATUS.CANCELADO],
  // Concluído pode ser estornado (vira Cancelado), mas não volta direto pra execução.
  [OS_STATUS.CONCLUIDO]: [OS_STATUS.CANCELADO],
  // Cancelado pode ser reativado voltando pra Pendente.
  [OS_STATUS.CANCELADO]: [OS_STATUS.PENDENTE],
};

/** True quando `from`→`to` (grafias cruas aceitas) é permitido. */
export function isValidOsTransition(from: string | null | undefined, to: string | null | undefined): boolean {
  const f = normalizeOsStatus(from);
  const t = normalizeOsStatus(to);
  if (f === t) return true; // idempotente
  return VALID_OS_TRANSITIONS[f].includes(t);
}

/** Estados canônicos alcançáveis a partir de `current`. */
export function getValidNextOsStatuses(current: string | null | undefined): OsStatus[] {
  return VALID_OS_TRANSITIONS[normalizeOsStatus(current)] ?? [];
}

// ── Etapas (timeline) da OS ──────────────────────────────────────────────────
// Ordem de progressão usada pra desenhar a régua de etapas na UI.
export const OS_STAGE_ORDER: OsStatus[] = [
  OS_STATUS.PENDENTE,
  OS_STATUS.EM_ANDAMENTO,
  OS_STATUS.CONCLUIDO,
];

/** Índice da etapa atual (0-based) na régua; -1 se Cancelado. */
export function osStageIndex(s: string | null | undefined): number {
  const c = normalizeOsStatus(s);
  if (c === OS_STATUS.CANCELADO) return -1;
  return OS_STAGE_ORDER.indexOf(c);
}

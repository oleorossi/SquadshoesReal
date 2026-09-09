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
  recebida: OS_STATUS.CONCLUIDO,
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
export const OS_DONE_STATUSES = ['Concluído', 'Concluido', 'concluido', 'received', 'finalizado', 'Finalizado', 'Recebida', 'recebida'];
export const OS_CANCELLED_STATUSES = ['Cancelado', 'cancelled', 'cancelado', 'estornado'];
export const OS_PENDING_STATUSES = ['Pendente', 'pending_quote', 'quoted_unconfirmed', 'quoted'];

export const isOsDone = (s: string | null | undefined) => normalizeOsStatus(s) === OS_STATUS.CONCLUIDO;
export const isOsCancelled = (s: string | null | undefined) => normalizeOsStatus(s) === OS_STATUS.CANCELADO;
export const isOsActive = (s: string | null | undefined) => !isOsDone(s) && !isOsCancelled(s);

/**
 * Labels no vocabulário do ciclo de OS (Pendente → Enviada → Recebida):
 * 'Em Andamento' (material despachado ao prestador) → "Enviada";
 * 'Concluído'/'received'/'Recebida' (pares bons de volta) → "Recebida".
 * Mantém as etapas de cotação do fluxo de gargalos com label próprio.
 */
export function osStatusLabel(s: string | null | undefined): string {
  const raw = (s ?? '').trim();
  if (raw === 'pending_quote' || raw === 'quoted_unconfirmed') return 'Aguardando prazo';
  if (raw === 'quoted') return 'Prazo confirmado';
  switch (normalizeOsStatus(s)) {
    case OS_STATUS.PENDENTE: return 'Pendente';
    case OS_STATUS.EM_ANDAMENTO: return 'Enviada';
    case OS_STATUS.CONCLUIDO: return 'Recebida';
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
 * Transições válidas entre estados canônicos. Os estados finais preservam a
 * trilha física: reativação legítima de uma OS integrada cancelada é uma
 * operação privada do writer de origem, não uma transição genérica da UI.
 */
export const VALID_OS_TRANSITIONS: Record<OsStatus, OsStatus[]> = {
  [OS_STATUS.PENDENTE]: [OS_STATUS.EM_ANDAMENTO, OS_STATUS.CONCLUIDO, OS_STATUS.CANCELADO],
  [OS_STATUS.EM_ANDAMENTO]: [OS_STATUS.CONCLUIDO, OS_STATUS.CANCELADO],
  [OS_STATUS.CONCLUIDO]: [],
  [OS_STATUS.CANCELADO]: [],
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

/**
 * Cor semântica por status, no padrão que o PV já usa (SaleOrders.tsx).
 *
 * As variantes do <Badge> shadcn (`osStatusBadgeVariant`) só distinguem
 * default/secondary/outline — na prática "Pendente" (outline) e "Enviada"
 * (secondary) saíam quase idênticos na lista, e o estado da OS virava ruído
 * visual em vez de informação. Aqui cada estado tem cor + ponto próprios.
 *
 * Cores semânticas (verde/âmbar/vermelho) são permitidas pelo CLAUDE.md; o que
 * não pode é cinza hardcoded no lugar de token.
 */
export function osStatusColor(s: string | null | undefined): string {
  switch (normalizeOsStatus(s)) {
    case OS_STATUS.CONCLUIDO:
      return 'bg-green-500/15 text-green-700 border-green-500/30 dark:text-green-300';
    case OS_STATUS.EM_ANDAMENTO:
      return 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300';
    case OS_STATUS.CANCELADO:
      return 'bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300';
    default: // Pendente — neutro de propósito: ainda não saiu da fábrica
      return 'bg-muted text-muted-foreground border-border';
  }
}

/** Ponto de cor pareado com osStatusColor, pra leitura a distância. */
export function osStatusDot(s: string | null | undefined): string {
  switch (normalizeOsStatus(s)) {
    case OS_STATUS.CONCLUIDO: return 'bg-green-500';
    case OS_STATUS.EM_ANDAMENTO: return 'bg-amber-500';
    case OS_STATUS.CANCELADO: return 'bg-red-500';
    default: return 'bg-muted-foreground/50';
  }
}

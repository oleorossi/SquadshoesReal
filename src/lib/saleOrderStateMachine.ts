/**
 * Sale Order Status State Machine
 *
 * Defines valid statuses and allowed transitions to prevent data corruption
 * (e.g. reverting a Faturado order back to Rascunho after invoicing).
 */

export const SALE_ORDER_STATUS = {
  RASCUNHO: 'Rascunho',
  PENDENTE: 'Pendente',
  APROVADO: 'Aprovado',
  EM_PRODUCAO: 'Em Produção',
  FATURADO: 'Faturado',
  EXPEDIDO: 'Expedido',
  CONCLUIDO: 'Concluído',
  FINALIZADO_SEM_NF: 'Finalizado s/ NF',
  CANCELADO: 'Cancelado',
} as const;

export type SaleOrderStatus = (typeof SALE_ORDER_STATUS)[keyof typeof SALE_ORDER_STATUS];

/**
 * Maps each status to the set of statuses it may transition into.
 * Terminal statuses (Concluído, Cancelado) have an empty array.
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  [SALE_ORDER_STATUS.RASCUNHO]: [
    SALE_ORDER_STATUS.PENDENTE,
    SALE_ORDER_STATUS.APROVADO,
    SALE_ORDER_STATUS.EM_PRODUCAO, // shortcut: PV criado já vai pra produção
    SALE_ORDER_STATUS.CANCELADO,
  ],
  [SALE_ORDER_STATUS.PENDENTE]: [
    SALE_ORDER_STATUS.APROVADO,
    SALE_ORDER_STATUS.EM_PRODUCAO,
    SALE_ORDER_STATUS.CANCELADO,
    SALE_ORDER_STATUS.RASCUNHO,
  ],
  [SALE_ORDER_STATUS.APROVADO]: [
    SALE_ORDER_STATUS.EM_PRODUCAO,
    SALE_ORDER_STATUS.CANCELADO,
    SALE_ORDER_STATUS.RASCUNHO, // undo approval
  ],
  [SALE_ORDER_STATUS.EM_PRODUCAO]: [
    SALE_ORDER_STATUS.FATURADO,
    SALE_ORDER_STATUS.FINALIZADO_SEM_NF, // pedidos informais (nfe_required=false)
    SALE_ORDER_STATUS.CANCELADO,
  ],
  [SALE_ORDER_STATUS.FATURADO]: [SALE_ORDER_STATUS.EXPEDIDO, SALE_ORDER_STATUS.CANCELADO],
  [SALE_ORDER_STATUS.EXPEDIDO]: [SALE_ORDER_STATUS.CONCLUIDO],
  [SALE_ORDER_STATUS.CONCLUIDO]: [], // terminal
  [SALE_ORDER_STATUS.FINALIZADO_SEM_NF]: [], // terminal (pedido informal concluído)
  // Cancelado deixou de ser terminal: permite reativar voltando pra Rascunho.
  // De Rascunho o user reaprova pelo fluxo normal — daí materiais voltam a ser
  // reservados e OPs são recriadas. Não permitimos pular direto pra Em Produção
  // ou Aprovado porque a OP original foi cancelada e o estoque restaurado;
  // precisa passar pelo fluxo de aprovação pra reconstruir essas amarrações.
  [SALE_ORDER_STATUS.CANCELADO]: [SALE_ORDER_STATUS.RASCUNHO],
};

/**
 * Returns true when transitioning from `from` to `to` is permitted
 * by the business rules defined in VALID_TRANSITIONS.
 */
export function isValidStatusTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false; // unknown source status — deny
  return allowed.includes(to);
}

/**
 * Returns the list of statuses that are reachable from `current`.
 * Returns an empty array for terminal statuses or unknown values.
 */
export function getValidNextStatuses(current: string): string[] {
  return VALID_TRANSITIONS[current] ?? [];
}

/** PV que já saiu do fluxo de demanda de material (faturado, expedido, concluído). */
export const CLOSED_SALE_ORDER_STATUSES: readonly string[] = [
  SALE_ORDER_STATUS.FATURADO,
  SALE_ORDER_STATUS.EXPEDIDO,
  SALE_ORDER_STATUS.CONCLUIDO,
  SALE_ORDER_STATUS.FINALIZADO_SEM_NF,
  SALE_ORDER_STATUS.CANCELADO,
];

export function isClosedSaleOrder(status: unknown): boolean {
  return CLOSED_SALE_ORDER_STATUSES.includes(String(status ?? '').trim());
}

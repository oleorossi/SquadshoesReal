/**
 * Status de OP — classificação canônica, em UM lugar só.
 *
 * Existia uma lista dessas privada em `useSectorDailyLoad.ts` (espelhando a view
 * `v_sector_weekly_load`), e cada tela que precisava do mesmo conceito escrevia
 * a sua. O Sistema de Etiquetas escreveu a dele errado: filtrava só
 * `status !== 'Finalizado'`, então **OP CANCELADA continuava aparecendo em "Em
 * Produção", contando pares e gerando etiqueta**. Foi o que manteve a
 * quantidade dobrada na tela mesmo depois de as OPs duplicadas do PV-00146
 * terem sido canceladas no banco.
 *
 * Grafias variadas são de propósito: o banco tem 'Cancelada' e 'Cancelado'
 * (feminino da OP, masculino do PV) e o histórico tem minúsculas.
 */

/** OP que não existe mais pra efeito de trabalho: cancelada ou rascunho. */
export const CANCELLED_OR_DRAFT_STATUSES = [
  'Cancelada', 'Cancelado', 'cancelada', 'cancelado',
  'Rascunho', 'rascunho',
] as const;

/** OP que já cumpriu seu ciclo. */
export const FINISHED_ORDER_STATUSES = [
  'Finalizado', 'Concluído', 'finalizado', 'concluido', 'concluído',
] as const;

/** União — espelha a lista de status excluídos da view `v_sector_weekly_load`. */
export const EXCLUDED_ORDER_STATUSES: readonly string[] = [
  ...FINISHED_ORDER_STATUSES,
  ...CANCELLED_OR_DRAFT_STATUSES,
];

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

const CANCELLED_SET = new Set(CANCELLED_OR_DRAFT_STATUSES.map(norm));
const FINISHED_SET = new Set(FINISHED_ORDER_STATUSES.map(norm));
const EXCLUDED_SET = new Set(EXCLUDED_ORDER_STATUSES.map(norm));

/** Cancelada ou rascunho — NUNCA deve aparecer em lista de trabalho, contagem
 *  de pares ou impressão de etiqueta. */
export const isCancelledOrDraftOrder = (status: unknown): boolean =>
  CANCELLED_SET.has(norm(status));

/** Já concluída — sai das listas ativas, mas segue visível no histórico. */
export const isFinishedOrder = (status: unknown): boolean =>
  FINISHED_SET.has(norm(status));

/** Fora da carga ativa (concluída OU cancelada/rascunho). */
export const isInactiveOrder = (status: unknown): boolean =>
  EXCLUDED_SET.has(norm(status));

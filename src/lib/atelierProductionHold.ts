/**
 * Portão de status: cabedal complexo no Ateliê.
 *
 * A aprovação (Aprovado) continua. Em Produção só entra quando
 * `atelier_item_block_reason` é NULL — prestador em `received_at_factory`,
 * interno em `done`. A OP desse item nasce nesse promote, não no clique
 * de retorno. A fonte da verdade é o gatilho
 * `trg_zz_block_em_producao_sem_retorno_atelie` (mig 20270101047200).
 */

import { humanizeAtelierBlockReason, humanizeAtelierPendingJobs } from '@/lib/atelierBoard';

export const ATELIER_PRODUCTION_HOLD_TITLE =
  'Não é possível colocar o pedido em Em Produção: o cabedal complexo ainda não voltou para a fábrica.';

export interface AtelierProductionHoldLine {
  saleOrderId: string;
  itemId: string;
  referenceCode: string;
  color: string;
  pendingJobs: string;
  reason: string;
}

/** Status em que o selo faz sentido: a próxima porta de fábrica ainda pode ser Em Produção. */
export function saleOrderShowsAtelierProductionHold(status: string | null | undefined): boolean {
  return status === 'Rascunho' || status === 'Pendente' || status === 'Aprovado';
}

/**
 * Espelho da condição do gatilho. `pending` = existe deferral de Ateliê
 * (`factory_gate_is_atelier_pipeline_deferral`). Destino diferente de
 * Em Produção — inclusive Aprovado — não bloqueia.
 */
export function atelierProductionHoldBlocksStatus(
  targetStatus: string,
  pending: boolean,
): boolean {
  return targetStatus === 'Em Produção' && pending;
}

/** Mesma linha que `sale_order_atelier_production_block_message` agrega, em português e sem UUID. */
export function formatAtelierProductionHoldLine(
  line: Pick<AtelierProductionHoldLine, 'referenceCode' | 'color' | 'reason' | 'pendingJobs'>,
): string {
  const jobs = humanizeAtelierPendingJobs(line.pendingJobs);
  const jobsSuffix = jobs ? ` Jobs pendentes: ${jobs}.` : '';
  return `${line.referenceCode} / ${line.color} — ${humanizeAtelierBlockReason(line.reason)}${jobsSuffix}`;
}

export function formatAtelierProductionHoldMessage(lines: AtelierProductionHoldLine[]): string | null {
  if (lines.length === 0) return null;
  return [
    ATELIER_PRODUCTION_HOLD_TITLE,
    ...lines.map(formatAtelierProductionHoldLine),
  ].join('\n');
}

/**
 * Ateliê — cabedal complexo (rua).
 * Setores e labels alinhados ao motor cabedal_prep / jobs.
 */

export type AtelierSector = 'corte_cabedal' | 'costura_cabedal' | 'aviamento';

/** Cadastro ainda lista Corte (marcação); fila/rua só Costura + Aviamento. */
export const ATELIER_SECTORS: AtelierSector[] = [
  'corte_cabedal',
  'costura_cabedal',
  'aviamento',
];

/** Setores que geram job de rua / agenda Ateliê. */
export const ATELIER_STREET_SECTORS: AtelierSector[] = [
  'costura_cabedal',
  'aviamento',
];

export const ATELIER_SECTOR_LABEL: Record<AtelierSector, string> = {
  corte_cabedal: 'Corte',
  costura_cabedal: 'Costura',
  aviamento: 'Aviamento',
};

export type AtelierPipelineStatus =
  | 'awaiting_cut'
  | 'awaiting_debit'
  | 'debited'
  | 'sent_to_contractor'
  | 'received_at_factory'
  | 'cancelled';

export const ATELIER_PIPELINE_LABEL: Record<AtelierPipelineStatus, string> = {
  awaiting_cut: 'Aguardando o corte',
  awaiting_debit: 'Debitar',
  debited: 'Debitado',
  sent_to_contractor: 'No prestador',
  received_at_factory: 'Recebido',
  cancelled: 'Cancelado',
};

/** Colunas da fila operacional (sem cancelled). */
export const ATELIER_QUEUE_COLUMNS: AtelierPipelineStatus[] = [
  'awaiting_cut',
  'awaiting_debit',
  'sent_to_contractor',
  'received_at_factory',
];

/** Espaço 1 da UI agrupa awaiting_debit; debitado ainda na fábrica fica no meio do fluxo de envio. */
export function atelierQueueColumn(status: AtelierPipelineStatus): AtelierPipelineStatus {
  if (status === 'debited') return 'awaiting_debit';
  if (status === 'cancelled') return 'awaiting_cut';
  return status;
}

export function atelierKanbanBadgeLabel(status: string | null | undefined): string | null {
  switch (status) {
    case 'awaiting_cut':
      return 'Ateliê · aguardando corte';
    case 'awaiting_debit':
      return 'Ateliê · debitar';
    case 'debited':
      return 'Ateliê · debitado';
    case 'sent_to_contractor':
      return 'Ateliê · no prestador';
    case 'received_at_factory':
      return 'Ateliê · recebido';
    default:
      return null;
  }
}

export function atelierBlocksKanbanPointing(status: string | null | undefined): boolean {
  return status === 'sent_to_contractor';
}

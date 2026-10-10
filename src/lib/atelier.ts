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
  | 'cut'
  | 'sent_to_contractor'
  | 'received_at_factory'
  | 'cancelled';

/** Ateliê v2: o corte é do LOTE, na fila do Ateliê, antes da OP. */
export const ATELIER_PIPELINE_LABEL: Record<AtelierPipelineStatus, string> = {
  awaiting_cut: 'Aguardando corte',
  cut: 'Cortado',
  sent_to_contractor: 'No prestador',
  received_at_factory: 'Voltou',
  cancelled: 'Cancelado',
};

/** Colunas da fila (sem cancelled), na ordem do fluxo. */
export const ATELIER_QUEUE_COLUMNS: AtelierPipelineStatus[] = [
  'awaiting_cut',
  'cut',
  'sent_to_contractor',
  'received_at_factory',
];

const PIPELINE_ORDER: Record<AtelierPipelineStatus, number> = {
  awaiting_cut: 0,
  cut: 1,
  sent_to_contractor: 2,
  received_at_factory: 3,
  cancelled: 99,
};

/** Coluna do lote = etapa do job mais atrasado (o lote só avança inteiro). */
export function atelierLotColumn(
  lotStatus: 'open' | 'cut' | 'cancelled',
  jobStatuses: AtelierPipelineStatus[],
): AtelierPipelineStatus {
  if (lotStatus === 'open') return 'awaiting_cut';
  const live = jobStatuses.filter((s) => s !== 'cancelled');
  if (live.length === 0) return 'cut';
  return live.reduce((min, s) => (PIPELINE_ORDER[s] < PIPELINE_ORDER[min] ? s : min), live[0]);
}

export function atelierKanbanBadgeLabel(status: string | null | undefined): string | null {
  switch (status) {
    case 'awaiting_cut':
      return 'Ateliê · aguardando corte';
    case 'cut':
      return 'Ateliê · cortado';
    case 'sent_to_contractor':
      return 'Ateliê · no prestador';
    case 'received_at_factory':
      return 'Ateliê · voltou';
    default:
      return null;
  }
}

export function atelierBlocksKanbanPointing(status: string | null | undefined): boolean {
  return status === 'sent_to_contractor';
}

/** Componentes que podem ir no kit do lote (nomes do motor de consumo). */
export const ATELIER_KIT_COMPONENTS = ['Cabedal', 'Forração', 'Componente Direto', 'BOM'] as const;
export type AtelierKitComponent = (typeof ATELIER_KIT_COMPONENTS)[number];

/** Espelho de `atelier_default_kit_components` (SQL). */
export function atelierDefaultKit(sector: AtelierSector): AtelierKitComponent[] {
  if (sector === 'costura_cabedal') return ['Cabedal', 'Forração'];
  if (sector === 'aviamento') return ['Componente Direto', 'BOM'];
  return [];
}

/** Etapa da rota (production_sectors) que cada setor de rua substitui. */
export const ATELIER_SECTOR_STAGE: Record<AtelierSector, string> = {
  corte_cabedal: 'Corte Cabedal',
  costura_cabedal: 'Costura Cabedal',
  aviamento: 'Aviamento',
};

export interface AtelierSheetFields {
  upper_material?: string | null;
  upper_material_group_id?: string | null;
  upper_material_product_id?: string | null;
  upper_consumption?: number | string | null;
  components_accessories?: unknown;
  upper_corte_a_fio?: boolean | null;
  has_straps?: boolean | null;
  aviamento_steps?: unknown;
}

const nonEmptyArray = (v: unknown) => Array.isArray(v) && v.length > 0;

/**
 * A ficha suporta o setor? Espelho de `atelier_sheet_supports_sector` (SQL),
 * que é quem decide de verdade (gatilho no cadastro). Aqui só serve pra tela
 * explicar ANTES do clique por que um setor está indisponível.
 */
export function atelierSheetSupport(
  sheet: AtelierSheetFields,
  sector: AtelierSector,
): { ok: boolean; reason: string | null } {
  const hasCut =
    !!String(sheet.upper_material ?? '').trim() ||
    !!sheet.upper_material_group_id ||
    !!sheet.upper_material_product_id ||
    Number(sheet.upper_consumption || 0) > 0 ||
    nonEmptyArray(sheet.components_accessories);
  const hasAviamento = !!sheet.has_straps || nonEmptyArray(sheet.aviamento_steps);

  if (sector === 'costura_cabedal') {
    if (!hasCut) {
      return { ok: false, reason: 'A ficha não tem material de cabedal. Cadastre em Materiais & Consumo.' };
    }
    if (sheet.upper_corte_a_fio) {
      return { ok: false, reason: 'O cabedal é corte a fio, então não passa por costura.' };
    }
    return { ok: true, reason: null };
  }
  if (sector === 'aviamento') {
    return hasAviamento
      ? { ok: true, reason: null }
      : { ok: false, reason: 'A ficha não tem etapas de aviamento nem tiras.' };
  }
  return hasCut
    ? { ok: true, reason: null }
    : { ok: false, reason: 'A ficha não tem material de cabedal.' };
}

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
  | 'realized'
  | 'received_at_factory'
  | 'cancelled';

/**
 * Pipeline do Ateliê:
 * - Corte: só na fábrica (aguardando corte → cortado). Sem OKs de rua.
 * - Costura/Aviamento: cortado → enviado ao prestador → realizado → recebido e conferido.
 */
export const ATELIER_PIPELINE_LABEL: Record<AtelierPipelineStatus, string> = {
  awaiting_cut: 'Aguardando corte',
  cut: 'Cortado',
  sent_to_contractor: 'Enviado ao prestador',
  realized: 'Realizado',
  received_at_factory: 'Recebido e conferido',
  cancelled: 'Cancelado',
};

/** Colunas da fila (sem cancelled), na ordem do fluxo. */
export const ATELIER_QUEUE_COLUMNS: AtelierPipelineStatus[] = [
  'awaiting_cut',
  'cut',
  'sent_to_contractor',
  'realized',
  'received_at_factory',
];

/** OKs de rua (Costura/Aviamento) — o corte da fábrica não entra aqui. */
export const ATELIER_STREET_OK_STEPS: AtelierPipelineStatus[] = [
  'sent_to_contractor',
  'realized',
  'received_at_factory',
];

const PIPELINE_ORDER: Record<AtelierPipelineStatus, number> = {
  awaiting_cut: 0,
  cut: 1,
  sent_to_contractor: 2,
  realized: 3,
  received_at_factory: 4,
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
      return 'Ateliê · enviado ao prestador';
    case 'realized':
      return 'Ateliê · realizado';
    case 'received_at_factory':
      return 'Ateliê · recebido e conferido';
    default:
      return null;
  }
}

/** Enquanto está no prestador (enviado ou já realizado, ainda sem conferência). */
export function atelierBlocksKanbanPointing(status: string | null | undefined): boolean {
  return status === 'sent_to_contractor' || status === 'realized';
}

/** Próximo OK de rua a partir do status atual do job (Costura/Aviamento). */
export function atelierNextStreetOk(
  status: AtelierPipelineStatus | string | null | undefined,
): AtelierPipelineStatus | null {
  if (status === 'cut') return 'sent_to_contractor';
  if (status === 'sent_to_contractor') return 'realized';
  if (status === 'realized') return 'received_at_factory';
  return null;
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

/* ────────────────────────────────────────────────────────────────────────────
 * Apresentação da fila e do relatório (dono, 12/10/2026)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Forma mínima de um lote para agrupar/ordenar. Estrutural de propósito: o tipo
 * cheio (`AtelierLotRow`) mora no hook, e importá-lo aqui faria ciclo — o hook
 * já importa desta lib.
 */
export interface AtelierLotForGrouping {
  reference_id: string;
  reference_code: string | null;
  reference_name: string | null;
  color: string | null;
  pairs: number;
  min_delivery_deadline: string | null;
}

export interface AtelierReferenceGroup<T> {
  key: string;
  label: string;
  pairs: number;
  /** Prazo de entrega mais próximo entre os lotes do grupo; null = sem prazo. */
  earliestDeadline: string | null;
  lots: T[];
}

/** Prazo mais próximo primeiro, SEM prazo por último. */
function deadlineAsc(a: string | null | undefined, b: string | null | undefined): number {
  const da = a || '';
  const db = b || '';
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da.localeCompare(db);
}

/**
 * Lotes agrupados por REFERÊNCIA, cada grupo posicionado pelo prazo de entrega
 * mais próximo que ele carrega, e os lotes de dentro também por prazo (depois
 * por cor).
 *
 * ⚠ Não é `Pedido → Referência` como nos relatórios de corte, e não pode ser: o
 * lote é `referência × cor` e atravessa VÁRIOS PVs — é o ponto do Ateliê, juntar
 * o corte de pedidos diferentes numa faca só, e `atelier_confirm_lot_cut` opera
 * por lote. Aninhar o lote sob um único pedido quebraria o batch.
 */
export function groupAtelierLotsByReference<T extends AtelierLotForGrouping>(
  lots: readonly T[],
): AtelierReferenceGroup<T>[] {
  const byRef = new Map<string, AtelierReferenceGroup<T>>();

  for (const lot of lots) {
    const label = lot.reference_code ?? lot.reference_name ?? 'Sem referência';
    const key = lot.reference_id || label.toUpperCase();
    let group = byRef.get(key);
    if (!group) {
      group = { key, label, pairs: 0, earliestDeadline: null, lots: [] };
      byRef.set(key, group);
    }
    group.lots.push(lot);
    const pairs = Number(lot.pairs);
    if (Number.isFinite(pairs) && pairs > 0) group.pairs += pairs;
    if (deadlineAsc(lot.min_delivery_deadline, group.earliestDeadline) < 0) {
      group.earliestDeadline = lot.min_delivery_deadline;
    }
  }

  for (const group of byRef.values()) {
    group.lots.sort(
      (a, b) =>
        deadlineAsc(a.min_delivery_deadline, b.min_delivery_deadline)
        || (a.color ?? '').localeCompare(b.color ?? '', 'pt-BR'),
    );
  }

  return [...byRef.values()].sort(
    (a, b) =>
      deadlineAsc(a.earliestDeadline, b.earliestDeadline)
      || a.label.localeCompare(b.label, 'pt-BR', { numeric: true, sensitivity: 'base' }),
  );
}

/**
 * Linhas do relatório: uma por (PEDIDO × LOTE).
 *
 * ⚠ Os pares são os DO PEDIDO (`order.pairs`), nunca `lot.pairs`. O lote junta
 * vários PVs, então usar o total do lote em cada linha somaria os pedidos dos
 * outros — é o erro que a migration `20270101039000` existe pra permitir evitar,
 * expondo pares por pedido dentro do lote.
 */
export function atelierReportRows<
  L extends { orders: readonly { sale_order_id: string; pairs: number }[] },
>(lots: readonly L[]): { lot: L; order: L['orders'][number] }[] {
  // `L['orders'][number]` em vez de um 2º parâmetro genérico: com dois, o TS
  // infere o tipo do PEDIDO pela restrição e não pelo tipo real, e o chamador
  // perde `order_number` / `client_name` / `delivery_deadline`.
  return lots.flatMap((lot) => (lot.orders ?? []).map((order) => ({ lot, order })));
}

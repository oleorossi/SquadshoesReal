import {
  countPending,
  countShort,
  rowKnown,
  rowShortfall,
} from '@/lib/consumptionAvailability';
import type { ConsumptionRow } from '@/lib/consumptionRows';
import { contractorServicePriority } from '@/lib/contractorServiceFocus';
import {
  serviceOrderActivityDefaults,
  type ServiceOrderMaterialComponent,
} from '@/lib/serviceOrderSectors';

/**
 * Fila de geração de OS para Aviamento e Costura de cabedal.
 *
 * 1. Prazo de faturamento/retorno mais próximo.
 * 2. Material em estoque — só o kit da ETAPA (não a ficha inteira).
 *    Aviamento = BOM + Componente Direto.
 *    Costura de cabedal = Cabedal + BOM + Componente Direto.
 *    Forração, solado, palmilha, embalagem e tira artesanal não entram.
 *
 * Sem linhas de consumo anotadas, a fila usa só o prazo (não inventa falta).
 */

export type StageKitStatus = 'ready' | 'short' | 'unknown' | 'empty';

export type QueuePullFilter = 'prazo' | 'estoque' | 'ambos' | 'prazo_falta' | 'cadastro';

export const QUEUE_PULL_CHIP_META: Record<
  QueuePullFilter,
  { label: string; hint: string; className: string }
> = {
  prazo: {
    label: 'Prazo',
    hint: 'Fila puxada pelo faturamento mais próximo',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300',
  },
  estoque: {
    label: 'Estoque',
    hint: 'Kit da etapa coberto pelo estoque',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  },
  ambos: {
    label: 'Prazo + estoque',
    hint: 'Prazo próximo e kit da etapa em estoque',
    className: 'border-teal-500/30 bg-teal-500/10 text-teal-800 dark:text-teal-300',
  },
  prazo_falta: {
    label: 'Prazo · kit falta',
    hint: 'Prazo puxou; falta material do kit desta etapa',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  },
  cadastro: {
    label: 'Kit sem cadastro',
    hint: 'Estoque da etapa não é comparável — cadastro incompleto',
    className: 'border-border bg-muted/40 text-muted-foreground',
  },
};

const STAGE_KIT_RANK: Record<StageKitStatus, number> = {
  ready: 0,
  unknown: 1,
  empty: 2,
  short: 3,
};

export function stageKitComponents(
  sector: string | null | undefined,
): ServiceOrderMaterialComponent[] {
  return [...serviceOrderActivityDefaults(sector).material_components];
}

export function normalizeKitComponentType(componentType: string | null | undefined): string {
  const raw = (componentType || '').trim();
  if (!raw) return raw;
  if (raw === 'BOM' || raw === 'Componente Direto' || raw === 'Item padrão (solado)') return raw;
  const normalized = raw.toLowerCase();
  if (normalized === 'outros' || normalized.includes('fivela') || normalized.includes('ilhos') || normalized.includes('ilhós') || normalized.includes('aviamento')) {
    return 'BOM';
  }
  if (normalized.includes('componente direto')) return 'Componente Direto';
  return raw;
}

export function isStageKitComponent(
  sector: string | null | undefined,
  componentType: string | null | undefined,
): boolean {
  if (!componentType) return false;
  const normalized = normalizeKitComponentType(componentType);
  return stageKitComponents(sector).includes(normalized as ServiceOrderMaterialComponent);
}

/** Corta a ficha no kit da atividade. Solado e forração nunca entram em Costura de cabedal. */
export function filterRowsToStageKit(
  rows: readonly ConsumptionRow[],
  sector: string | null | undefined,
): ConsumptionRow[] {
  const allowed = new Set<string>(stageKitComponents(sector));
  return rows.filter((row) => allowed.has(normalizeKitComponentType(row.componentType)));
}

export interface StageKitAssessment {
  status: StageKitStatus;
  components: ServiceOrderMaterialComponent[];
  shortCount: number;
  pendingCount: number;
  shortfall: number;
}

export function assessStageKitStock(
  rows: readonly ConsumptionRow[],
  sector: string | null | undefined,
): StageKitAssessment {
  const components = stageKitComponents(sector);
  const kit = filterRowsToStageKit(rows, sector);
  if (kit.length === 0) {
    return { status: 'empty', components, shortCount: 0, pendingCount: 0, shortfall: 0 };
  }

  const shortCount = countShort(kit);
  const pendingCount = countPending(kit);
  const comparable = kit.filter(rowKnown);
  const shortfall = kit.reduce((sum, row) => sum + rowShortfall(row), 0);

  if (comparable.length === 0) {
    return { status: 'unknown', components, shortCount: 0, pendingCount, shortfall: 0 };
  }
  if (shortCount > 0) {
    return { status: 'short', components, shortCount, pendingCount, shortfall };
  }
  if (comparable.length < kit.length) {
    return { status: 'unknown', components, shortCount: 0, pendingCount, shortfall: 0 };
  }
  return { status: 'ready', components, shortCount: 0, pendingCount, shortfall: 0 };
}

export function queuePullFilter(
  billingDate: string | null | undefined,
  kit: StageKitStatus,
  kitProvided = true,
): QueuePullFilter {
  const hasDeadline = Boolean(billingDate && String(billingDate).trim());
  if (!kitProvided) return 'prazo';
  if (kit === 'unknown' || kit === 'empty') return 'cadastro';
  if (kit === 'ready' && hasDeadline) return 'ambos';
  if (kit === 'ready') return 'estoque';
  if (hasDeadline) return 'prazo_falta';
  return 'prazo';
}

export interface StageQueueCandidate<T = unknown> {
  id: string;
  sector: string;
  sectorLabel?: string | null;
  billingDate?: string | null;
  kitRows?: readonly ConsumptionRow[];
  kitStatus?: StageKitStatus;
  source: T;
}

export interface RankedStageQueueItem<T = unknown> {
  id: string;
  sector: string;
  billingDate: string | null;
  kit: StageKitAssessment;
  kitProvided: boolean;
  pull: QueuePullFilter;
  source: T;
}

function billingSortValue(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function emptyAssessment(sector: string): StageKitAssessment {
  return {
    status: 'empty',
    components: stageKitComponents(sector),
    shortCount: 0,
    pendingCount: 0,
    shortfall: 0,
  };
}

export function rankServiceOrderCandidates<T>(
  candidates: readonly StageQueueCandidate<T>[],
): RankedStageQueueItem<T>[] {
  return candidates
    .map((candidate) => {
      const kitProvided = candidate.kitStatus != null || candidate.kitRows != null;
      const kit = candidate.kitStatus
        ? {
            status: candidate.kitStatus,
            components: stageKitComponents(candidate.sector),
            shortCount: candidate.kitStatus === 'short' ? 1 : 0,
            pendingCount: candidate.kitStatus === 'unknown' ? 1 : 0,
            shortfall: 0,
          }
        : candidate.kitRows
          ? assessStageKitStock(candidate.kitRows, candidate.sector)
          : emptyAssessment(candidate.sector);
      return {
        id: candidate.id,
        sector: candidate.sector,
        billingDate: candidate.billingDate || null,
        kit,
        kitProvided,
        pull: queuePullFilter(candidate.billingDate, kit.status, kitProvided),
        source: candidate.source,
      };
    })
    .sort((a, b) => {
      const dateDiff = billingSortValue(a.billingDate) - billingSortValue(b.billingDate);
      if (dateDiff !== 0) return dateDiff;
      const kitDiff = STAGE_KIT_RANK[a.kit.status] - STAGE_KIT_RANK[b.kit.status];
      if (kitDiff !== 0) return kitDiff;
      const sectorDiff = contractorServicePriority(a.sector) - contractorServicePriority(b.sector);
      if (sectorDiff !== 0) return sectorDiff;
      return a.id.localeCompare(b.id, 'pt-BR', { numeric: true, sensitivity: 'base' });
    });
}

export interface StageQueueReport {
  total: number;
  ready: number;
  short: number;
  unknown: number;
  byPull: Record<QueuePullFilter, number>;
}

export function summarizeStageQueue(
  ranked: readonly RankedStageQueueItem[],
): StageQueueReport {
  const byPull: Record<QueuePullFilter, number> = {
    prazo: 0,
    estoque: 0,
    ambos: 0,
    prazo_falta: 0,
    cadastro: 0,
  };
  let ready = 0;
  let short = 0;
  let unknown = 0;
  for (const item of ranked) {
    byPull[item.pull] += 1;
    if (item.kit.status === 'ready') ready += 1;
    else if (item.kit.status === 'short') short += 1;
    else unknown += 1;
  }
  return { total: ranked.length, ready, short, unknown, byPull };
}

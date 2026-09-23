/**
 * Motor de preparação de cabedal — cálculos puros (sem I/O).
 *
 * Meta: cabedal pronto de manhã no dia D (início da billing_week).
 * Dias de montagem = ceil(pares / assembly_capacity_per_day da ficha).
 * Antecedência = dias_montagem + 1 (ex.: 1200÷600 → 2+1=3; 1200÷400 → 3+1=4).
 */

import { monthWeekToISODate } from '@/lib/billingWeek';

export type CabedalPrepSector = 'corte_cabedal' | 'costura_cabedal' | 'aviamento';

export const CABEDAL_PREP_SECTORS: CabedalPrepSector[] = [
  'corte_cabedal',
  'costura_cabedal',
  'aviamento',
];

export const CABEDAL_PREP_SECTOR_LABEL: Record<CabedalPrepSector, string> = {
  corte_cabedal: 'Corte Cabedal',
  costura_cabedal: 'Costura Cabedal',
  aviamento: 'Aviamento',
};

/** Purchase order source_type for OCs born from this menu. */
export const CABEDAL_PREP_PO_SOURCE = 'cabedal_prep' as const;

const MONTH_WEEK_TOKEN_RE = /^(\d{4}-\d{2})-(S\d{1,2})$/i;

/** Segunda-feira (ou dia 1) do início da billing_week "YYYY-MM-S#". */
export function billingWeekStartDate(billingWeek: string | null | undefined): string | null {
  const raw = String(billingWeek ?? '').trim();
  if (!raw) return null;
  const m = raw.match(MONTH_WEEK_TOKEN_RE);
  if (!m) return null;
  return monthWeekToISODate(m[1], m[2].toUpperCase());
}

export function assemblyDaysNeeded(pairs: number, assemblyCapacityPerDay: number): number {
  const qty = Number(pairs);
  const cap = Number(assemblyCapacityPerDay);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  return Math.max(1, Math.ceil(qty / cap));
}

/**
 * Dias de antecedência do cabedal em relação ao dia D de faturamento.
 * = dias de montagem + 1 (pronto de manhã no D).
 */
export function cabedalLeadDaysBeforeBilling(
  pairs: number,
  assemblyCapacityPerDay: number,
): number {
  const assemblyDays = assemblyDaysNeeded(pairs, assemblyCapacityPerDay);
  if (assemblyDays <= 0) return 0;
  return assemblyDays + 1;
}

function addCalendarDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Data em que o cabedal precisa estar pronto (manhã do dia D − lead). */
export function cabedalReadyDate(params: {
  billingWeek: string | null | undefined;
  pairs: number;
  assemblyCapacityPerDay: number;
}): string | null {
  const dayD = billingWeekStartDate(params.billingWeek);
  if (!dayD) return null;
  const lead = cabedalLeadDaysBeforeBilling(params.pairs, params.assemblyCapacityPerDay);
  if (lead <= 0) return null;
  return addCalendarDays(dayD, -lead);
}

export interface PrepAllocationInput {
  contractorId: string;
  sector: CabedalPrepSector;
  pairs: number;
  pairsPerDay: number;
  leaveDate: string; // YYYY-MM-DD
  /** Pacote: mesmo prestador faz mais de um setor (linhas separadas). */
  packageGroupId?: string | null;
}

export interface PrepSectorSchedule {
  sector: CabedalPrepSector;
  startDate: string;
  endDate: string;
  workDays: number;
}

/**
 * Dias úteis necessários = ceil(pares / pares_por_dia).
 * endDate = leaveDate + workDays - 1 (calendário; v1 não pula fim de semana).
 */
export function scheduleAllocation(alloc: PrepAllocationInput): PrepSectorSchedule | null {
  const pairs = Number(alloc.pairs);
  const rate = Number(alloc.pairsPerDay);
  if (!Number.isFinite(pairs) || pairs <= 0) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(alloc.leaveDate)) return null;
  const workDays = Math.max(1, Math.ceil(pairs / rate));
  return {
    sector: alloc.sector,
    startDate: alloc.leaveDate,
    endDate: addCalendarDays(alloc.leaveDate, workDays - 1),
    workDays,
  };
}

export interface DistributionValidation {
  ok: boolean;
  allocatedPairs: number;
  pendingPairs: number;
  latestEndDate: string | null;
  fitsReadyDate: boolean | null;
  errors: string[];
}

/**
 * Valida distribuição manual (Q12-B): usuário informa pares + taxa + data deixar;
 * sistema confere se a soma fecha e se a última etapa termina até a meta.
 */
export function validateDistribution(params: {
  demandPairs: number;
  allocations: PrepAllocationInput[];
  readyDate: string | null;
  /** Folga em dias após fim do corte antes de iniciar costura (informativo na cadeia). */
  gapAfterCutDays?: number;
}): DistributionValidation {
  const errors: string[] = [];
  const demand = Number(params.demandPairs);
  if (!Number.isFinite(demand) || demand <= 0) {
    return {
      ok: false,
      allocatedPairs: 0,
      pendingPairs: 0,
      latestEndDate: null,
      fitsReadyDate: null,
      errors: ['Demanda de pares inválida'],
    };
  }

  let allocated = 0;
  let latest: string | null = null;
  for (const row of params.allocations) {
    if (!row.contractorId) {
      errors.push('Prestador obrigatório em toda linha');
      continue;
    }
    const sched = scheduleAllocation(row);
    if (!sched) {
      errors.push(`Linha ${CABEDAL_PREP_SECTOR_LABEL[row.sector]}: pares/dia ou data inválidos`);
      continue;
    }
    allocated += Number(row.pairs) || 0;
    if (!latest || sched.endDate > latest) latest = sched.endDate;
  }

  const pending = Math.max(0, demand - allocated);
  if (allocated > demand + 1e-9) {
    errors.push(`Alocado (${allocated}) excede a demanda (${demand})`);
  }

  let fitsReadyDate: boolean | null = null;
  if (params.readyDate && latest) {
    fitsReadyDate = latest <= params.readyDate;
    if (!fitsReadyDate) {
      errors.push(
        `Última etapa termina em ${latest}, depois da meta ${params.readyDate}`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    allocatedPairs: allocated,
    pendingPairs: pending,
    latestEndDate: latest,
    fitsReadyDate,
    errors,
  };
}

export function compareIsoDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

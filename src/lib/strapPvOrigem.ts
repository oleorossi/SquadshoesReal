import {
  normalizeStrapOrigemPadrao,
} from '@/lib/strapBaseNapaPeel';
import type { StrapPvOrigem } from '@/lib/technicalStrapLines';

export type EffectiveStrapPvOrigem = StrapPvOrigem;

/**
 * Padrão do seletor quando Hub = escolhe_no_pv e o operador ainda não escolheu.
 * "Comprar pronto" (= prestador + OS + remessa de napa) — specs/origem-tira-pv-hub-os.md.
 */
export const DEFAULT_STRAP_PV_ORIGEM: StrapPvOrigem = 'prestador';

export interface StrapPvOrigemLineLike {
  label?: string | null;
  measure_id?: string | null;
  pv_origem?: StrapPvOrigem | string | null;
}

export interface StrapPvOrigemMeasureLike {
  id: string;
  origem_padrao?: string | null;
  preco_artesanal_per_m?: number | null;
  preco_prestador_per_m?: number | null;
}

/** Origem efetiva da linha: Hub fixo ganha; em escolhe_no_pv usa o snapshot do PV. */
export function resolveEffectiveStrapPvOrigem(
  line: StrapPvOrigemLineLike | null | undefined,
  measure: StrapPvOrigemMeasureLike | null | undefined,
): EffectiveStrapPvOrigem | null {
  const padrao = normalizeStrapOrigemPadrao(measure?.origem_padrao);
  if (padrao === 'sempre_fabrica') return 'fabrica';
  if (padrao === 'sempre_sku_acabado') return 'sku_acabado';
  const choice = line?.pv_origem;
  if (isExplicitStrapPvOrigem(choice)) return choice;
  return null;
}

export interface MissingStrapPvOrigemIssue {
  label: string;
  measureId: string | null;
  code: 'origem_nao_escolhida';
  message: string;
}

function measureRequiresPvOrigemChoice(
  measure: StrapPvOrigemMeasureLike | null | undefined,
): boolean {
  if (measure?.origem_padrao == null || measure.origem_padrao === '') return false;
  return normalizeStrapOrigemPadrao(measure.origem_padrao) === 'escolhe_no_pv';
}

export function isExplicitStrapPvOrigem(
  value: unknown,
): value is StrapPvOrigem {
  return value === 'fabrica' || value === 'prestador' || value === 'sku_acabado';
}

function hasExplicitStrapPvOrigem(
  line: StrapPvOrigemLineLike | null | undefined,
): line is StrapPvOrigemLineLike & { pv_origem: StrapPvOrigem } {
  return isExplicitStrapPvOrigem(line?.pv_origem);
}

/** Posições escolhe_no_pv sem pv_origem — bloqueiam save no desktop (spec).
 *  Se a medida ainda não traz `origem_padrao` (migration não aplicada / catálogo
 *  antigo), não bloqueia — senão o PV inteiro trava sem o Hub estar pronto. */
export function listMissingStrapPvOrigemChoices(
  lines: readonly StrapPvOrigemLineLike[] | null | undefined,
  measures: readonly StrapPvOrigemMeasureLike[] | null | undefined,
): MissingStrapPvOrigemIssue[] {
  const byId = new Map((measures || []).map((measure) => [measure.id, measure]));
  const issues: MissingStrapPvOrigemIssue[] = [];
  for (const [index, line] of (lines || []).entries()) {
    const measure = line.measure_id ? byId.get(line.measure_id) : undefined;
    if (!measureRequiresPvOrigemChoice(measure)) continue;
    if (hasExplicitStrapPvOrigem(line)) continue;
    const label = (line.label || `Tira ${index + 1}`).trim() || `Tira ${index + 1}`;
    issues.push({
      label,
      measureId: line.measure_id || null,
      code: 'origem_nao_escolhida',
      message: `${label}: escolha Fábrica, Prestador ou Fornecedor antes de salvar.`,
    });
  }
  return issues;
}

/**
 * Preenche `pv_origem` ausente com o padrão (prestador / comprar pronto) só nas
 * posições `escolhe_no_pv`. Não sobrescreve escolha explícita do operador.
 */
export function applyDefaultStrapPvOrigemChoices<T extends StrapPvOrigemLineLike>(
  lines: readonly T[] | null | undefined,
  measures: readonly StrapPvOrigemMeasureLike[] | null | undefined,
): { lines: T[]; changed: boolean } {
  const source = lines || [];
  const byId = new Map((measures || []).map((measure) => [measure.id, measure]));
  let changed = false;
  const next = source.map((line) => {
    const measure = line.measure_id ? byId.get(line.measure_id) : undefined;
    if (!measureRequiresPvOrigemChoice(measure)) return line;
    if (hasExplicitStrapPvOrigem(line)) return line;
    changed = true;
    return { ...line, pv_origem: DEFAULT_STRAP_PV_ORIGEM };
  });
  return { lines: changed ? next : [...source], changed };
}

export interface StrapHubIncompleteIssue {
  label: string;
  measureId: string | null;
  code: 'preco_prestador_ausente' | 'preco_artesanal_ausente';
  message: string;
}

/** Medida com um ou mais preços faltando — uma linha no diálogo do PV. */
export interface StrapHubIncompleteMeasureGap {
  measureId: string;
  labels: string[];
  needsArtesanal: boolean;
  needsPrestador: boolean;
}

/**
 * Gaps de Hub para a origem efetiva. Frete/prestador padrão entram na fatia
 * da OS automática (RPC) — aqui só preços da medida.
 *
 * ⚠ Origem fábrica NÃO exige mão de obra do prestador. Só `prestador` cobra
 * `preco_prestador_per_m`; fábrica cobra (quando o save quiser) o artesanal.
 */
export function listStrapHubIncompleteForOrigem(
  lines: readonly StrapPvOrigemLineLike[] | null | undefined,
  measures: readonly StrapPvOrigemMeasureLike[] | null | undefined,
): StrapHubIncompleteIssue[] {
  const byId = new Map((measures || []).map((measure) => [measure.id, measure]));
  const issues: StrapHubIncompleteIssue[] = [];
  for (const [index, line] of (lines || []).entries()) {
    const measure = line.measure_id ? byId.get(line.measure_id) : undefined;
    const effective = resolveEffectiveStrapPvOrigem(line, measure);
    const label = (line.label || `Tira ${index + 1}`).trim() || `Tira ${index + 1}`;
    const measureId = line.measure_id || null;
    // Fábrica / SKU acabado / sem origem: nunca emitir gap de MO do prestador.
    if (effective === 'fabrica') {
      const price = Number(measure?.preco_artesanal_per_m);
      if (!(price > 0)) {
        issues.push({
          label,
          measureId,
          code: 'preco_artesanal_ausente',
          message: `${label}: cadastre o preço artesanal (R$/m) no Hub de Tiras.`,
        });
      }
      continue;
    }
    if (effective === 'prestador') {
      const price = Number(measure?.preco_prestador_per_m);
      if (!(price > 0)) {
        issues.push({
          label,
          measureId,
          code: 'preco_prestador_ausente',
          message: `${label}: cadastre a mão de obra do prestador (R$/m) no Hub de Tiras.`,
        });
      }
    }
  }
  return issues;
}

/** Agrupa issues por medida (UUID) para o diálogo de completar no PV. */
export function groupStrapHubIncompleteByMeasure(
  issues: readonly StrapHubIncompleteIssue[],
): StrapHubIncompleteMeasureGap[] {
  const byMeasure = new Map<string, StrapHubIncompleteMeasureGap>();
  for (const issue of issues) {
    if (!issue.measureId) continue;
    const current = byMeasure.get(issue.measureId) || {
      measureId: issue.measureId,
      labels: [],
      needsArtesanal: false,
      needsPrestador: false,
    };
    if (!current.labels.includes(issue.label)) current.labels.push(issue.label);
    if (issue.code === 'preco_artesanal_ausente') current.needsArtesanal = true;
    if (issue.code === 'preco_prestador_ausente') current.needsPrestador = true;
    byMeasure.set(issue.measureId, current);
  }
  return Array.from(byMeasure.values());
}

/** Frete/m = amount / per_meters; Y deve ser > 0. */
export function strapFreightPerMeter(
  amount: number | null | undefined,
  perMeters: number | null | undefined,
): number | null {
  if (amount == null || perMeters == null) return null;
  const a = Number(amount);
  const y = Number(perMeters);
  if (!Number.isFinite(a) || a < 0 || !Number.isFinite(y) || !(y > 0)) return null;
  return a / y;
}

/** Motor canônico: sku → buy_ready; fábrica/prestador → internal (OS no prestador). */
export function sourceModeForEffectiveOrigem(
  origem: EffectiveStrapPvOrigem | null | undefined,
): 'internal' | 'buy_ready' | null {
  if (origem === 'sku_acabado') return 'buy_ready';
  if (origem === 'fabrica' || origem === 'prestador') return 'internal';
  return null;
}

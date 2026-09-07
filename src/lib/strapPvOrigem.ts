import {
  normalizeStrapOrigemPadrao,
  type StrapOrigemPadrao,
} from '@/lib/strapBaseNapaPeel';
import type { StrapPvOrigem } from '@/lib/technicalStrapLines';

export type EffectiveStrapPvOrigem = StrapPvOrigem | 'sku_acabado';

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
  if (choice === 'fabrica' || choice === 'prestador') return choice;
  return null;
}

export interface MissingStrapPvOrigemIssue {
  label: string;
  measureId: string | null;
  code: 'origem_nao_escolhida';
  message: string;
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
    if (measure?.origem_padrao == null || measure.origem_padrao === '') continue;
    const padrao = normalizeStrapOrigemPadrao(measure.origem_padrao) as StrapOrigemPadrao;
    if (padrao !== 'escolhe_no_pv') continue;
    if (line.pv_origem === 'fabrica' || line.pv_origem === 'prestador') continue;
    const label = (line.label || `Tira ${index + 1}`).trim() || `Tira ${index + 1}`;
    issues.push({
      label,
      measureId: line.measure_id || null,
      code: 'origem_nao_escolhida',
      message: `${label}: escolha Fábrica ou Prestador antes de salvar.`,
    });
  }
  return issues;
}

export interface StrapHubIncompleteIssue {
  label: string;
  code: 'preco_prestador_ausente' | 'preco_artesanal_ausente';
  message: string;
}

/**
 * Gaps de Hub para a origem efetiva. Frete/prestador padrão entram na fatia
 * da OS automática (RPC) — aqui só preços da medida.
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
    if (effective === 'fabrica') {
      const price = Number(measure?.preco_artesanal_per_m);
      if (!(price > 0)) {
        issues.push({
          label,
          code: 'preco_artesanal_ausente',
          message: `${label}: cadastre o preço artesanal (R$/m) no Hub de Tiras.`,
        });
      }
    }
    if (effective === 'prestador') {
      const price = Number(measure?.preco_prestador_per_m);
      if (!(price > 0)) {
        issues.push({
          label,
          code: 'preco_prestador_ausente',
          message: `${label}: cadastre a mão de obra do prestador (R$/m) no Hub de Tiras.`,
        });
      }
    }
  }
  return issues;
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

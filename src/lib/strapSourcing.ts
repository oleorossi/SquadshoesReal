/**
 * Escolha explícita da origem de uma linha técnica de tira do PV.
 *
 * A chave persistida é exclusivamente o `technical_strap_line_id` (UUID). Cor,
 * nome e grupo são rótulos mutáveis e não participam da identidade operacional.
 * Não existe origem herdada nem default silencioso.
 */
import { isUuid, technicalStrapLineId, type TechnicalStrapLineLike } from '@/lib/technicalStrapLines';

export type StrapSourceMode = 'internal' | 'buy_ready';

export interface StrapSourcingSelection {
  source_mode: StrapSourceMode;
  /** Identidade canônica congelada no momento da escolha. */
  color_id?: string | null;
  strap_variant_id?: string | null;
  recipe_id?: string | null;
  gross_required_m?: number | null;
  required_at?: string | null;
  main_production_start?: string | null;
  schedule_revision?: number | null;
}

/** Mapa persistido em `sale_order_items.strap_sourcing`. */
export type StrapSourcingMap = Record<string, StrapSourcingSelection>;

/** Mantido apenas para apresentação e busca, nunca para resolver identidade. */
export function normalizeStrapColorKey(color: string | null | undefined): string {
  return (color || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

export function napaDisplayName(name: string | null | undefined, color: string | null | undefined): string {
  const base = (name || '').toString().trim();
  const canonicalColor = (color || '').toString().trim();
  if (!canonicalColor) return base;
  if (!base) return canonicalColor;
  return normalizeStrapColorKey(base).includes(normalizeStrapColorKey(canonicalColor))
    ? base
    : `${base} ${canonicalColor}`;
}

export function strapSourcingKey(lineId: string | null | undefined): string | null {
  const id = (lineId || '').toString().trim();
  return technicalStrapLineId({ technical_strap_line_id: id });
}

function asSelection(value: unknown): StrapSourcingSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.source_mode !== 'internal' && candidate.source_mode !== 'buy_ready') return null;
  return { ...candidate, source_mode: candidate.source_mode } as StrapSourcingSelection;
}

export function getStrapSourcingSelection(
  map: StrapSourcingMap | null | undefined,
  lineId: string | null | undefined,
): StrapSourcingSelection | null {
  const key = strapSourcingKey(lineId);
  if (!key || !map || typeof map !== 'object') return null;
  return asSelection((map as Record<string, unknown>)[key]);
}

export function getStrapSourcingOverride(
  map: StrapSourcingMap | null | undefined,
  lineId: string | null | undefined,
): StrapSourceMode | null {
  return getStrapSourcingSelection(map, lineId)?.source_mode ?? null;
}

export function setStrapSourcing(
  map: StrapSourcingMap | null | undefined,
  lineId: string | null | undefined,
  value: StrapSourceMode | StrapSourcingSelection | null,
): StrapSourcingMap {
  const result: StrapSourcingMap = {};
  for (const [key, selection] of Object.entries(map || {})) {
    const valid = asSelection(selection);
    if (strapSourcingKey(key) && valid) result[key] = valid;
  }

  const key = strapSourcingKey(lineId);
  if (!key) return result;
  if (value === null) delete result[key];
  else if (typeof value === 'string') {
    result[key] = { ...(result[key] || {}), source_mode: value };
  } else {
    result[key] = { ...(result[key] || {}), ...value };
  }
  return result;
}

/**
 * Uma origem só é confirmável quando também congela a cor e a variante que o
 * resolvedor canônico mostrou ao usuário. Texto/grupo nunca completam identidade.
 */
export function isCompleteStrapSourcingSelection(
  selection: StrapSourcingSelection | null | undefined,
): selection is StrapSourcingSelection & { color_id: string; strap_variant_id: string } {
  return !!selection
    && (selection.source_mode === 'internal' || selection.source_mode === 'buy_ready')
    && isUuid(selection.color_id)
    && isUuid(selection.strap_variant_id);
}

/** Remove escolhas de linhas que já não existem na ficha/snapshot. */
export function pruneStrapSourcing(
  map: StrapSourcingMap | null | undefined,
  straps: TechnicalStrapLineLike[] | null | undefined,
): StrapSourcingMap {
  const alive = new Set(
    (straps || [])
      .map((line) => technicalStrapLineId(line))
      .filter((id): id is string => !!id),
  );
  const result: StrapSourcingMap = {};
  for (const [key, selection] of Object.entries(map || {})) {
    const valid = asSelection(selection);
    if (alive.has(key) && valid) result[key] = valid;
  }
  return result;
}

export function missingStrapSourcingLineIds(
  map: StrapSourcingMap | null | undefined,
  straps: TechnicalStrapLineLike[] | null | undefined,
): string[] {
  return (straps || [])
    .map((line) => technicalStrapLineId(line))
    .filter((id): id is string => !!id)
    .filter((id) => !isCompleteStrapSourcingSelection(getStrapSourcingSelection(map, id)));
}

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
  base_group_id?: string | null;
  base_group_name?: string | null;
  /** Napa oficial exata congelada para a produção interna. */
  base_product_id?: string | null;
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

/** Identidade que o preview canônico já resolveu para a linha técnica. */
export interface StrapPreviewIdentity {
  colorId?: string | null;
  strapVariantId?: string | null;
  recipeId?: string | null;
  baseGroupId?: string | null;
  baseGroupName?: string | null;
  baseProductId?: string | null;
  strapRequiredM?: number | null;
  requiredAt?: string | null;
  mainProductionStart?: string | null;
  scheduleRevision?: number | null;
}

export function strapPreviewIdentityFromLine(
  line: StrapPreviewIdentity | null | undefined,
  fallbackColorId?: string | null,
): StrapPreviewIdentity {
  return {
    colorId: line?.colorId || fallbackColorId || null,
    strapVariantId: line?.strapVariantId ?? null,
    recipeId: line?.recipeId ?? null,
    baseGroupId: line?.baseGroupId ?? null,
    baseGroupName: line?.baseGroupName ?? null,
    baseProductId: line?.baseProductId ?? null,
    strapRequiredM: line?.strapRequiredM ?? null,
    requiredAt: line?.requiredAt ?? null,
    mainProductionStart: line?.mainProductionStart ?? null,
    scheduleRevision: line?.scheduleRevision ?? null,
  };
}

/**
 * Origem interna com o UUID exato da variante resolvida. Sem cor/variante o
 * preview emite `variant_identity_not_persisted` — não grave só `source_mode`.
 */
export function internalStrapSourcingFromPreview(
  identity: StrapPreviewIdentity | null | undefined,
  fallbackColorId?: string | null,
): StrapSourcingSelection | null {
  const resolved = strapPreviewIdentityFromLine(identity, fallbackColorId);
  if (!isUuid(resolved.strapVariantId) || !isUuid(resolved.colorId)) return null;
  return {
    source_mode: 'internal',
    color_id: resolved.colorId,
    strap_variant_id: resolved.strapVariantId,
    recipe_id: resolved.recipeId ?? null,
    base_group_id: resolved.baseGroupId ?? null,
    base_group_name: resolved.baseGroupName ?? null,
    base_product_id: resolved.baseProductId ?? null,
    gross_required_m: resolved.strapRequiredM ?? null,
    required_at: resolved.requiredAt ?? null,
    main_production_start: resolved.mainProductionStart ?? null,
    schedule_revision: resolved.scheduleRevision ?? null,
  };
}

export function setInternalStrapSourcing(
  map: StrapSourcingMap | null | undefined,
  lineId: string | null | undefined,
  identity: StrapPreviewIdentity | null | undefined,
  fallbackColorId?: string | null,
): StrapSourcingMap {
  return setStrapSourcing(
    map,
    lineId,
    internalStrapSourcingFromPreview(identity, fallbackColorId) || 'internal',
  );
}

const INTERNAL_SOURCING_COMPARE_KEYS = [
  'source_mode',
  'color_id',
  'strap_variant_id',
  'recipe_id',
  'base_group_id',
  'base_group_name',
  'base_product_id',
  'gross_required_m',
  'required_at',
  'main_production_start',
  'schedule_revision',
] as const;

export function strapSourcingFieldsEqual(
  left: StrapSourcingSelection | null | undefined,
  right: StrapSourcingSelection | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return INTERNAL_SOURCING_COMPARE_KEYS.every((key) => left[key] === right[key]);
}

/**
 * Completa `source_mode: internal` que ainda não congelou cor/variante, usando
 * o UUID que o preview já devolveu. Não troca uma variante já persistida.
 */
export function hydrateInternalStrapSourcingMap(
  map: StrapSourcingMap | null | undefined,
  identityForLine: (lineId: string) => StrapPreviewIdentity | null,
): { map: StrapSourcingMap; changed: boolean } {
  let next = map || {};
  let changed = false;
  for (const [lineId, selection] of Object.entries(next)) {
    const valid = asSelection(selection);
    if (!valid || valid.source_mode !== 'internal') continue;
    const identity = identityForLine(lineId);
    const candidate = internalStrapSourcingFromPreview(identity, valid.color_id);
    if (!candidate) continue;
    if (isUuid(valid.strap_variant_id) && valid.strap_variant_id !== candidate.strap_variant_id) {
      continue;
    }
    const merged: StrapSourcingSelection = isUuid(valid.strap_variant_id)
      ? {
          ...valid,
          color_id: valid.color_id || candidate.color_id,
          recipe_id: valid.recipe_id || candidate.recipe_id,
          base_group_id: valid.base_group_id || candidate.base_group_id,
          base_group_name: valid.base_group_name || candidate.base_group_name,
          base_product_id: valid.base_product_id || candidate.base_product_id,
          gross_required_m: valid.gross_required_m ?? candidate.gross_required_m,
          required_at: valid.required_at || candidate.required_at,
          main_production_start: valid.main_production_start || candidate.main_production_start,
          schedule_revision: valid.schedule_revision ?? candidate.schedule_revision,
        }
      : candidate;
    if (strapSourcingFieldsEqual(valid, merged)) continue;
    next = setStrapSourcing(next, lineId, merged);
    changed = true;
  }
  return { map: next, changed };
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

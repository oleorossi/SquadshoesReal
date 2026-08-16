import type { MaterialConsumptionRow, ConsumptionContext } from '@/lib/orderConsumption';
import type { ArtisanalStrapCutRow, StrapRollCutResult } from '@/lib/strapRollCut';

export type CanonicalStrapSourceMode = 'internal' | 'buy_ready' | null;

/**
 * Resultado já resolvido pelo banco para uma linha de tira do PV. A UI não
 * tenta descobrir variante, napa, cor ou receita por texto: ela apenas agrega
 * snapshots que carregam os IDs canônicos.
 */
export interface CanonicalStrapDemandPreview {
  saleOrderItemId: string | null;
  technicalStrapLineId: string;
  strapVariantId: string | null;
  sourceMode: CanonicalStrapSourceMode;
  grossRequiredM: number;
  recipeId: string | null;
  baseProductId: string | null;
  finishedProductId: string | null;
  strapProductName: string;
  strapColorName: string;
  baseProductName: string | null;
  confirmedYieldMPerM: number | null;
  baseRequiredM: number | null;
  cutBandWidthMm: number | null;
  usableBaseWidthMm: number | null;
  theoreticalYieldMPerM: number | null;
  blockingReasons: string[];
}

const stringOrNull = (value: unknown): string | null =>
  value == null || value === '' ? null : String(value);

const numberOrNull = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function parseCanonicalBlockingReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return value ? [String(value)] : [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!entry || typeof entry !== 'object') return '';
      const record = entry as Record<string, unknown>;
      return String(record.message || record.reason || record.code || '');
    })
    .filter(Boolean);
}

/** Normaliza uma linha bruta devolvida pelas duas preview RPCs. */
export function parseCanonicalStrapDemandPreview(
  value: Record<string, unknown>,
): CanonicalStrapDemandPreview {
  const resolved = value.resolved && typeof value.resolved === 'object'
    ? value.resolved as Record<string, unknown>
    : {};
  const sourceMode = value.source_mode === 'internal' || value.source_mode === 'buy_ready'
    ? value.source_mode
    : null;

  return {
    saleOrderItemId: stringOrNull(value.sale_order_item_id),
    technicalStrapLineId: stringOrNull(value.technical_strap_line_id) || '',
    strapVariantId: stringOrNull(value.strap_variant_id),
    sourceMode,
    grossRequiredM: finiteOrZero(value.gross_required_m),
    recipeId: stringOrNull(value.recipe_id),
    baseProductId: stringOrNull(value.base_product_id),
    finishedProductId: stringOrNull(value.finished_product_id),
    strapProductName: String(resolved.strap_product_name || 'Tira sem cadastro'),
    strapColorName: String(resolved.strap_color_name || '—'),
    baseProductName: stringOrNull(resolved.base_product_name),
    confirmedYieldMPerM: numberOrNull(resolved.confirmed_yield_m_per_m),
    baseRequiredM: numberOrNull(resolved.base_required_m),
    cutBandWidthMm: numberOrNull(resolved.cut_band_width_mm),
    usableBaseWidthMm: numberOrNull(resolved.usable_base_width_mm_snapshot),
    theoreticalYieldMPerM: numberOrNull(resolved.theoretical_yield_m_per_m),
    blockingReasons: parseCanonicalBlockingReasons(value.blocking_reasons),
  };
}

export type CanonicalStrapConsumptionRow = MaterialConsumptionRow & {
  available?: number;
  artisanal?: { baseName: string; baseQty: number; yieldPerMeter: number; pending?: boolean };
  strapVariantId: string | null;
  strapSourceMode: CanonicalStrapSourceMode;
  recipeId: string | null;
  baseProductId: string | null;
  technicalStrapLineIds: string[];
};

const finiteOrZero = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

interface StockProductLike {
  id?: unknown;
  quantity?: unknown;
  reserved_stock?: unknown;
}

const netStock = (product: StockProductLike | undefined): number => Math.max(
  0,
  finiteOrZero(product?.quantity) - finiteOrZero(product?.reserved_stock),
);

/**
 * Substitui as linhas de tira calculadas por nome pelo resultado canônico da
 * preview RPC. Demais componentes permanecem intocados.
 */
export function replaceWithCanonicalStrapRows(
  rows: MaterialConsumptionRow[],
  ctx: ConsumptionContext,
  previews: CanonicalStrapDemandPreview[],
): MaterialConsumptionRow[] {
  if (previews.length === 0) {
    const nonStrapRows = rows.filter((row) => row.componentType !== 'Tiras');
    const hasUnresolvedStrap = rows.some((row) => row.componentType === 'Tiras');
    if (!hasUnresolvedStrap) return nonStrapRows;

    // A agregação antiga por grupo/cor não prova variante, base nem metragem.
    // Ela deixa de ser autoridade, mas a demanda não pode desaparecer: exibimos
    // uma sentinela neutra e acionável até a preview canônica resolver cada linha.
    return [
      ...nonStrapRows,
      {
        componentType: 'Tiras',
        groupName: 'Demanda de tira não resolvida',
        materialName: 'Revisar ficha e origem no Hub de Tiras',
        productUnit: 'm',
        color: '—',
        totalQuantity: 0,
        productIds: [],
        warning: 'A tira permanece bloqueada até resolver variante, base, cor e receita por ID.',
      },
    ];
  }

  const productsById = new Map<string, StockProductLike>(
    (ctx.allProducts || []).map((product: StockProductLike) => [String(product.id), product]),
  );
  const grouped = new Map<string, CanonicalStrapConsumptionRow>();

  for (const preview of previews) {
    const stableIdentity = preview.strapVariantId || preview.technicalStrapLineId;
    const key = [stableIdentity, preview.sourceMode || 'unresolved', preview.recipeId || 'no-recipe'].join('::');
    const existing = grouped.get(key);
    const gross = Math.max(0, finiteOrZero(preview.grossRequiredM));
    const baseRequired = Math.max(0, finiteOrZero(preview.baseRequiredM));
    const yieldPerMeter = Math.max(0, finiteOrZero(preview.confirmedYieldMPerM));
    const sourceLabel = preview.sourceMode === 'internal'
      ? 'Produção interna'
      : preview.sourceMode === 'buy_ready'
        ? 'Comprada pronta'
        : 'Origem pendente';

    if (existing) {
      existing.totalQuantity += gross;
      existing.technicalStrapLineIds.push(preview.technicalStrapLineId);
      if (existing.artisanal && preview.sourceMode === 'internal') {
        existing.artisanal.baseQty += baseRequired;
        if (preview.blockingReasons.length > 0) existing.artisanal.pending = true;
      }
      if (preview.blockingReasons.length > 0) {
        existing.warning = Array.from(new Set([
          ...(existing.warning ? existing.warning.split(' · ') : []),
          ...preview.blockingReasons,
        ])).join(' · ');
      }
      continue;
    }

    const product = preview.finishedProductId
      ? productsById.get(preview.finishedProductId)
      : undefined;
    const internal = preview.sourceMode === 'internal';
    const pendingInternal = internal && (
      !preview.recipeId
      || !preview.baseProductId
      || !preview.baseProductName
      || !(yieldPerMeter > 0)
      || preview.blockingReasons.length > 0
    );

    grouped.set(key, {
      componentType: 'Tiras',
      groupName: preview.strapProductName || 'Tira sem cadastro',
      materialName: sourceLabel,
      productUnit: 'm',
      color: preview.strapColorName || '—',
      totalQuantity: gross,
      productIds: preview.finishedProductId ? [preview.finishedProductId] : [],
      materialFamily: internal ? preview.baseProductName : null,
      available: netStock(product),
      warning: preview.blockingReasons.length > 0
        ? preview.blockingReasons.join(' · ')
        : undefined,
      artisanal: internal
        ? {
            baseName: preview.baseProductName || 'Material base não resolvido',
            baseQty: pendingInternal ? 0 : baseRequired,
            yieldPerMeter,
            pending: pendingInternal || undefined,
          }
        : undefined,
      strapVariantId: preview.strapVariantId,
      strapSourceMode: preview.sourceMode,
      recipeId: preview.recipeId,
      baseProductId: preview.baseProductId,
      technicalStrapLineIds: [preview.technicalStrapLineId],
    });
  }

  return [
    ...rows.filter((row) => row.componentType !== 'Tiras'),
    ...grouped.values(),
  ];
}

const canonicalCutPlaceholder = (
  larguraMm: number,
  warning?: string,
): StrapRollCutResult => ({
  largura_mm: larguraMm,
  metros_uteis_por_banda: 0,
  n_bandas: 0,
  cm_a_cortar: 0,
  rolos: 0,
  n_rolos_completos: 0,
  cm_no_ultimo_rolo: 0,
  valid: false,
  widthMissing: !(larguraMm > 0),
  warning: warning || 'Separação canônica calculada por rendimento da receita.',
});

/**
 * Orientação fabril canônica. A quantidade física é sempre a napa-base
 * requerida pelo rendimento aprovado; largura útil e banda são snapshots de
 * conferência, nunca parâmetros para reconstruir um rolo genérico.
 */
export function canonicalStrapCutRows(
  previews: CanonicalStrapDemandPreview[],
): ArtisanalStrapCutRow[] {
  const grouped = new Map<string, ArtisanalStrapCutRow>();

  previews
    .filter((preview) => preview.sourceMode === 'internal' && preview.grossRequiredM > 0)
    .forEach((preview) => {
      const key = [
        preview.strapVariantId || preview.technicalStrapLineId,
        preview.recipeId || 'recipe-unresolved',
      ].join('::');
      const gross = Math.max(0, finiteOrZero(preview.grossRequiredM));
      const baseRequired = Math.max(0, finiteOrZero(preview.baseRequiredM));
      const bandWidth = Math.max(0, finiteOrZero(preview.cutBandWidthMm));
      const yieldPerMeter = Math.max(0, finiteOrZero(preview.confirmedYieldMPerM));
      const usableWidth = Math.max(0, finiteOrZero(preview.usableBaseWidthMm));
      const theoreticalYield = Math.max(0, finiteOrZero(preview.theoreticalYieldMPerM));
      const existing = grouped.get(key);

      if (existing?.canonical) {
        existing.metros_necessarios += gross;
        existing.canonical.baseRequiredM += baseRequired;
        existing.canonical.blockingReasons = Array.from(new Set([
          ...existing.canonical.blockingReasons,
          ...preview.blockingReasons,
        ]));
        return;
      }

      grouped.set(key, {
        key,
        groupName: preview.strapProductName || 'Tira sem cadastro',
        color: preview.strapColorName || '—',
        largura_mm: bandWidth,
        metros_necessarios: gross,
        baseName: preview.baseProductName || undefined,
        cut: canonicalCutPlaceholder(bandWidth, preview.blockingReasons.join(' · ') || undefined),
        canonical: {
          recipeId: preview.recipeId,
          baseRequiredM: baseRequired,
          confirmedYieldMPerM: yieldPerMeter,
          usableBaseWidthMm: usableWidth,
          theoreticalYieldMPerM: theoreticalYield,
          blockingReasons: [...preview.blockingReasons],
        },
      });
    });

  return [...grouped.values()].sort((a, b) =>
    a.groupName.localeCompare(b.groupName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'));
}

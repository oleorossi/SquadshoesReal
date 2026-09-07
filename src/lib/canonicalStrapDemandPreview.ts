import type { MaterialConsumptionRow, ConsumptionContext } from '@/lib/orderConsumption';
import type { ArtisanalStrapCutRow, StrapRollCutResult } from '@/lib/strapRollCut';
import { normalizeBaseFamilyName } from '@/lib/baseMaterialTotal';

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
  /** Medida canônica da ficha (`artisanal_strap_measures.display_name`). */
  measureName: string | null;
  strapColorName: string;
  /** SKU oficial da napa (pode incluir a cor). */
  baseProductName: string | null;
  /** Família de napa (`product_groups.name`) — preferida na lista de compra. */
  baseGroupName: string | null;
  confirmedYieldMPerM: number | null;
  baseRequiredM: number | null;
  cutBandWidthMm: number | null;
  usableBaseWidthMm: number | null;
  theoreticalYieldMPerM: number | null;
  /**
   * Custo de transformação (mão de obra) por metro de tira acabada
   * (`artisanal_strap_recipes.transformation_cost_per_m`). Null quando a
   * receita não resolveu, a origem é buy_ready ou o usuário não vê financeiro.
   */
  transformationCostPerM: number | null;
  blockingReasons: string[];
  /** Códigos crus dos blocking_reasons (além das mensagens). */
  blockingCodes: string[];
  snapshotWarning?: string | null;
}

const STRAP_LABEL_FALLBACK = 'Tira sem cadastro';

const finiteOrZero = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const stringOrNull = (value: unknown): string | null =>
  value == null || value === '' ? null : String(value);

const numberOrNull = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Códigos em que a preview é snapshot/UUID fantasma — não uma 2ª medida real. */
const STALE_STRAP_PREVIEW_CODES = new Set([
  'frozen_source_snapshot_stale',
  'variant_snapshot_stale',
  'variant_identity_not_persisted',
  'technical_line_identity_invalid',
  'technical_identity_snapshot_stale',
  'technical_line_missing',
]);

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

export function parseCanonicalBlockingCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      return String((entry as Record<string, unknown>).code || '');
    })
    .filter(Boolean);
}

/**
 * Família de napa pra buy-list / PDF. Prefere o grupo da ficha; se a RPC só
 * mandou o SKU com cor, tira o sufixo. Sem isso o cobre da tira vira bloco
 * "GLOW METALIC + MASSABOX - COBRE" separado do cabedal Massabox.
 */
export function resolveStrapBaseFamilyName(
  preview: Pick<CanonicalStrapDemandPreview, 'baseGroupName' | 'baseProductName' | 'strapColorName' | 'baseProductId'>,
  ctx?: Pick<ConsumptionContext, 'allProducts' | 'productGroups'>,
): string {
  const fromGroup = (preview.baseGroupName || '').trim();
  if (fromGroup) return fromGroup;

  if (preview.baseProductId && ctx?.allProducts?.length) {
    const product = (ctx.allProducts as Array<{ id?: string; group_id?: string | null }>)
      .find((entry) => String(entry.id) === String(preview.baseProductId));
    const groupId = product?.group_id;
    if (groupId) {
      const group = (ctx.productGroups as Array<{ id?: string; name?: string }> | undefined)
        ?.find((entry) => String(entry.id) === String(groupId));
      const groupName = (group?.name || '').trim();
      if (groupName) return groupName;
    }
  }

  return normalizeBaseFamilyName(preview.baseProductName, preview.strapColorName);
}

/**
 * Rótulo exibido na tela/PDF. Sem SKU acabado, usa a medida da ficha (e napa/cor
 * quando houver) — nunca esconde a medida real atrás de "Tira sem cadastro".
 */
export function formatCanonicalStrapProductName(
  preview: Pick<
    CanonicalStrapDemandPreview,
    | 'strapProductName'
    | 'measureName'
    | 'baseGroupName'
    | 'baseProductName'
    | 'strapColorName'
    | 'baseProductId'
  >,
): string {
  const named = (preview.strapProductName || '').trim();
  if (named && named !== STRAP_LABEL_FALLBACK) return named;

  const measure = (preview.measureName || '').trim();
  const base = resolveStrapBaseFamilyName(preview);
  const color = (preview.strapColorName || '').trim();
  const parts = [
    measure ? (measure.toUpperCase().startsWith('TIRA') ? measure : `TIRA ${measure}`) : null,
    base || null,
    color && color !== '—' ? color : null,
  ].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(' · ') : STRAP_LABEL_FALLBACK;
}

const approxSameMeters = (a: number, b: number): boolean =>
  Math.abs(finiteOrZero(a) - finiteOrZero(b)) < 0.05;

const isHealthyStrapPreview = (preview: CanonicalStrapDemandPreview): boolean => {
  if (preview.blockingReasons.length > 0 || preview.snapshotWarning) return false;
  if (!preview.sourceMode) return false;
  if (preview.sourceMode === 'internal') {
    return !!preview.recipeId && !!preview.baseProductId && finiteOrZero(preview.confirmedYieldMPerM) > 0;
  }
  return !!preview.finishedProductId;
};

const isStaleGhostStrapPreview = (preview: CanonicalStrapDemandPreview): boolean => {
  if (isHealthyStrapPreview(preview)) return false;
  if (preview.finishedProductId) return false;
  if (preview.blockingCodes.some((code) => STALE_STRAP_PREVIEW_CODES.has(code))) return true;
  const blob = [
    ...preview.blockingReasons,
    preview.snapshotWarning || '',
  ].join(' ').toLowerCase();
  return /origem congelada|diverge do catalogo|variante escolhida|variante exata|linha tecnica/
    .test(blob);
};

/**
 * Remove preview fantasma que só repete a demanda de uma linha já saudável
 * (mesmo item/cor/metragem), típico de `strap_colors`/`strap_sourcing` obsoleto
 * no rascunho — caso PV-00193 OFF WHITE ("Tira sem cadastro" + CHATA 8 mm ok).
 */
export function collapseDuplicateStaleStrapPreviews(
  previews: CanonicalStrapDemandPreview[],
): CanonicalStrapDemandPreview[] {
  if (previews.length < 2) return previews;
  const healthy = previews.filter(isHealthyStrapPreview);
  if (healthy.length === 0) return previews;

  return previews.filter((preview) => {
    if (!isStaleGhostStrapPreview(preview)) return true;
    const ghostColor = (preview.strapColorName || '').trim().toLowerCase();
    const ghostMeasure = (preview.measureName || '').trim().toLowerCase();
    const ghostBase = resolveStrapBaseFamilyName(preview).trim().toLowerCase();
    return !healthy.some((ok) => {
      if (preview.saleOrderItemId && ok.saleOrderItemId
          && preview.saleOrderItemId !== ok.saleOrderItemId) {
        return false;
      }
      if (preview.technicalStrapLineId && ok.technicalStrapLineId
          && preview.technicalStrapLineId === ok.technicalStrapLineId) {
        return true;
      }
      const sameColor = ghostColor
        && ghostColor === (ok.strapColorName || '').trim().toLowerCase();
      const sameMeters = approxSameMeters(preview.grossRequiredM, ok.grossRequiredM);
      if (!(sameColor && sameMeters && preview.grossRequiredM > 0)) return false;
      if (ghostMeasure) {
        const okMeasure = (ok.measureName || '').trim().toLowerCase();
        const okLabel = (ok.strapProductName || '').trim().toLowerCase();
        if (okMeasure && okMeasure !== ghostMeasure
            && !okLabel.includes(ghostMeasure)) {
          return false;
        }
      }
      if (ghostBase) {
        const okBase = resolveStrapBaseFamilyName(ok).trim().toLowerCase();
        if (okBase && okBase !== ghostBase) return false;
      }
      return true;
    });
  });
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
  const rawName = stringOrNull(resolved.strap_product_name);
  const catalog = resolved.catalog && typeof resolved.catalog === 'object'
    ? resolved.catalog as Record<string, unknown>
    : {};

  return {
    saleOrderItemId: stringOrNull(value.sale_order_item_id),
    technicalStrapLineId: stringOrNull(value.technical_strap_line_id) || '',
    strapVariantId: stringOrNull(value.strap_variant_id),
    sourceMode,
    grossRequiredM: finiteOrZero(value.gross_required_m),
    recipeId: stringOrNull(value.recipe_id),
    baseProductId: stringOrNull(value.base_product_id),
    finishedProductId: stringOrNull(value.finished_product_id),
    strapProductName: rawName || STRAP_LABEL_FALLBACK,
    measureName: stringOrNull(resolved.measure_name),
    strapColorName: String(resolved.strap_color_name || '—'),
    baseProductName: stringOrNull(resolved.base_product_name),
    baseGroupName: stringOrNull(resolved.base_group_name),
    confirmedYieldMPerM: numberOrNull(resolved.confirmed_yield_m_per_m),
    baseRequiredM: numberOrNull(resolved.base_required_m),
    cutBandWidthMm: numberOrNull(resolved.cut_band_width_mm),
    usableBaseWidthMm: numberOrNull(resolved.usable_base_width_mm_snapshot),
    theoreticalYieldMPerM: numberOrNull(resolved.theoretical_yield_m_per_m),
    transformationCostPerM: numberOrNull(
      resolved.transformation_cost_per_m ?? catalog.transformation_cost_per_m,
    ),
    blockingReasons: parseCanonicalBlockingReasons(value.blocking_reasons),
    blockingCodes: parseCanonicalBlockingCodes(value.blocking_reasons),
    ...(resolved.snapshot_warning ? { snapshotWarning: stringOrNull(resolved.snapshot_warning) } : {}),
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
  const effectivePreviews = collapseDuplicateStaleStrapPreviews(previews);
  if (effectivePreviews.length === 0) {
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

  for (const preview of effectivePreviews) {
    const stableIdentity = preview.strapVariantId || preview.technicalStrapLineId;
    const key = [stableIdentity, preview.sourceMode || 'unresolved', preview.recipeId || 'no-recipe',
      preview.baseProductId || 'no-base', preview.finishedProductId || 'no-finished'].join('::');
    const existing = grouped.get(key);
    const presentationWarnings = [...preview.blockingReasons,
      ...(preview.snapshotWarning ? [preview.snapshotWarning] : [])];
    const gross = Math.max(0, finiteOrZero(preview.grossRequiredM));
    const baseRequired = Math.max(0, finiteOrZero(preview.baseRequiredM));
    const yieldPerMeter = Math.max(0, finiteOrZero(preview.confirmedYieldMPerM));
    const sourceLabel = preview.sourceMode === 'internal'
      ? 'Produção interna'
      : preview.sourceMode === 'buy_ready'
        ? 'Comprada pronta'
        : 'Origem pendente';
    const displayName = formatCanonicalStrapProductName(preview);

    if (existing) {
      existing.totalQuantity += gross;
      existing.technicalStrapLineIds.push(preview.technicalStrapLineId);
      if (existing.artisanal && preview.sourceMode === 'internal') {
        existing.artisanal.baseQty += baseRequired;
        if (presentationWarnings.length > 0) existing.artisanal.pending = true;
      }
      if (presentationWarnings.length > 0) {
        existing.warning = Array.from(new Set([
          ...(existing.warning ? existing.warning.split(' · ') : []),
          ...presentationWarnings,
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
      || !!preview.snapshotWarning
    );
    const baseFamilyName = resolveStrapBaseFamilyName(preview, ctx);

    grouped.set(key, {
      componentType: 'Tiras',
      groupName: displayName,
      materialName: sourceLabel,
      productUnit: 'm',
      color: preview.strapColorName || '—',
      totalQuantity: gross,
      productIds: preview.finishedProductId ? [preview.finishedProductId] : [],
      materialFamily: internal ? baseFamilyName : null,
      available: netStock(product),
      warning: presentationWarnings.length > 0
        ? presentationWarnings.join(' · ')
        : undefined,
      artisanal: internal
        ? {
            baseName: baseFamilyName || 'Material base não resolvido',
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

  collapseDuplicateStaleStrapPreviews(previews)
    .filter((preview) => preview.sourceMode === 'internal' && preview.grossRequiredM > 0)
    .forEach((preview) => {
      const key = [
        preview.strapVariantId || preview.technicalStrapLineId,
        preview.recipeId || 'recipe-unresolved',
        preview.baseProductId || 'base-unresolved',
        preview.finishedProductId || 'finished-unresolved',
      ].join('::');
      const gross = Math.max(0, finiteOrZero(preview.grossRequiredM));
      const baseRequired = Math.max(0, finiteOrZero(preview.baseRequiredM));
      const bandWidth = Math.max(0, finiteOrZero(preview.cutBandWidthMm));
      const yieldPerMeter = Math.max(0, finiteOrZero(preview.confirmedYieldMPerM));
      const usableWidth = Math.max(0, finiteOrZero(preview.usableBaseWidthMm));
      const theoreticalYield = Math.max(0, finiteOrZero(preview.theoreticalYieldMPerM));
      const transformationCostPerM = preview.transformationCostPerM;
      const existing = grouped.get(key);

      if (existing?.canonical) {
        existing.metros_necessarios += gross;
        existing.canonical.baseRequiredM += baseRequired;
        existing.canonical.blockingReasons = Array.from(new Set([
          ...existing.canonical.blockingReasons,
          ...preview.blockingReasons,
        ]));
        // R$/m é taxa da receita — não soma na agregação. Preenche se a 1ª
        // linha veio sem financeiro e uma posterior trouxe o custo.
        if (existing.canonical.transformationCostPerM == null && transformationCostPerM != null) {
          existing.canonical.transformationCostPerM = transformationCostPerM;
        }
        if (preview.snapshotWarning) existing.canonical.snapshotWarning = preview.snapshotWarning;
        return;
      }

      grouped.set(key, {
        key,
        groupName: formatCanonicalStrapProductName(preview),
        color: preview.strapColorName || '—',
        largura_mm: bandWidth,
        metros_necessarios: gross,
        baseName: resolveStrapBaseFamilyName(preview) || undefined,
        cut: canonicalCutPlaceholder(bandWidth, preview.blockingReasons.join(' · ') || undefined),
        canonical: {
          recipeId: preview.recipeId,
          baseRequiredM: baseRequired,
          confirmedYieldMPerM: yieldPerMeter,
          usableBaseWidthMm: usableWidth,
          theoreticalYieldMPerM: theoreticalYield,
          transformationCostPerM,
          blockingReasons: [...preview.blockingReasons],
          ...(preview.snapshotWarning ? { snapshotWarning: preview.snapshotWarning } : {}),
        },
      });
    });

  return [...grouped.values()].sort((a, b) =>
    a.groupName.localeCompare(b.groupName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'));
}

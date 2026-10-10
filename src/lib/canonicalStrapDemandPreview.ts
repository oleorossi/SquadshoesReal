import type { MaterialConsumptionRow, ConsumptionContext } from '@/lib/orderConsumption';
import {
  isSoftStrapPrebaselineNoise,
  type ArtisanalStrapCutRow,
  type StrapRollCutResult,
} from '@/lib/strapRollCut';
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
  /** Medida canônica da ficha (`artisanal_strap_measures.id`). */
  measureId: string | null;
  /** Medida canônica da ficha (`artisanal_strap_measures.display_name`). */
  measureName: string | null;
  /** Família de tira (`artisanal_strap_types.id`), quando a preview já resolveu. */
  typeId: string | null;
  strapColorName: string;
  /** Grupo da napa-base (`product_groups.id`). */
  baseGroupId: string | null;
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
  /** `scope_key` do relatório (item do PV ou OP) — liga a preview à grade/pares. */
  scopeKey?: string | null;
  /** PV dono da linha (`sale_order_id`) — modo "Por PV e modelo". */
  saleOrderId?: string | null;
  /** Ordem da linha de tira no item (`line_ordinal`). */
  lineOrdinal?: number | null;
  /** Cor canônica (`canonical_colors.id`) — chave de agrupamento por cor. */
  colorId?: string | null;
  /**
   * Tira pronta em estoque para a variante (`resolved.catalog.finished_available_m`).
   * Null quando a preview não trouxe o dado.
   */
  finishedAvailableM?: number | null;
  /** Mensagens cujos códigos são ruído soft de pré-baseline (não bloqueiam napa). */
  softBlockingReasons?: string[];
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
 * Códigos soft de pré-baseline: a transformação ainda não congelou, mas o Hub
 * já tem rendimento. Não bloqueiam a conversão em napa (PV-00194/PV-00222).
 */
const SOFT_STRAP_BLOCKING_CODES = new Set([
  'variant_identity_not_persisted',
  'frozen_source_snapshot_stale',
  'reference_base_intent_mismatch',
  'catalog_resolution_blocked',
]);

function parseSoftBlockingReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const record = entry as Record<string, unknown>;
      if (!SOFT_STRAP_BLOCKING_CODES.has(String(record.code || ''))) return '';
      return String(record.message || record.reason || record.code || '');
    })
    .filter(Boolean);
}

/**
 * Motivos que impedem a conversão em napa (D9). Ruído soft de pré-baseline
 * (por código ou por texto) não conta — o rendimento do Hub já basta.
 */
export function hardStrapBlockingReasons(
  preview: Pick<CanonicalStrapDemandPreview, 'blockingReasons' | 'snapshotWarning' | 'softBlockingReasons'>,
): string[] {
  const soft = new Set(preview.softBlockingReasons || []);
  const hard = (preview.blockingReasons || [])
    .filter((reason) => !soft.has(reason) && !isSoftStrapPrebaselineNoise(reason));
  const warning = (preview.snapshotWarning || '').trim();
  if (warning && !isSoftStrapPrebaselineNoise(warning)) hard.push(warning);
  return Array.from(new Set(hard));
}

export const STRAP_NAPA_MISSING_YIELD_REASON =
  'Sem receita/rendimento aprovado para esta tira × napa — cadastre no Hub de Tiras.';

/**
 * FONTE ÚNICA da regra D9 (linha, bloco “Setor de Tiras”, PDF e compra):
 * tira Fazer só vira napa com receita aprovada, rendimento > 0 e sem bloqueio
 * duro. Devolve o motivo do bloqueio, ou null quando a napa é calculável.
 * Comprar/origem pendente não têm napa — devolve null (não se aplica).
 */
export function strapNapaBlockReason(
  preview: Pick<
    CanonicalStrapDemandPreview,
    'sourceMode' | 'recipeId' | 'confirmedYieldMPerM' | 'blockingReasons' | 'snapshotWarning' | 'softBlockingReasons'
  >,
): string | null {
  if (preview.sourceMode !== 'internal') return null;
  const hard = hardStrapBlockingReasons(preview);
  if (hard.length > 0) return hard.join(' · ');
  const yieldM = finiteOrZero(preview.confirmedYieldMPerM);
  if (!(yieldM > 0) || !preview.recipeId) {
    const soft = (preview.snapshotWarning || '').trim();
    return soft || STRAP_NAPA_MISSING_YIELD_REASON;
  }
  return null;
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
    measure ? formatStrapMeasureLabel(measure) : null,
    base || null,
    color && color !== '—' ? color : null,
  ].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(' · ') : STRAP_LABEL_FALLBACK;
}

/** Prefixa TIRA só para medida crua/chata/strass — nunca em ELÁSTICO/MEIA CANA/etc. */
export function formatStrapMeasureLabel(measureName: string): string {
  const measure = measureName.trim();
  if (!measure) return measure;
  const upper = measure.toUpperCase();
  if (upper.startsWith('TIRA')) return measure;
  // Já veio como identidade de produto (overlay 232: "ELÁSTICO FORRADO 7 mm").
  if (
    /^(EL[ÁA]STICO|MEIA\s*CANA|COBERTO|COBERTA|VIVO|VI[EÉ]S|CADAR[CÇ]O|ELASTICO)\b/.test(
      upper,
    )
  ) {
    return measure;
  }
  return `TIRA ${measure}`;
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
      // buy_ready (STRASS) ≠ internal (overlock/chata): mesma cor/metragem
      // não prova duplicata — colapsar apaga a demanda comprada pronta.
      if (preview.sourceMode && ok.sourceMode
          && preview.sourceMode !== ok.sourceMode) {
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
  // Snapshot pré-demanda (committed + physical_snapshot_complete=false) grava
  // group_name/label/color da linha do item, sem strap_product_name. Sem este
  // fallback a STRASS vira "Tira sem cadastro" e some na busca da tela.
  const rawName = stringOrNull(resolved.strap_product_name)
    || stringOrNull(resolved.group_name)
    || stringOrNull(resolved.label);
  const rawColor = stringOrNull(resolved.strap_color_name)
    || stringOrNull(resolved.color);
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
    measureId: stringOrNull(resolved.measure_id)
      || stringOrNull(value.measure_id),
    measureName: stringOrNull(resolved.measure_name),
    typeId: stringOrNull(resolved.strap_type_id)
      || stringOrNull(resolved.type_id),
    strapColorName: rawColor || '—',
    baseGroupId: stringOrNull(resolved.base_group_id),
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
    scopeKey: stringOrNull(value.scope_key),
    saleOrderId: stringOrNull(value.sale_order_id),
    lineOrdinal: numberOrNull(value.line_ordinal),
    colorId: stringOrNull(resolved.color_id) || stringOrNull(catalog.color_id),
    finishedAvailableM: numberOrNull(
      catalog.finished_available_m
        ?? (catalog.source_availability && typeof catalog.source_availability === 'object'
          ? (catalog.source_availability as Record<string, unknown>).finished_available_m
          : null),
    ),
    softBlockingReasons: parseSoftBlockingReasons(value.blocking_reasons),
    ...(resolved.snapshot_warning ? { snapshotWarning: stringOrNull(resolved.snapshot_warning) } : {}),
  };
}

/**
 * Origem da tira (spec tiras-redesenho, Revisão 2 — R1). As CHAVES internas
 * ficaram `fazer`/`comprar` (código), mas a fábrica nunca corta tira:
 * `fazer` = source_mode `internal` = **Prestador** (a napa vai ao prestador);
 * `comprar` = `buy_ready` = **Comprar pronto**. Na UI, só os rótulos abaixo.
 */
export type StrapOrigin = 'fazer' | 'comprar';

export const STRAP_ORIGIN_LABEL: Record<StrapOrigin, string> = {
  fazer: 'Prestador',
  comprar: 'Comprar pronto',
};

/**
 * Fatos de apresentação de uma linha de tira no Consumo (D8/D10/D15). Metros
 * de TIRA e metros de NAPA nunca se somam: `totalQuantity` da linha é tira;
 * `napaM` é a napa-base (só Fazer) e mora no bloco “Setor de Tiras”.
 */
export interface StrapConsumptionFacts {
  origin: StrapOrigin | null;
  /** Pares do(s) item(ns) que geram a linha; null quando o escopo não trouxe. */
  pairs: number | null;
  /** Pares por numeração; null quando a grade não fecha com os pares. */
  pairsBySize: Record<string, number> | null;
  /** Metros de tira por numeração (pares × cm/par ÷ 100); null se não provável. */
  metersBySize: Record<string, number> | null;
  /** Tira pronta consumida do estoque primeiro (D15). */
  fromStockM: number;
  /** Falta depois do estoque: a fazer (Fazer) ou a comprar (Comprar). */
  toMakeM: number;
  /** Napa-base = a fazer ÷ rendimento. Null = não se aplica ou bloqueada (D9). */
  napaM: number | null;
  /** Motivo do bloqueio da napa (D9); null quando calculável ou não se aplica. */
  napaBlockedReason: string | null;
  /** Rótulos das linhas da ficha (ex.: "TIRA 1", "TRASEIRA"). */
  lineLabels: string[];
  /** Rendimento m de tira / m de napa (só Fazer, quando conhecido). */
  yieldMPerM: number | null;
}

export type CanonicalStrapConsumptionRow = MaterialConsumptionRow & {
  available?: number;
  artisanal?: {
    baseName: string;
    baseQty: number;
    yieldPerMeter: number;
    pending?: boolean;
    blockedReason?: string;
  };
  strapVariantId: string | null;
  strapSourceMode: CanonicalStrapSourceMode;
  recipeId: string | null;
  baseProductId: string | null;
  technicalStrapLineIds: string[];
  strap: StrapConsumptionFacts;
};

interface StockProductLike {
  id?: unknown;
  name?: unknown;
  quantity?: unknown;
  reserved_stock?: unknown;
}

const netStock = (product: StockProductLike | undefined): number => Math.max(
  0,
  finiteOrZero(product?.quantity) - finiteOrZero(product?.reserved_stock),
);

const normColorKey = (value: string | null | undefined): string => (value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .trim();

/** Linha de tira da ficha técnica (`technical_sheets.strap_colors[]`). */
export interface StrapLineSpec {
  label: string | null;
  /** cm/par por numeração. */
  consumptionPerSize: Record<string, number>;
  /** cm/par escalar (fallback quando a numeração não tem valor próprio). */
  consumption: number | null;
}

/** Escopo do relatório (item do PV ou OP): PV, modelo, pares e grade efetiva. */
export interface StrapScopeInfo {
  saleOrderId: string | null;
  referenceId: string | null;
  pairs: number | null;
  grade: Record<string, number> | null;
}

export interface CanonicalStrapPresentationOptions {
  /** `order_reference` = linhas carregam PV + modelo (modo "Por PV e modelo"). */
  partition?: 'none' | 'order_reference';
  /** scope_key → PV/modelo/pares/grade (vindo das `lines` do relatório). */
  scopeByKey?: ReadonlyMap<string, StrapScopeInfo>;
  /** technical_strap_line_id → cm/par por numeração + rótulo da linha. */
  lineSpecs?: ReadonlyMap<string, StrapLineSpec>;
  orderNumberBySaleOrderId?: ReadonlyMap<string, string>;
  referenceLabelById?: ReadonlyMap<string, { code: string; name: string | null }>;
  /** D15: consome tira pronta em estoque antes de fazer/comprar. */
  allocateFinishedStock?: boolean;
  /**
   * `line` (default, tela Consumo de Materiais): uma linha por linha da ficha
   * × cor (D10). `variant`: funde as posições da mesma variante × cor — as
   * fichas de operador/diálogo de OP seguem com uma linha por material físico.
   */
  groupBy?: 'line' | 'variant';
}

/** Fatos derivados de UMA preview (linha de tira de um item/OP). */
export interface StrapLineFacts {
  preview: CanonicalStrapDemandPreview;
  grossM: number;
  fromStockM: number;
  toMakeM: number;
  napaM: number | null;
  blockReason: string | null;
  /** Estoque inicial do SKU pronto usado na alocação (representante do balde). */
  stockPoolM: number | null;
}

/**
 * Deriva, por linha, quanto sai do estoque de tira pronta (D15), quanto falta
 * fazer/comprar e a napa = a fazer ÷ rendimento (D9 quando bloqueada). O mesmo
 * SKU pronto é um balde único: duas linhas não consomem o mesmo saldo duas vezes.
 * Sem `allocateFinishedStock` nada sai do estoque (a fronteira da separação já
 * recebe a falta LÍQUIDA persistida).
 */
export function deriveStrapLineFacts(
  previews: CanonicalStrapDemandPreview[],
  opts: { allocateFinishedStock?: boolean; stockOf?: (productId: string) => number | null } = {},
): StrapLineFacts[] {
  const initial = new Map<string, number>();
  if (opts.allocateFinishedStock) {
    for (const preview of previews) {
      const id = preview.finishedProductId;
      const fromPreview = preview.finishedAvailableM;
      if (!id || fromPreview == null || !Number.isFinite(fromPreview)) continue;
      initial.set(id, Math.max(initial.get(id) ?? 0, Math.max(0, fromPreview)));
    }
    for (const preview of previews) {
      const id = preview.finishedProductId;
      if (!id || initial.has(id)) continue;
      initial.set(id, Math.max(0, finiteOrZero(opts.stockOf?.(id))));
    }
  }
  const pools = new Map(initial);

  return previews.map((preview) => {
    const grossM = Math.max(0, finiteOrZero(preview.grossRequiredM));
    const id = preview.finishedProductId;
    let fromStockM = 0;
    if (id && pools.has(id)) {
      const pool = pools.get(id) || 0;
      fromStockM = Math.min(grossM, pool);
      pools.set(id, pool - fromStockM);
    }
    const toMakeM = Math.max(0, grossM - fromStockM);
    const blockReason = strapNapaBlockReason(preview);
    const yieldM = finiteOrZero(preview.confirmedYieldMPerM);
    const napaM = preview.sourceMode === 'internal' && !blockReason && yieldM > 0
      ? toMakeM / yieldM
      : null;
    return {
      preview,
      grossM,
      fromStockM,
      toMakeM,
      napaM,
      blockReason,
      stockPoolM: id && initial.has(id) ? initial.get(id)! : null,
    };
  });
}

const positiveGrade = (
  grade: Record<string, number> | null | undefined,
): Record<string, number> | null => {
  if (!grade) return null;
  const out: Record<string, number> = {};
  for (const [size, value] of Object.entries(grade)) {
    if (size.startsWith('_')) continue;
    const quantity = Number(value);
    if (Number.isFinite(quantity) && quantity > 0) out[size] = quantity;
  }
  return Object.keys(out).length > 0 ? out : null;
};

/** Tolerância da conferência Σ(metros por numeração) × metros do motor. */
const SIZE_PARITY_TOLERANCE_M = 0.01;

/**
 * Pares e metros de tira por numeração (D10). Só devolve metros por numeração
 * quando a ficha tem cm/par para cada número E a soma bate com o motor SQL —
 * nunca inventa uma distribuição que o motor não usou.
 */
export function strapSizeBreakdown(
  grossM: number,
  scope: StrapScopeInfo | undefined,
  spec: StrapLineSpec | undefined,
): Pick<StrapConsumptionFacts, 'pairs' | 'pairsBySize' | 'metersBySize'> {
  const scopePairs = scope?.pairs != null && scope.pairs > 0 ? scope.pairs : null;
  const grade = positiveGrade(scope?.grade);
  if (!grade) return { pairs: scopePairs, pairsBySize: null, metersBySize: null };

  const sum = Object.values(grade).reduce((total, value) => total + value, 0);
  let factor = 1;
  if (scopePairs != null && Math.abs(sum - scopePairs) > 1e-9) {
    // Grade por ficha (Σ = pares/ficha) × fichas inteiras = pares do item.
    const ratio = scopePairs / sum;
    if (!(ratio >= 1) || Math.abs(ratio - Math.round(ratio)) > 1e-9) {
      return { pairs: scopePairs, pairsBySize: null, metersBySize: null };
    }
    factor = Math.round(ratio);
  }
  const pairsBySize: Record<string, number> = {};
  for (const [size, value] of Object.entries(grade)) pairsBySize[size] = value * factor;
  const pairs = scopePairs ?? sum * factor;
  if (!spec) return { pairs, pairsBySize, metersBySize: null };

  const metersBySize: Record<string, number> = {};
  let total = 0;
  for (const [size, sizePairs] of Object.entries(pairsBySize)) {
    const perSize = Number(spec.consumptionPerSize?.[size]);
    const cmPerPair = Number.isFinite(perSize) && perSize > 0
      ? perSize
      : (spec.consumption != null && spec.consumption > 0 ? spec.consumption : null);
    if (cmPerPair == null) return { pairs, pairsBySize, metersBySize: null };
    const meters = (sizePairs * cmPerPair) / 100;
    metersBySize[size] = meters;
    total += meters;
  }
  if (Math.abs(total - grossM) > SIZE_PARITY_TOLERANCE_M) {
    return { pairs, pairsBySize, metersBySize: null };
  }
  return { pairs, pairsBySize, metersBySize };
}

const mergeSizeMap = (
  a: Record<string, number> | null,
  b: Record<string, number> | null,
): Record<string, number> | null => {
  if (!a || !b) return null;
  const out = { ...a };
  for (const [size, value] of Object.entries(b)) out[size] = (out[size] || 0) + value;
  return out;
};

const strapOriginOf = (mode: CanonicalStrapSourceMode): StrapOrigin | null =>
  mode === 'internal' ? 'fazer' : mode === 'buy_ready' ? 'comprar' : null;

const strapMaterialName = (origin: StrapOrigin | null, labels: string[]): string => {
  const base = origin ? STRAP_ORIGIN_LABEL[origin] : 'Origem pendente';
  return labels.length > 0 ? `${base} · ${labels.join(', ')}` : base;
};

/**
 * Substitui as linhas de tira calculadas por nome pelo resultado canônico da
 * preview RPC. Demais componentes permanecem intocados.
 *
 * Uma linha por **linha da ficha × cor × origem** (D8/D10): a tira nunca some
 * — mesmo Fazer convertida em napa continua com seus metros de TIRA. A napa
 * vive em `artisanal`/`strap.napaM` e no bloco “Setor de Tiras”.
 */
export function replaceWithCanonicalStrapRows(
  rows: MaterialConsumptionRow[],
  ctx: ConsumptionContext,
  previews: CanonicalStrapDemandPreview[],
  opts: CanonicalStrapPresentationOptions = {},
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
  const partitioned = opts.partition === 'order_reference';
  const facts = deriveStrapLineFacts(effectivePreviews, {
    allocateFinishedStock: opts.allocateFinishedStock,
    stockOf: (id) => (productsById.has(id) ? netStock(productsById.get(id)) : null),
  });
  const grouped = new Map<string, CanonicalStrapConsumptionRow>();

  for (const fact of facts) {
    const { preview } = fact;
    const scopeKey = preview.scopeKey || preview.saleOrderItemId || '';
    const scope = scopeKey ? opts.scopeByKey?.get(scopeKey) : undefined;
    const saleOrderId = preview.saleOrderId || scope?.saleOrderId || null;
    const referenceId = scope?.referenceId || null;
    const spec = preview.technicalStrapLineId
      ? opts.lineSpecs?.get(preview.technicalStrapLineId)
      : undefined;
    const sizes = strapSizeBreakdown(fact.grossM, scope, spec);
    const blocked = !!fact.blockReason;
    const colorKey = preview.colorId || normColorKey(preview.strapColorName);
    // Cor e linha da ficha na chave: DÁLIA e PRATA da mesma referência nunca
    // se fundem; TIRA 1 e TRASEIRA aparecem separadas (D10).
    const identity = opts.groupBy === 'variant'
      ? (preview.strapVariantId || preview.technicalStrapLineId)
      : (preview.technicalStrapLineId || preview.strapVariantId);
    const key = [
      identity || 'no-line',
      colorKey || 'no-color',
      preview.sourceMode || 'unresolved',
      preview.recipeId || 'no-recipe',
      preview.baseProductId || 'no-base',
      preview.finishedProductId || 'no-finished',
      blocked ? 'napa-blocked' : 'napa-ok',
      partitioned ? (saleOrderId || '') : '',
      partitioned ? (referenceId || '') : '',
    ].join('::');
    const existing = grouped.get(key);
    const presentationWarnings = Array.from(new Set([
      ...preview.blockingReasons,
      ...(preview.snapshotWarning ? [preview.snapshotWarning] : []),
      ...(fact.blockReason && fact.blockReason === STRAP_NAPA_MISSING_YIELD_REASON
        ? [fact.blockReason]
        : []),
    ]));
    const yieldPerMeter = Math.max(0, finiteOrZero(preview.confirmedYieldMPerM));
    const label = (spec?.label || '').trim();

    if (existing) {
      existing.totalQuantity += fact.grossM;
      existing.technicalStrapLineIds.push(preview.technicalStrapLineId);
      const strap = existing.strap;
      strap.fromStockM += fact.fromStockM;
      strap.toMakeM += fact.toMakeM;
      strap.pairs = strap.pairs != null && sizes.pairs != null ? strap.pairs + sizes.pairs : null;
      strap.pairsBySize = mergeSizeMap(strap.pairsBySize, sizes.pairsBySize);
      strap.metersBySize = mergeSizeMap(strap.metersBySize, sizes.metersBySize);
      if (strap.napaM != null && fact.napaM != null) strap.napaM += fact.napaM;
      if (label && !strap.lineLabels.includes(label)) strap.lineLabels.push(label);
      if (existing.artisanal && fact.napaM != null) existing.artisanal.baseQty += fact.napaM;
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
    const productName = String(product?.name || '').trim();
    const namedPreview = preview.strapProductName
      && preview.strapProductName !== STRAP_LABEL_FALLBACK
      ? preview.strapProductName
      : (productName || preview.strapProductName);
    const displayName = formatCanonicalStrapProductName({
      ...preview,
      strapProductName: namedPreview,
    });
    const internal = preview.sourceMode === 'internal';
    const baseFamilyName = resolveStrapBaseFamilyName(preview, ctx);
    const origin = strapOriginOf(preview.sourceMode);

    const row: CanonicalStrapConsumptionRow = {
      componentType: 'Tiras',
      groupName: displayName,
      materialName: strapMaterialName(origin, label ? [label] : []),
      productUnit: 'm',
      color: preview.strapColorName || '—',
      totalQuantity: fact.grossM,
      productIds: preview.finishedProductId ? [preview.finishedProductId] : [],
      materialFamily: internal ? baseFamilyName : null,
      available: fact.stockPoolM != null ? fact.stockPoolM : netStock(product),
      warning: presentationWarnings.length > 0
        ? presentationWarnings.join(' · ')
        : undefined,
      artisanal: internal
        ? {
            baseName: baseFamilyName || 'Material base não resolvido',
            baseQty: fact.napaM ?? 0,
            yieldPerMeter,
            pending: blocked || undefined,
            ...(blocked && fact.blockReason ? { blockedReason: fact.blockReason } : {}),
          }
        : undefined,
      strapVariantId: preview.strapVariantId,
      strapSourceMode: preview.sourceMode,
      recipeId: preview.recipeId,
      baseProductId: preview.baseProductId,
      technicalStrapLineIds: [preview.technicalStrapLineId],
      strap: {
        origin,
        pairs: sizes.pairs,
        pairsBySize: sizes.pairsBySize,
        metersBySize: sizes.metersBySize,
        fromStockM: fact.fromStockM,
        toMakeM: fact.toMakeM,
        napaM: fact.napaM,
        napaBlockedReason: fact.blockReason,
        lineLabels: label ? [label] : [],
        yieldMPerM: internal && yieldPerMeter > 0 ? yieldPerMeter : null,
      },
    };
    if (partitioned) {
      const refLabel = referenceId ? opts.referenceLabelById?.get(referenceId) : undefined;
      row.saleOrderId = saleOrderId;
      row.referenceId = referenceId;
      row.orderNumber = (saleOrderId && opts.orderNumberBySaleOrderId?.get(saleOrderId)) || null;
      row.referenceCode = refLabel?.code || null;
      row.referenceName = refLabel?.name || null;
    }
    grouped.set(key, row);
  }

  for (const row of grouped.values()) {
    row.materialName = strapMaterialName(row.strap.origin, row.strap.lineLabels);
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
 * Orientação fabril canônica (bloco “Setor de Tiras”, só origem Fazer).
 * `metros_necessarios` = tira A FAZER (depois do estoque de tira pronta, D15);
 * napa = Σ por linha (a fazer ÷ rendimento) — linhas sem snapshot de napa mas
 * com rendimento válido entram; linhas bloqueadas (D9) ficam em grupo próprio
 * com napa “—” e o motivo, sem contaminar as convertíveis.
 */
export function canonicalStrapCutRows(
  previews: CanonicalStrapDemandPreview[],
  opts: { allocateFinishedStock?: boolean; stockOf?: (productId: string) => number | null } = {},
): ArtisanalStrapCutRow[] {
  const grouped = new Map<string, ArtisanalStrapCutRow>();

  deriveStrapLineFacts(collapseDuplicateStaleStrapPreviews(previews), opts)
    .filter((fact) => fact.preview.sourceMode === 'internal' && fact.toMakeM > 0)
    .forEach((fact) => {
      const { preview } = fact;
      const blocked = !!fact.blockReason;
      const key = [
        preview.strapVariantId || preview.technicalStrapLineId,
        preview.colorId || normColorKey(preview.strapColorName) || 'no-color',
        preview.recipeId || 'recipe-unresolved',
        preview.baseProductId || 'base-unresolved',
        preview.finishedProductId || 'finished-unresolved',
        blocked ? 'napa-blocked' : 'napa-ok',
      ].join('::');
      const napa = fact.napaM ?? 0;
      const bandWidth = Math.max(0, finiteOrZero(preview.cutBandWidthMm));
      const yieldPerMeter = Math.max(0, finiteOrZero(preview.confirmedYieldMPerM));
      const usableWidth = Math.max(0, finiteOrZero(preview.usableBaseWidthMm));
      const theoreticalYield = Math.max(0, finiteOrZero(preview.theoreticalYieldMPerM));
      const transformationCostPerM = preview.transformationCostPerM;
      const existing = grouped.get(key);

      if (existing?.canonical) {
        existing.metros_necessarios += fact.toMakeM;
        existing.canonical.baseRequiredM += napa;
        existing.canonical.fromStockM = (existing.canonical.fromStockM || 0) + fact.fromStockM;
        existing.canonical.blockingReasons = Array.from(new Set([
          ...existing.canonical.blockingReasons,
          ...preview.blockingReasons,
        ]));
        if (blocked && fact.blockReason) {
          existing.canonical.napaBlockReason = Array.from(new Set([
            ...(existing.canonical.napaBlockReason ? existing.canonical.napaBlockReason.split(' · ') : []),
            ...fact.blockReason.split(' · '),
          ])).join(' · ');
        }
        // R$/m é taxa da receita — não soma na agregação. Preenche se a 1ª
        // linha veio sem financeiro e uma posterior trouxe o custo.
        if (existing.canonical.transformationCostPerM == null && transformationCostPerM != null) {
          existing.canonical.transformationCostPerM = transformationCostPerM;
        }
        if (preview.snapshotWarning) existing.canonical.snapshotWarning = preview.snapshotWarning;
        if (!existing.measureId && preview.measureId) existing.measureId = preview.measureId;
        if (!existing.measureName && preview.measureName) existing.measureName = preview.measureName;
        if (!existing.typeId && preview.typeId) existing.typeId = preview.typeId;
        if (!existing.baseGroupId && preview.baseGroupId) existing.baseGroupId = preview.baseGroupId;
        return;
      }

      grouped.set(key, {
        key,
        groupName: formatCanonicalStrapProductName(preview),
        color: preview.strapColorName || '—',
        largura_mm: bandWidth,
        metros_necessarios: fact.toMakeM,
        baseName: resolveStrapBaseFamilyName(preview) || undefined,
        measureId: preview.measureId || undefined,
        measureName: preview.measureName || undefined,
        typeId: preview.typeId || undefined,
        baseGroupId: preview.baseGroupId || undefined,
        cut: canonicalCutPlaceholder(bandWidth, preview.blockingReasons.join(' · ') || undefined),
        canonical: {
          recipeId: preview.recipeId,
          baseRequiredM: napa,
          confirmedYieldMPerM: yieldPerMeter,
          usableBaseWidthMm: usableWidth,
          theoreticalYieldMPerM: theoreticalYield,
          transformationCostPerM,
          blockingReasons: [...preview.blockingReasons],
          napaBlocked: blocked,
          napaBlockReason: fact.blockReason,
          fromStockM: fact.fromStockM,
          ...(preview.snapshotWarning ? { snapshotWarning: preview.snapshotWarning } : {}),
        },
      });
    });

  return [...grouped.values()].sort((a, b) =>
    a.groupName.localeCompare(b.groupName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'));
}

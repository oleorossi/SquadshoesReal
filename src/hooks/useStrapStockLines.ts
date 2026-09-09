import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { napaDisplayName, type StrapSourceMode, type StrapSourcingMap } from '@/lib/strapSourcing';
import { technicalStrapLineId } from '@/lib/technicalStrapLines';

export interface StrapStockLine {
  key: string;
  technicalStrapLineId: string;
  strapVariantId: string | null;
  colorId: string | null;
  baseGroupId: string | null;
  baseGroupName?: string | null;
  recipeId: string | null;
  baseProductId: string | null;
  finishedProductId: string | null;
  sourceMode: StrapSourceMode | null;
  strapProductName: string;
  strapColor: string;
  strapRequiredM: number;
  napaProductName: string | null;
  yieldPerMeter: number | null;
  napaRequiredM: number | null;
  purchasePrice: number | null;
  internalUnitCost: number | null;
  canInternal: boolean;
  canBuyReady: boolean;
  canConsumeFinishedStock: boolean;
  internalBlockReason: string | null;
  buyReadyBlockReason: string | null;
  requiredAt: string | null;
  mainProductionStart: string | null;
  scheduleRevision: number | null;
  blockingReasons: string[];
  snapshotWarning?: string | null;
  blockReason: string | null;
}

type RpcResult = Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc = (fn: string, args: Record<string, unknown>): RpcResult =>
  (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => RpcResult }).rpc(fn, args);

interface StrapColorEntry {
  id?: string | null;
  technical_strap_line_id?: string | null;
  strap_type_id?: string | null;
  measure_id?: string | null;
  color_id?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  label?: string | null;
  color?: string | null;
  consumption?: number | null;
  consumption_per_size?: Record<string, number> | null;
}

type RpcRow = Record<string, unknown>;
const str = (value: unknown): string => value == null ? '' : String(value);
const strOrNull = (value: unknown): string | null => value == null || value === '' ? null : String(value);
const numOrNull = (value: unknown): number | null =>
  value != null && Number.isFinite(Number(value)) ? Number(value) : null;

function parseBlockingReasons(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? str((entry as Record<string, unknown>).message || (entry as Record<string, unknown>).reason || (entry as Record<string, unknown>).code)
          : '')
      .filter(Boolean);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.entries(record)
      .filter(([, enabled]) => enabled !== false && enabled != null)
      .map(([code, detail]) => typeof detail === 'string' ? detail : code);
  }
  return value ? [str(value)] : [];
}

export interface StrapStockLinesInput {
  /** Chave estável do item no batch (id persistido ou clientKey). */
  itemKey?: string | null;
  saleOrderId?: string | null;
  saleOrderItemId?: string | null;
  referenceId: string | null | undefined;
  materialVariantId?: string | null;
  itemColor?: string | null;
  strapColors: unknown;
  strapSourcing?: StrapSourcingMap | null;
  quantity: number | null | undefined;
  grade: Record<string, number> | null | undefined;
  billingWeek?: string | null;
  mainProductionStart?: string | null;
  requiredAt?: string | null;
  scheduleRevision?: number | null;
}

function cacheKey(input: StrapStockLinesInput): string {
  return JSON.stringify({
    itemKey: input.itemKey || null,
    referenceId: input.referenceId || null,
    saleOrderId: input.saleOrderId || null,
    saleOrderItemId: input.saleOrderItemId || null,
    materialVariantId: input.materialVariantId || null,
    itemColor: input.itemColor || null,
    quantity: Number(input.quantity) || 0,
    grade: input.grade || null,
    strapColors: input.strapColors || [],
    strapSourcing: input.strapSourcing || {},
    billingWeek: input.billingWeek || null,
    mainProductionStart: input.mainProductionStart || null,
    requiredAt: input.requiredAt || null,
    scheduleRevision: input.scheduleRevision || 0,
  });
}

/** Debounce só de grade/qty — ref/cor/sourcing mudam com menos frequência e
 *  devem refetch na hora; digitar grade não deve disparar RPC a cada tecla. */
function useDebouncedGradeQuantity(
  grade: StrapStockLinesInput['grade'],
  quantity: StrapStockLinesInput['quantity'],
  ms = 400,
): { grade: StrapStockLinesInput['grade']; quantity: StrapStockLinesInput['quantity'] } {
  const [debounced, setDebounced] = useState({ grade, quantity });
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced({ grade, quantity }), ms);
    return () => window.clearTimeout(t);
  }, [grade, quantity, ms]);
  return debounced;
}

function buildPreviewPayload(input: StrapStockLinesInput, straps: StrapColorEntry[]) {
  return {
    item_key: input.itemKey || input.saleOrderItemId || null,
    reference_id: input.referenceId,
    sale_order_id: input.saleOrderId || null,
    sale_order_item_id: input.saleOrderItemId || null,
    material_variant_id: input.materialVariantId || null,
    color: input.itemColor || null,
    quantity: Number(input.quantity) || 0,
    grade: input.grade || {},
    strap_colors: straps,
    strap_sourcing: input.strapSourcing || {},
    billing_week: input.billingWeek || null,
    main_production_start: input.mainProductionStart || null,
    required_at: input.requiredAt || null,
    schedule_revision: input.scheduleRevision || 0,
  };
}

export function parseStrapStockLines(
  data: unknown,
  straps: StrapColorEntry[],
): StrapStockLine[] {
  return ((data || []) as RpcRow[]).map((row, index) => {
    const ordinal = Math.max(0, Number(row.line_ordinal) || index + 1) - 1;
    const source = straps[ordinal] || straps[index] || {};
    const resolved = row.resolved && typeof row.resolved === 'object'
      ? row.resolved as Record<string, unknown>
      : {};
    const catalog = resolved.catalog && typeof resolved.catalog === 'object'
      ? resolved.catalog as Record<string, unknown>
      : {};
    const availability = catalog.source_availability
      && typeof catalog.source_availability === 'object'
      ? catalog.source_availability as Record<string, unknown>
      : {};
    const lineId = strOrNull(row.technical_strap_line_id) || technicalStrapLineId(source) || `invalid-${index}`;
    const sourceMode = row.source_mode === 'internal' || row.source_mode === 'buy_ready'
      ? row.source_mode
      : null;
    const blockingReasons = parseBlockingReasons(row.blocking_reasons);
    const strapColor = str(resolved.strap_color_name || resolved.color_name || source.color);
    const baseName = strOrNull(resolved.base_product_name);

    return {
      key: lineId,
      technicalStrapLineId: lineId,
      strapVariantId: strOrNull(row.strap_variant_id),
      colorId: strOrNull(resolved.color_id || catalog.color_id || source.color_id),
      baseGroupId: strOrNull(resolved.base_group_id || catalog.base_group_id),
      baseGroupName: strOrNull(resolved.base_group_name || catalog.base_group_name),
      recipeId: strOrNull(row.recipe_id),
      baseProductId: strOrNull(row.base_product_id),
      finishedProductId: strOrNull(row.finished_product_id),
      sourceMode,
      strapProductName: str(resolved.strap_product_name || resolved.finished_product_name || source.label) || 'Tira',
      strapColor,
      strapRequiredM: Number(row.gross_required_m) || 0,
      napaProductName: baseName ? napaDisplayName(baseName, strapColor) : null,
      yieldPerMeter: numOrNull(resolved.confirmed_yield_m_per_m || resolved.confirmed_yield),
      napaRequiredM: numOrNull(resolved.base_required_m),
      purchasePrice: numOrNull(resolved.purchase_price),
      internalUnitCost: numOrNull(resolved.internal_unit_cost),
      canInternal: resolved.can_internal === true,
      canBuyReady: resolved.can_buy_ready === true,
      canConsumeFinishedStock: catalog.finished_stock_consumption_allowed === true,
      internalBlockReason: strOrNull(availability.internal_block_reason),
      buyReadyBlockReason: strOrNull(availability.buy_ready_block_reason),
      requiredAt: strOrNull(resolved.required_at),
      mainProductionStart: strOrNull(resolved.main_production_start),
      scheduleRevision: numOrNull(resolved.schedule_revision),
      blockingReasons,
      snapshotWarning: strOrNull(resolved.snapshot_warning),
      blockReason: blockingReasons[0] || null,
    };
  });
}

/** Chave estável do item no mapa batch (id persistido ou clientKey). */
export function strapStockLinesItemKey(input: {
  saleOrderItemId?: string | null;
  clientKey?: string | null;
  itemKey?: string | null;
}): string | null {
  return input.itemKey || input.saleOrderItemId || input.clientKey || null;
}

export function useStrapStockLines(input: StrapStockLinesInput, enabled = true) {
  const straps = Array.isArray(input.strapColors) ? input.strapColors as StrapColorEntry[] : [];
  const hasStraps = straps.some((strap) => !!technicalStrapLineId(strap));
  const debounced = useDebouncedGradeQuantity(input.grade, input.quantity, 400);
  const queryInput: StrapStockLinesInput = {
    ...input,
    grade: debounced.grade,
    quantity: debounced.quantity,
  };

  return useQuery<StrapStockLine[]>({
    queryKey: ['strap_stock_lines_preview', cacheKey(queryInput)],
    enabled: enabled && !!input.referenceId && hasStraps,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    meta: { silentError: true },
    queryFn: async () => {
      const { data, error } = await rpc('preview_sale_order_strap_demand_draft', {
        p_item: buildPreviewPayload(queryInput, straps),
      });
      if (error) throw error;
      return parseStrapStockLines(data, straps);
    },
  });
}

/**
 * Um RPC para todos os itens com tiras do editor. O painel chama; cada item
 * lê `map.get(strapStockLinesItemKey(...))`.
 */
export function useStrapStockLinesBatch(
  inputs: StrapStockLinesInput[],
  enabled = true,
) {
  // Debounce grade/qty de TODOS os itens juntos — digitação na grade não
  // dispara N× batch a cada tecla.
  const gradeQtySig = useMemo(
    () => inputs.map((input) => JSON.stringify({
      k: strapStockLinesItemKey({
        itemKey: input.itemKey,
        saleOrderItemId: input.saleOrderItemId,
      }),
      q: Number(input.quantity) || 0,
      g: input.grade || null,
    })).join(';'),
    [inputs],
  );
  const [debouncedSig, setDebouncedSig] = useState(gradeQtySig);
  const [debouncedInputs, setDebouncedInputs] = useState(inputs);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSig(gradeQtySig);
      setDebouncedInputs(inputs);
    }, 400);
    return () => window.clearTimeout(t);
  }, [gradeQtySig, inputs]);

  // Enquanto o debounce não aplica, usa o último payload estável — mas se a
  // identidade estrutural mudou (ref/cor/sourcing), aplica na hora.
  const structuralSig = useMemo(
    () => inputs.map((input) => JSON.stringify({
      k: strapStockLinesItemKey({
        itemKey: input.itemKey,
        saleOrderItemId: input.saleOrderItemId,
      }),
      r: input.referenceId || null,
      v: input.materialVariantId || null,
      c: input.itemColor || null,
      sc: input.strapColors || [],
      ss: input.strapSourcing || {},
      bw: input.billingWeek || null,
      mps: input.mainProductionStart || null,
      ra: input.requiredAt || null,
      sr: input.scheduleRevision || 0,
      so: input.saleOrderId || null,
    })).join(';'),
    [inputs],
  );
  const [lastStructural, setLastStructural] = useState(structuralSig);
  const effectiveInputs = structuralSig !== lastStructural
    ? inputs
    : (debouncedSig === gradeQtySig ? inputs : debouncedInputs);
  useEffect(() => {
    if (structuralSig !== lastStructural) setLastStructural(structuralSig);
  }, [structuralSig, lastStructural]);

  const payload = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<ReturnType<typeof buildPreviewPayload> & { item_key: string }> = [];
    const strapsByKey = new Map<string, StrapColorEntry[]>();
    for (const input of effectiveInputs) {
      const key = strapStockLinesItemKey({
        itemKey: input.itemKey,
        saleOrderItemId: input.saleOrderItemId,
      });
      if (!key || !input.referenceId || seen.has(key)) continue;
      const straps = Array.isArray(input.strapColors)
        ? input.strapColors as StrapColorEntry[]
        : [];
      if (!straps.some((strap) => !!technicalStrapLineId(strap))) continue;
      seen.add(key);
      const row = buildPreviewPayload({ ...input, itemKey: key }, straps);
      items.push({ ...row, item_key: key });
      strapsByKey.set(key, straps);
    }
    items.sort((a, b) => a.item_key.localeCompare(b.item_key));
    return { items, strapsByKey };
  }, [effectiveInputs]);

  const payloadKey = useMemo(
    () => payload.items.map((row) => cacheKey({
      itemKey: row.item_key,
      saleOrderId: row.sale_order_id as string | null,
      saleOrderItemId: row.sale_order_item_id as string | null,
      referenceId: row.reference_id as string | null,
      materialVariantId: row.material_variant_id as string | null,
      itemColor: row.color as string | null,
      strapColors: row.strap_colors,
      strapSourcing: row.strap_sourcing as StrapSourcingMap,
      quantity: row.quantity as number,
      grade: row.grade as Record<string, number>,
      billingWeek: row.billing_week as string | null,
      mainProductionStart: row.main_production_start as string | null,
      requiredAt: row.required_at as string | null,
      scheduleRevision: row.schedule_revision as number,
    })).join('||'),
    [payload],
  );

  return useQuery<ReadonlyMap<string, StrapStockLine[]>>({
    queryKey: ['strap_stock_lines_preview_batch', payloadKey],
    enabled: enabled && payload.items.length > 0,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    meta: { silentError: true },
    queryFn: async () => {
      const { data, error } = await rpc('preview_sale_order_strap_demand_draft_batch', {
        p_items: payload.items,
      });
      if (error) throw error;

      const map = new Map<string, StrapStockLine[]>();
      const row = (data || {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(row)) {
        const straps = payload.strapsByKey.get(key) || [];
        map.set(key, parseStrapStockLines(value, straps));
      }
      for (const item of payload.items) {
        if (!map.has(item.item_key)) map.set(item.item_key, []);
      }
      return map;
    },
  });
}

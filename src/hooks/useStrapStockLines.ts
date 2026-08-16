import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { napaDisplayName, type StrapSourceMode, type StrapSourcingMap } from '@/lib/strapSourcing';
import { technicalStrapLineId } from '@/lib/technicalStrapLines';

export interface StrapStockLine {
  key: string;
  technicalStrapLineId: string;
  strapVariantId: string | null;
  colorId: string | null;
  baseGroupId: string | null;
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

export function useStrapStockLines(input: StrapStockLinesInput, enabled = true) {
  const straps = Array.isArray(input.strapColors) ? input.strapColors as StrapColorEntry[] : [];
  const hasStraps = straps.some((strap) => !!technicalStrapLineId(strap));

  return useQuery<StrapStockLine[]>({
    queryKey: ['strap_stock_lines_preview', cacheKey(input)],
    enabled: enabled && !!input.referenceId && hasStraps,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await rpc('preview_sale_order_strap_demand_draft', {
        p_item: {
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
        },
      });
      if (error) throw error;

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
          blockReason: blockingReasons[0] || null,
        };
      });
    },
  });
}

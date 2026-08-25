import { supabase } from '@/integrations/supabase/client';
import {
  fetchConsumptionContext,
  computeConsumptionForItems,
  TECHNICAL_SHEET_CONSUMPTION_COLUMNS,
  type ConsumptionItem,
} from '@/lib/orderConsumption';
import { annotateConsumptionAvailability, type ConsumptionRow } from '@/lib/consumptionRows';
import {
  parseCanonicalStrapDemandPreview,
  type CanonicalStrapDemandPreview,
} from '@/lib/canonicalStrapDemandPreview';
import type { OrderHeader } from '@/components/sale-orders/MaterialConsumptionView';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';

export type PvConsumptionResult = {
  rows: ConsumptionRow[];
  artisanalStrapRows: ArtisanalStrapCutRow[];
  orderHeaders: OrderHeader[];
};

/** Cache curto: o prefetch ao abrir o PV ainda vale quando o operador clica Consumo. */
export const PV_CONSUMPTION_STALE_MS = 2 * 60 * 1000;

export function normalizePvConsumptionIds(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function pvConsumptionQueryKey(ids: string[]) {
  return ['pv-consumption', normalizePvConsumptionIds(ids).sort().join(',')] as const;
}

/**
 * Carga canônica do consumo de 1..N PVs — a mesma função alimenta a página
 * `?view=consumo`, o diálogo do PV e o prefetch ao abrir o detalhe.
 */
export async function loadPvConsumption(ids: string[]): Promise<PvConsumptionResult> {
  const uniqueIds = normalizePvConsumptionIds(ids);
  if (uniqueIds.length === 0) {
    return { rows: [], artisanalStrapRows: [], orderHeaders: [] };
  }

  const [
    { data: items, error: itemsError },
    { data: saleOrders, error: saleOrdersError },
  ] = await Promise.all([
    supabase
      .from('sale_order_items')
      .select(`
        sale_order_id,
        reference_id,
        color,
        quantity,
        grade,
        fichas,
        strap_colors,
        material_variant_id,
        technical_sheets(${TECHNICAL_SHEET_CONSUMPTION_COLUMNS})
      `)
      .in('sale_order_id', uniqueIds),
    supabase
      .from('sale_orders')
      .select('id, order_number, client_order_number, packaging_mode')
      .in('id', uniqueIds),
  ]);

  if (itemsError) throw itemsError;
  if (saleOrdersError) throw saleOrdersError;

  const orderHeaders: OrderHeader[] = (saleOrders || []).map((so: { order_number: string; client_order_number: string | null }) => ({
    order_number: so.order_number,
    client_order_number: so.client_order_number,
  }));

  if (!items || items.length === 0) {
    return { rows: [], artisanalStrapRows: [], orderHeaders };
  }

  const packagingModeByOrder = new Map<string, string | null>(
    (saleOrders || []).map((so: { id: string; packaging_mode: string | null }) => [so.id, so.packaging_mode ?? null]),
  );

  const refIds = [...new Set(items.map((i: { reference_id: string | null }) => i.reference_id).filter(Boolean))] as string[];
  const [ctx, previewResults] = await Promise.all([
    fetchConsumptionContext(refIds),
    Promise.all(uniqueIds.map((saleOrderId) =>
      (supabase as any).rpc('preview_sale_order_strap_demand', {
        p_sale_order_id: saleOrderId,
      }))),
  ]);

  const strapPreviews: CanonicalStrapDemandPreview[] = [];
  for (const result of previewResults as Array<{ data?: unknown; error?: { message?: string } | null }>) {
    if (result.error) throw result.error;
    for (const value of (Array.isArray(result.data) ? result.data : []) as Record<string, unknown>[]) {
      const parsed = parseCanonicalStrapDemandPreview(value);
      // A própria ausência da linha técnica é uma pendência canônica devolvida
      // pela RPC. Mantê-la no fluxo impede que outra tira já resolvida do mesmo
      // PV faça a demanda bloqueada desaparecer da tela.
      strapPreviews.push(parsed);
    }
  }

  const itemsWithMode = (items as Array<{ sale_order_id: string }>).map((it) => ({
    ...it,
    packagingMode: packagingModeByOrder.get(it.sale_order_id) ?? null,
  }));

  const computed = computeConsumptionForItems(
    itemsWithMode as unknown as ConsumptionItem[],
    ctx,
  );
  const { rows, artisanalStrapRows } =
    await annotateConsumptionAvailability(computed, ctx, strapPreviews);

  return { rows, artisanalStrapRows, orderHeaders };
}

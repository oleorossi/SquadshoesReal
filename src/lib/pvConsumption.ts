import { supabase } from '@/integrations/supabase/client';
import {
  fetchCanonicalConsumptionReport,
  materializeCanonicalConsumptionReport,
} from '@/lib/canonicalConsumptionReport';
import type { ConsumptionRow } from '@/lib/consumptionRows';
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
 * Carga canônica do consumo de 1..N PVs — a mesma função alimenta a página,
 * o diálogo e o prefetch. Quantidade/identidade vêm da RPC SQL compartilhada
 * com reserva, baixa, custeio, MRP e compra; TS só adapta e lê estoque atual.
 */
export async function loadPvConsumption(ids: string[]): Promise<PvConsumptionResult> {
  const uniqueIds = normalizePvConsumptionIds(ids);
  if (uniqueIds.length === 0) {
    return { rows: [], artisanalStrapRows: [], orderHeaders: [] };
  }

  const [report, { data: saleOrders, error: saleOrdersError }] = await Promise.all([
    fetchCanonicalConsumptionReport({ saleOrderIds: uniqueIds }),
    supabase
      .from('sale_orders')
      .select('id, order_number, client_order_number, packaging_mode')
      .in('id', uniqueIds),
  ]);

  if (saleOrdersError) throw saleOrdersError;

  const orderHeaders: OrderHeader[] = (saleOrders || []).map((so: { order_number: string; client_order_number: string | null }) => ({
    order_number: so.order_number,
    client_order_number: so.client_order_number,
  }));

  const { rows, artisanalStrapRows } =
    await materializeCanonicalConsumptionReport(report);

  return { rows, artisanalStrapRows, orderHeaders };
}

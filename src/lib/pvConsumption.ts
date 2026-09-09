import { supabase } from '@/integrations/supabase/client';
import {
  fetchCanonicalConsumptionReport,
  materializeCanonicalConsumptionReport,
  type AdaptCanonicalOptions,
  type CanonicalConsumptionReport,
} from '@/lib/canonicalConsumptionReport';
import type { ConsumptionRow } from '@/lib/consumptionRows';
import type { OrderHeader } from '@/components/sale-orders/MaterialConsumptionView';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';

export type PvConsumptionItem = {
  id: string;
  saleOrderId: string;
  orderNumber: string;
  /** 1-based index within the PV (ordem created_at). */
  index: number;
  referenceId: string | null;
  referenceCode: string;
  referenceName: string | null;
  color: string;
  quantity: number;
};

export type PvConsumptionResult = {
  rows: ConsumptionRow[];
  artisanalStrapRows: ArtisanalStrapCutRow[];
  orderHeaders: OrderHeader[];
  /** Relatório bruto — permite reescopar por item sem nova RPC. */
  report: CanonicalConsumptionReport | null;
  items: PvConsumptionItem[];
  /** Mapas de identidade pra rematerializar o modo "Por PV e modelo". */
  identity: AdaptCanonicalOptions;
  /** Há mais de um PV ou mais de um modelo no escopo → vale o seletor estendido. */
  canPartitionByOrderReference: boolean;
};

/** Cache curto: o prefetch ao abrir o PV ainda vale quando o operador clica Consumo. */
export const PV_CONSUMPTION_STALE_MS = 2 * 60 * 1000;

export function normalizePvConsumptionIds(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function pvConsumptionQueryKey(ids: string[]) {
  return ['pv-consumption', normalizePvConsumptionIds(ids).sort().join(',')] as const;
}

export function pvConsumptionItemLabel(
  item: PvConsumptionItem,
  opts?: { multiPv?: boolean },
): string {
  const code = item.referenceCode || item.referenceName || 'SEM REF';
  const color = (item.color || '').trim() || 'SEM COR';
  const base = `Item ${item.index} · ${code} · ${color}`;
  if (opts?.multiPv) return `${item.orderNumber} · ${base}`;
  return base;
}

type SaleOrderHeaderRow = {
  id: string;
  order_number: string;
  client_order_number: string | null;
  packaging_mode: string | null;
};

type SaleOrderItemRow = {
  id: string;
  sale_order_id: string;
  color: string | null;
  quantity: number | null;
  created_at: string | null;
  technical_sheets: {
    id: string | null;
    code: string | null;
    name: string | null;
  } | {
    id: string | null;
    code: string | null;
    name: string | null;
  }[] | null;
};

function sheetFields(
  sheet: SaleOrderItemRow['technical_sheets'],
): { id: string | null; code: string; name: string | null } {
  const row = Array.isArray(sheet) ? sheet[0] : sheet;
  return {
    id: row?.id?.trim() || null,
    code: (row?.code || '').trim(),
    name: row?.name?.trim() || null,
  };
}

function buildPvConsumptionItems(
  itemRows: SaleOrderItemRow[],
  orderById: Map<string, SaleOrderHeaderRow>,
): PvConsumptionItem[] {
  const byOrder = new Map<string, SaleOrderItemRow[]>();
  for (const row of itemRows) {
    const list = byOrder.get(row.sale_order_id) || [];
    list.push(row);
    byOrder.set(row.sale_order_id, list);
  }

  const items: PvConsumptionItem[] = [];
  for (const [saleOrderId, list] of byOrder) {
    const ordered = [...list].sort((a, b) => {
      const ta = a.created_at || '';
      const tb = b.created_at || '';
      if (ta !== tb) return ta.localeCompare(tb);
      return a.id.localeCompare(b.id);
    });
    const orderNumber = orderById.get(saleOrderId)?.order_number || 'PV';
    ordered.forEach((row, idx) => {
      const sheet = sheetFields(row.technical_sheets);
      items.push({
        id: row.id,
        saleOrderId,
        orderNumber,
        index: idx + 1,
        referenceId: sheet.id,
        referenceCode: sheet.code,
        referenceName: sheet.name,
        color: (row.color || '').trim(),
        quantity: Number(row.quantity) || 0,
      });
    });
  }

  // Ordem estável na UI: por pedido (como veio do select) e índice do item.
  items.sort((a, b) => {
    if (a.orderNumber !== b.orderNumber) return a.orderNumber.localeCompare(b.orderNumber);
    return a.index - b.index;
  });
  return items;
}

export function buildPvConsumptionIdentity(
  items: PvConsumptionItem[],
  orderHeadersById: Map<string, string>,
): AdaptCanonicalOptions {
  const referenceLabelById = new Map<string, { code: string; name: string | null }>();
  for (const item of items) {
    if (!item.referenceId) continue;
    if (referenceLabelById.has(item.referenceId)) continue;
    referenceLabelById.set(item.referenceId, {
      code: item.referenceCode,
      name: item.referenceName,
    });
  }
  return {
    orderNumberBySaleOrderId: orderHeadersById,
    referenceLabelById,
  };
}

export function pvConsumptionCanPartition(items: PvConsumptionItem[]): boolean {
  const orderIds = new Set(items.map((item) => item.saleOrderId));
  const models = new Set(
    items
      .map((item) => item.referenceId || item.referenceCode || item.referenceName)
      .filter((value): value is string => !!value && value.trim().length > 0),
  );
  return orderIds.size > 1 || models.size > 1;
}

/**
 * Materializa o consumo no escopo total ou de um único item do PV.
 * Reusa o report já carregado — sem nova ida ao motor SQL.
 */
export async function materializePvConsumptionScope(
  report: CanonicalConsumptionReport,
  itemId: string | null | undefined,
  opts?: AdaptCanonicalOptions,
): Promise<{ rows: ConsumptionRow[]; artisanalStrapRows: ArtisanalStrapCutRow[] }> {
  if (!itemId) {
    return opts
      ? materializeCanonicalConsumptionReport(report, undefined, opts)
      : materializeCanonicalConsumptionReport(report);
  }
  const scopeKeys = new Set([itemId]);
  return opts
    ? materializeCanonicalConsumptionReport(report, scopeKeys, opts)
    : materializeCanonicalConsumptionReport(report, scopeKeys);
}

/**
 * Carga canônica do consumo de 1..N PVs — a mesma função alimenta a página
 * e o prefetch. Quantidade/identidade vêm da RPC SQL compartilhada com
 * reserva, baixa, custeio, MRP e compra; TS só adapta e lê estoque atual.
 */
export async function loadPvConsumption(ids: string[]): Promise<PvConsumptionResult> {
  const uniqueIds = normalizePvConsumptionIds(ids);
  if (uniqueIds.length === 0) {
    return {
      rows: [],
      artisanalStrapRows: [],
      orderHeaders: [],
      report: null,
      items: [],
      identity: {},
      canPartitionByOrderReference: false,
    };
  }

  const [report, { data: saleOrders, error: saleOrdersError }, { data: saleOrderItems, error: itemsError }] =
    await Promise.all([
      fetchCanonicalConsumptionReport({ saleOrderIds: uniqueIds }),
      supabase
        .from('sale_orders')
        .select('id, order_number, client_order_number, packaging_mode')
        .in('id', uniqueIds),
      supabase
        .from('sale_order_items')
        .select('id, sale_order_id, color, quantity, created_at, technical_sheets(id, code, name)')
        .in('sale_order_id', uniqueIds)
        .order('created_at', { ascending: true }),
    ]);

  if (saleOrdersError) throw saleOrdersError;
  if (itemsError) throw itemsError;

  const orderRows = (saleOrders || []) as SaleOrderHeaderRow[];
  const orderById = new Map(orderRows.map((so) => [so.id, so]));
  const orderNumberById = new Map(orderRows.map((so) => [so.id, so.order_number]));

  const orderHeaders: OrderHeader[] = orderRows.map((so) => ({
    order_number: so.order_number,
    client_order_number: so.client_order_number,
  }));

  const items = buildPvConsumptionItems(
    (saleOrderItems || []) as SaleOrderItemRow[],
    orderById,
  );
  const identity = buildPvConsumptionIdentity(items, orderNumberById);

  const { rows, artisanalStrapRows } =
    await materializeCanonicalConsumptionReport(report);

  return {
    rows,
    artisanalStrapRows,
    orderHeaders,
    report,
    items,
    identity,
    canPartitionByOrderReference: pvConsumptionCanPartition(items),
  };
}

/** URL da tela cheia de consumo (mesma aba / compartilhável). */
export function pvConsumptionPath(ids: string[], itemId?: string | null): string {
  const unique = normalizePvConsumptionIds(ids);
  const params = new URLSearchParams();
  params.set('view', 'consumo');
  if (unique.length > 0) params.set('ids', unique.join(','));
  if (itemId) params.set('item', itemId);
  return `/sales?${params.toString()}`;
}

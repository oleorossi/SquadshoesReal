import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMrpNeeds } from '@/hooks/useMrp';
import {
  FIRM_HORIZON_WEEKS,
  buildCalendarWeeks,
  buildMonthlyEvalRows,
  buildProjectionRow,
  cashTotalsByBuyWeek,
  filterByPeriodMode,
  filterBySectorGroup,
  filterMonthlyRows,
  filterRowsForHorizon,
  type MonthlyEvalRow,
  type PeriodMode,
  type ProjectionWeeklyRow,
} from '@/lib/purchaseProjectionWeekly';
import { sectorOfGroup } from '@/lib/categoryFromGroup';

export interface UsePurchaseProjectionWeeklyParams {
  horizonWeeks?: number;
  sector?: string | null;
  groupId?: string | null;
  periodMode?: PeriodMode;
  onlyOverdue?: boolean;
  onlyGap?: boolean;
  onlyNoPrice?: boolean;
}

interface ProductEnrichment {
  id: string;
  purchase_price: number | null;
  group_id: string | null;
  color: string | null;
  group_name: string | null;
  sector: string | null;
}

interface ProductEnrichRow {
  id: string;
  purchase_price: number | null;
  group_id: string | null;
  color: string | null;
  product_groups:
    | { id: string; name: string | null; sector: string | null }
    | { id: string; name: string | null; sector: string | null }[]
    | null;
}

interface ReceiptInspectRow {
  product_id: string;
  qty_received: number | null;
  qty_approved: number | null;
}

async function fetchProductEnrichment(productIds: string[]): Promise<Map<string, ProductEnrichment>> {
  if (productIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('products')
    .select('id, purchase_price, group_id, color, product_groups(id, name, sector)')
    .in('id', productIds);
  if (error) throw error;
  const map = new Map<string, ProductEnrichment>();
  for (const row of (data || []) as unknown as ProductEnrichRow[]) {
    const g = row.product_groups;
    const group = Array.isArray(g) ? g[0] : g;
    map.set(row.id, {
      id: row.id,
      purchase_price: row.purchase_price ?? null,
      group_id: row.group_id ?? group?.id ?? null,
      color: row.color ?? null,
      group_name: group?.name ?? null,
      sector: group ? sectorOfGroup(group) : null,
    });
  }
  return map;
}

/** Recebimentos recentes (inspeção) para o modo mês — best-effort. */
async function fetchReceivedByProduct(
  productIds: string[],
): Promise<Record<string, { qty: number; brl: number }>> {
  if (productIds.length === 0) return {};
  const since = new Date();
  since.setDate(since.getDate() - 45);
  const { data, error } = await supabase
    .from('goods_receipt_inspections')
    .select('product_id, qty_received, qty_approved, created_at')
    .in('product_id', productIds)
    .gte('created_at', since.toISOString())
    .limit(2000);
  // Tabela pode não existir / RLS — falha silenciosa → received = 0
  if (error) return {};
  const out: Record<string, { qty: number; brl: number }> = {};
  for (const row of (data || []) as unknown as ReceiptInspectRow[]) {
    const id = row.product_id;
    const qty = Number(row.qty_approved ?? row.qty_received) || 0;
    if (!out[id]) out[id] = { qty: 0, brl: 0 };
    out[id].qty += qty;
  }
  return out;
}

export function usePurchaseProjectionWeekly(params: UsePurchaseProjectionWeeklyParams = {}) {
  const horizonWeeks = params.horizonWeeks ?? FIRM_HORIZON_WEEKS;
  const periodMode = params.periodMode ?? 'semana';
  const { data: mrpNeeds = [], isLoading: mrpLoading, isError, error, refetch } = useMrpNeeds();

  const productIds = useMemo(
    () => [...new Set(mrpNeeds.filter((n) => !n.is_packaging).map((n) => n.product_id))],
    [mrpNeeds],
  );
  const productIdsKey = productIds.slice().sort().join(',');

  const enrichQuery = useQuery({
    queryKey: ['purchase-projection-weekly-enrich', productIdsKey],
    enabled: productIds.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchProductEnrichment(productIds),
  });

  const receivedQuery = useQuery({
    queryKey: ['purchase-projection-weekly-received', productIdsKey],
    enabled: productIds.length > 0 && (periodMode === 'mes' || periodMode.startsWith('quinzena')),
    staleTime: 60_000,
    queryFn: () => fetchReceivedByProduct(productIds),
  });

  const weeks = useMemo(
    () => buildCalendarWeeks(horizonWeeks, new Date()),
    [horizonWeeks],
  );

  const allRows: ProjectionWeeklyRow[] = useMemo(() => {
    const enrich = enrichQuery.data ?? new Map();
    return mrpNeeds.map((n) => {
      const e = enrich.get(n.product_id);
      // Spec: R$ = purchase_price do cadastro. Sem cadastro → R$ 0 + alerta.
      const cadastro = e?.purchase_price;
      const purchasePrice = cadastro != null && Number(cadastro) > 0 ? Number(cadastro) : null;

      return buildProjectionRow({
        productId: n.product_id,
        productName: n.product_name,
        sku: n.sku,
        color: e?.color ?? null,
        unit: n.unit || 'un',
        qtyGross: n.projected_demand,
        availableNow: n.available_now,
        qtyOnOrder: n.qty_in_po,
        qtyNet: n.suggested_qty,
        useDate: n.earliest_deadline,
        buyByDate: n.order_by_date,
        leadTimeDays: n.lead_time_days,
        purchasePrice,
        sector: e?.sector ?? n.category ?? null,
        groupId: e?.group_id ?? null,
        groupName: e?.group_name ?? null,
        isPackaging: n.is_packaging,
        isArtisanal: n.is_artisanal,
        isForecast: false,
      });
    });
  }, [mrpNeeds, enrichQuery.data]);

  const filteredRows = useMemo(() => {
    let rows = filterRowsForHorizon(allRows, weeks);
    rows = filterBySectorGroup(rows, params.sector, params.groupId);
    rows = filterByPeriodMode(rows, periodMode, new Date());
    if (params.onlyOverdue) rows = rows.filter((r) => r.overdue);
    if (params.onlyNoPrice) rows = rows.filter((r) => r.noPrice);
    return rows;
  }, [allRows, weeks, params.sector, params.groupId, periodMode, params.onlyOverdue, params.onlyNoPrice]);

  const cashByWeek = useMemo(() => cashTotalsByBuyWeek(filteredRows), [filteredRows]);

  const monthlyRows: MonthlyEvalRow[] = useMemo(() => {
    if (periodMode === 'semana') return [];
    const received = receivedQuery.data ?? {};
    // Preenche R$ recebido com preço de cadastro da linha
    const withBrl: Record<string, { qty: number; brl: number }> = {};
    for (const [id, v] of Object.entries(received)) {
      const row = filteredRows.find((r) => r.productId === id);
      const price = row?.purchasePrice ?? 0;
      withBrl[id] = { qty: v.qty, brl: v.qty * price };
    }
    let rows = buildMonthlyEvalRows(filteredRows, withBrl);
    rows = filterMonthlyRows(rows, {
      onlyOverdue: params.onlyOverdue,
      onlyGap: params.onlyGap,
      onlyNoPrice: params.onlyNoPrice,
    });
    return rows;
  }, [
    periodMode,
    filteredRows,
    receivedQuery.data,
    params.onlyOverdue,
    params.onlyGap,
    params.onlyNoPrice,
  ]);

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; sector: string }>();
    for (const r of allRows) {
      if (r.groupId) {
        map.set(r.groupId, {
          id: r.groupId,
          name: r.groupName || r.groupId,
          sector: r.sector,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [allRows]);

  return {
    weeks,
    rows: filteredRows,
    monthlyRows,
    cashByWeek,
    groups,
    isLoading: mrpLoading || enrichQuery.isLoading,
    isError: isError || enrichQuery.isError,
    error: error || enrichQuery.error,
    refetch,
    horizonWeeks,
  };
}

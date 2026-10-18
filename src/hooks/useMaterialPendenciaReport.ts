import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSaleOrderMaterialShortages } from '@/hooks/useSaleOrderMaterialShortages';
import { useProductSupplySummaryQuery } from '@/hooks/useProductSupplySummary';
import {
  aggregateMaterialPendencias,
  filterPendenciaRows,
  PENDENCIA_ACTIVE_STATUSES,
  type OcCoverageFilter,
  type PendenciaMaterialRow,
  type PendenciaPvMeta,
} from '@/lib/materialPendenciaReport';

export const materialPendenciaReportRoot = ['material-pendencia-report'] as const;

interface ActiveSaleOrderRow {
  id: string;
  order_number: string | null;
  client_name: string | null;
  billing_week: string | null;
  delivery_deadline: string | null;
  status: string | null;
}

async function fetchActiveSaleOrders(): Promise<ActiveSaleOrderRow[]> {
  const { data, error } = await supabase
    .from('sale_orders')
    .select('id, order_number, client_name, billing_week, delivery_deadline, status')
    .in('status', [...PENDENCIA_ACTIVE_STATUSES])
    .order('order_number', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ActiveSaleOrderRow[];
}

export function useActiveSaleOrdersForPendencia() {
  return useQuery({
    queryKey: [...materialPendenciaReportRoot, 'active-pvs'],
    queryFn: fetchActiveSaleOrders,
    staleTime: 30_000,
  });
}

export function useMaterialPendenciaReport(opts?: {
  search?: string;
  coverage?: OcCoverageFilter;
}) {
  const activeQ = useActiveSaleOrdersForPendencia();
  const pvIds = useMemo(() => (activeQ.data ?? []).map((o) => o.id), [activeQ.data]);

  const shortagesQ = useSaleOrderMaterialShortages(pvIds, { refetchInterval: 60_000 });

  const productIds = useMemo(() => {
    const ids = new Set<string>();
    for (const info of shortagesQ.data?.values() ?? []) {
      for (const line of info.shortages) {
        if (line.product_id) ids.add(line.product_id);
      }
    }
    return [...ids];
  }, [shortagesQ.data]);

  const supplyQ = useProductSupplySummaryQuery(productIds);

  const pvMetaById = useMemo(() => {
    const map = new Map<string, PendenciaPvMeta>();
    for (const o of activeQ.data ?? []) {
      map.set(o.id, {
        id: o.id,
        orderNumber: o.order_number,
        clientName: o.client_name,
        billingWeek: o.billing_week,
        deliveryDeadline: o.delivery_deadline,
        status: o.status,
      });
    }
    return map;
  }, [activeQ.data]);

  const emCompraByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const [id, s] of supplyQ.supply) map.set(id, s.emCompra);
    return map;
  }, [supplyQ.supply]);

  const allRows = useMemo((): PendenciaMaterialRow[] => {
    if (!shortagesQ.data) return [];
    return aggregateMaterialPendencias(shortagesQ.data, pvMetaById, emCompraByProduct);
  }, [shortagesQ.data, pvMetaById, emCompraByProduct]);

  const rows = useMemo(
    () => filterPendenciaRows(allRows, { search: opts?.search, coverage: opts?.coverage }),
    [allRows, opts?.search, opts?.coverage],
  );

  const isLoading = activeQ.isLoading || (pvIds.length > 0 && shortagesQ.isLoading);
  const isError = activeQ.isError;

  return {
    rows,
    allRows,
    activePvCount: pvIds.length,
    isLoading,
    isError,
    error: activeQ.error,
    refetch: async () => {
      await Promise.all([activeQ.refetch(), shortagesQ.refetch()]);
    },
    supplyAvailable: supplyQ.available,
  };
}

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const EMPTY_MIN_BILLING_MAP: Map<string, string> = new Map();
const EMPTY_STALE_IDS: string[] = [];

export { EMPTY_MIN_BILLING_MAP, EMPTY_STALE_IDS };

/**
 * Lookup batch de min_billing_date pra PVs ativos via cache RPC.
 * Spec: nunca recalcular no caminho crítico da lista.
 */
export function useMinBillingMap(activeIds: string[]) {
  const ids = useMemo(() => [...activeIds].sort(), [activeIds]);
  return useQuery<{ map: Map<string, string>; staleIds: string[] }>({
    queryKey: ['sale_order_min_billing_map', ids],
    queryFn: async () => {
      const map = new Map<string, string>();
      const staleIds: string[] = [];
      if (ids.length === 0) return { map, staleIds };
      const { data, error } = await supabase
        .rpc('get_min_billing_cached' as any, { p_sale_order_ids: ids });
      if (error || !data) return { map, staleIds };
      for (const row of data as any[]) {
        if (row.sale_order_id && row.min_billing_date) {
          map.set(row.sale_order_id, row.min_billing_date);
        }
        if (row.sale_order_id && row.stale) staleIds.push(row.sale_order_id);
      }
      return { map, staleIds };
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

/** Recalcula em segundo plano o que o cache marcou como velho. */
export function useRefreshMinBillingInBackground(staleIds: string[]) {
  const qc = useQueryClient();
  const key = staleIds.join(',');
  useEffect(() => {
    if (!staleIds.length) return;
    let cancelled = false;
    (async () => {
      const { error } = await supabase.rpc('refresh_min_billing_cache' as any, {
        p_sale_order_ids: staleIds,
      });
      if (!cancelled && !error) {
        qc.invalidateQueries({ queryKey: ['sale_order_min_billing_map'] });
      }
    })();
    return () => { cancelled = true; };
    // `key` estabiliza a lista de ids; `staleIds` muda de referência a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, qc]);
}

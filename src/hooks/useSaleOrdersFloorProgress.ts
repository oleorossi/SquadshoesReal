import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Linha de `get_sale_orders_floor_progress(uuid[])`. */
export interface SaleOrderFloorProgress {
  sale_order_id: string;
  completed: number;
  in_progress: number;
  total: number;
  current_sector: string | null;
  ops_active: number;
  ops_done: number;
}

export const saleOrdersFloorProgressKey = (ids: string[]) =>
  ['sale_orders_floor_progress', [...ids].sort().join(',')] as const;

export const SALE_ORDERS_FLOOR_PROGRESS_ROOT = ['sale_orders_floor_progress'] as const;

const EMPTY_MAP = new Map<string, SaleOrderFloorProgress>();

/** Status comerciais que mostram progresso de chão na lista. */
export function saleOrderShowsFloorProgress(status: string | null | undefined): boolean {
  return status === 'Aprovado' || status === 'Em Produção';
}

/** Rótulo `n/m · Setor` (ou só `n/m` se tudo concluído). */
export function formatFloorProgressLabel(
  progress: Pick<SaleOrderFloorProgress, 'completed' | 'total' | 'current_sector'> | null | undefined,
): string | null {
  if (!progress || !progress.total) return null;
  const nm = `${progress.completed}/${progress.total}`;
  if (progress.current_sector) return `${nm} · ${progress.current_sector}`;
  return nm;
}

/**
 * Progresso de setor (order_stages) em lote para a lista de PVs.
 * Uma RPC — sem N+1. PVs sem OP ativa não entram no mapa.
 */
export function useSaleOrdersFloorProgress(ids: string[] | undefined) {
  const sortedKey = useMemo(() => {
    if (!ids || ids.length === 0) return '';
    return [...new Set(ids.filter(Boolean))].sort().join(',');
  }, [ids]);

  const idList = useMemo(
    () => (sortedKey ? sortedKey.split(',') : []),
    [sortedKey],
  );

  return useQuery({
    queryKey: saleOrdersFloorProgressKey(idList),
    enabled: idList.length > 0,
    queryFn: async (): Promise<Map<string, SaleOrderFloorProgress>> => {
      const { data, error } = await supabase.rpc(
        'get_sale_orders_floor_progress' as never,
        { p_sale_order_ids: idList } as never,
      );
      if (error) throw error;
      const map = new Map<string, SaleOrderFloorProgress>();
      for (const row of (data ?? []) as SaleOrderFloorProgress[]) {
        map.set(row.sale_order_id, {
          sale_order_id: row.sale_order_id,
          completed: Number(row.completed) || 0,
          in_progress: Number(row.in_progress) || 0,
          total: Number(row.total) || 0,
          current_sector: row.current_sector ?? null,
          ops_active: Number(row.ops_active) || 0,
          ops_done: Number(row.ops_done) || 0,
        });
      }
      return map;
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export { EMPTY_MAP as EMPTY_FLOOR_PROGRESS_MAP };

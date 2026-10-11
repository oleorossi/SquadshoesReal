import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Rastreio de entradas do grupo de estoque — `list_group_stock_tracking`
 * (spec `specs/integracao-estoque-pv-compras.md`, Q20).
 *
 * Cada linha é uma ENTRADA (`stock_movements.movement_type = 'in'`) de um item do
 * grupo, com o rateio que ela fez para os PVs em falta. O que sobra
 * (`quantity − allocated_qty`) ficou livre no estoque.
 *
 * ⚠ A RPC fica FORA dos tipos gerados e pode ainda não existir no banco. A query
 * DEGRADA EM SILÊNCIO: erro → `isError` na query (a aba mostra "Rastreio
 * indisponível"), sem retry e sem toast — o "sem toast" depende de
 * `meta: { silentError: true }`; sem ela o `QueryCache.onError` global (App.tsx)
 * tostaria "Falha ao carregar dados" (PGRST202 não é erro de auth nem PGRST002).
 */

export interface GroupStockTrackingAllocation {
  sale_order_id: string | null;
  order_number: string | null;
  client_name: string | null;
  /** Solado: numeração/balde (`"35"`, `"33/34"`). Null fora de solado. */
  size_key: string | null;
  quantity: number;
}

export interface GroupStockTrackingRow {
  stock_movement_id: string;
  created_at: string;
  product_id: string;
  product_name: string;
  color: string | null;
  unit: string | null;
  quantity: number;
  /** `movement_reason` / `origin_type` cru (ex.: `compra`, `ajuste`, `estorno`). */
  origin: string;
  description: string | null;
  allocations: GroupStockTrackingAllocation[];
  allocated_qty: number;
}

/** Raiz da query key — quem dá entrada ou edita rateio pode invalidar por ela. */
export const GROUP_STOCK_TRACKING_KEY = 'group-stock-tracking';

interface RawRow {
  stock_movement_id: string;
  created_at: string;
  product_id: string;
  product_name: string | null;
  color: string | null;
  unit: string | null;
  quantity: number | string | null;
  origin: string | null;
  description: string | null;
  allocations: unknown;
  allocated_qty: number | string | null;
}

function parseAllocations(raw: unknown): GroupStockTrackingAllocation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      sale_order_id: (a.sale_order_id as string | null) ?? null,
      order_number: (a.order_number as string | null) ?? null,
      client_name: (a.client_name as string | null) ?? null,
      size_key: a.size_key == null || a.size_key === '' ? null : String(a.size_key),
      quantity: Number(a.quantity) || 0,
    }))
    .filter((a) => a.quantity !== 0);
}

export function useGroupStockTracking(groupId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: [GROUP_STOCK_TRACKING_KEY, groupId],
    enabled: !!groupId && enabled,
    retry: false,
    // RPC ausente/erro não vira toast global — ver docblock.
    meta: { silentError: true },
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    queryFn: async (): Promise<GroupStockTrackingRow[]> => {
      const { data, error } = await supabase.rpc(
        'list_group_stock_tracking' as never,
        { p_group_id: groupId, p_limit: 200 } as never,
      );
      if (error) throw error;
      return ((data ?? []) as RawRow[]).map((r) => ({
        stock_movement_id: r.stock_movement_id,
        created_at: r.created_at,
        product_id: r.product_id,
        product_name: r.product_name ?? '',
        color: r.color ?? null,
        unit: r.unit ?? null,
        quantity: Number(r.quantity) || 0,
        origin: r.origin ?? 'entrada',
        description: r.description ?? null,
        allocations: parseAllocations(r.allocations),
        allocated_qty: Number(r.allocated_qty) || 0,
      }));
    },
  });
}

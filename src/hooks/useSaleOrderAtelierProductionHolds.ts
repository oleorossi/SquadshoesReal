import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  saleOrderShowsAtelierProductionHold,
  type AtelierProductionHoldLine,
} from '@/lib/atelierProductionHold';

/**
 * Itens que impedem o PV de ir para Em Produção — RPC
 * `list_sale_order_atelier_production_blocks(uuid[])` (mig `20270101047200`).
 *
 * Aviso, não trava a tela: quem barra é o gatilho no banco. Falha da RPC
 * (função ainda não migrada, 42501) devolve mapa vazio, sem toast e sem retry.
 */

export const EMPTY_ATELIER_PRODUCTION_HOLDS: ReadonlyMap<string, AtelierProductionHoldLine[]> =
  new Map<string, AtelierProductionHoldLine[]>();

export const saleOrderAtelierProductionHoldsRoot = ['sale-order-atelier-production-holds'] as const;

export { saleOrderShowsAtelierProductionHold };

interface HoldRow {
  sale_order_id: string | null;
  item_id: string | null;
  reference_code: string | null;
  color: string | null;
  pending_jobs: string | null;
  reason: string | null;
}

function parseRows(raw: unknown): AtelierProductionHoldLine[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((row): row is HoldRow => !!row && typeof row === 'object')
    .map(row => ({
      saleOrderId: String(row.sale_order_id ?? ''),
      itemId: String(row.item_id ?? ''),
      referenceCode: String(row.reference_code ?? '?'),
      color: String(row.color ?? '—'),
      pendingJobs: String(row.pending_jobs ?? '').trim(),
      reason: String(row.reason ?? '').trim(),
    }))
    .filter(line => line.saleOrderId !== '' && line.itemId !== '' && line.reason !== '');
}

export function groupAtelierProductionHolds(
  lines: AtelierProductionHoldLine[],
): Map<string, AtelierProductionHoldLine[]> {
  const out = new Map<string, AtelierProductionHoldLine[]>();
  for (const line of lines) {
    const bucket = out.get(line.saleOrderId);
    if (bucket) bucket.push(line);
    else out.set(line.saleOrderId, [line]);
  }
  return out;
}

export function useSaleOrderAtelierProductionHolds(saleOrderIds: string[]) {
  const ids = [...new Set(saleOrderIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: [...saleOrderAtelierProductionHoldsRoot, ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<ReadonlyMap<string, AtelierProductionHoldLine[]>> => {
      try {
        const { data, error } = await supabase.rpc(
          'list_sale_order_atelier_production_blocks' as never,
          { p_sale_order_ids: ids } as never,
        );
        if (error) return EMPTY_ATELIER_PRODUCTION_HOLDS;
        return groupAtelierProductionHolds(parseRows(data));
      } catch {
        return EMPTY_ATELIER_PRODUCTION_HOLDS;
      }
    },
  });
}

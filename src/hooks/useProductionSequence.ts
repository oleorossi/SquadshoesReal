/**
 * Ordem oficial da fila de produção (specs/sequencia-producao.md).
 * Fonte: RPC list_production_sequence.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ProductionSequenceRow {
  orderId: string;
  saleOrderId: string | null;
  saleOrderItemId: string | null;
  orderNumber: string | null;
  color: string | null;
  referenceCode: string | null;
  dueDate: string | null;
  pinnedPosition: number | null;
  closeScore: number;
  sequencePosition: number;
  isPinned: boolean;
  isFrozen: boolean;
  sequenceFrozenAt: string | null;
  blockReason: string | null;
}

export const productionSequenceKeys = {
  all: ['production-sequence'] as const,
  list: () => [...productionSequenceKeys.all, 'list'] as const,
};

async function fetchProductionSequence(): Promise<ProductionSequenceRow[]> {
  const { data, error } = await supabase.rpc('list_production_sequence' as never);
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    orderId: String(r.order_id),
    saleOrderId: r.sale_order_id ? String(r.sale_order_id) : null,
    saleOrderItemId: r.sale_order_item_id ? String(r.sale_order_item_id) : null,
    orderNumber: r.order_number != null ? String(r.order_number) : null,
    color: r.color != null ? String(r.color) : null,
    referenceCode: r.reference_code != null ? String(r.reference_code) : null,
    dueDate: r.due_date != null ? String(r.due_date) : null,
    pinnedPosition: r.pinned_position != null ? Number(r.pinned_position) : null,
    closeScore: Number(r.close_score) || 0,
    sequencePosition: Number(r.sequence_position) || 0,
    isPinned: Boolean(r.is_pinned),
    isFrozen: Boolean(r.is_frozen),
    sequenceFrozenAt: r.sequence_frozen_at != null ? String(r.sequence_frozen_at) : null,
    blockReason: r.block_reason != null && String(r.block_reason).trim()
      ? String(r.block_reason)
      : null,
  }));
}

export function useProductionSequence() {
  return useQuery({
    queryKey: productionSequenceKeys.list(),
    queryFn: fetchProductionSequence,
    staleTime: 15_000,
  });
}

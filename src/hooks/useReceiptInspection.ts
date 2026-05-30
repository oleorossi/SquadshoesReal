import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Inspeção de recebimento (Compras #3). Registra qtd aprovada/rejeitada por item
 * de OC recebida; a rejeitada (não-conformidade) vai para quarentena (RPC
 * record_receipt_inspection → move_stock_status).
 */

export interface ReceivedPO { id: string; order_number: string; supplier_name: string | null; received_date: string | null; }
export interface POItem { id: string; product_id: string; quantity: number; unit: string | null; products?: { name: string; sku: string | null } | null; }
export interface Inspection {
  id: string; purchase_order_id: string; product_id: string; qty_received: number;
  qty_approved: number; qty_rejected: number; nc_reason: string; inspector: string; status: string; created_at: string;
  products?: { name: string } | null; purchase_orders?: { order_number: string } | null;
}

export function useReceivedPOs() {
  return useQuery({
    queryKey: ['received_pos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('id, order_number, supplier_name, received_date')
        .eq('status', 'received')
        .order('received_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ReceivedPO[];
    },
  });
}

export function usePoItems(poId: string | null) {
  return useQuery({
    queryKey: ['po_items_inspection', poId],
    enabled: !!poId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select('id, product_id, quantity, unit, products(name, sku)')
        .eq('purchase_order_id', poId!);
      if (error) throw error;
      return (data ?? []) as unknown as POItem[];
    },
  });
}

export function useInspectionHistory() {
  return useQuery({
    queryKey: ['receipt_inspections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('goods_receipt_inspections' as any)
        .select('id, purchase_order_id, product_id, qty_received, qty_approved, qty_rejected, nc_reason, inspector, status, created_at, products(name), purchase_orders(order_number)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as Inspection[];
    },
  });
}

export function useRecordInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { poId: string; productId: string; approved: number; rejected: number; ncReason: string; inspector: string }) => {
      const { error } = await supabase.rpc('record_receipt_inspection' as any, {
        p_po_id: p.poId, p_product_id: p.productId, p_qty_approved: p.approved,
        p_qty_rejected: p.rejected, p_nc_reason: p.ncReason, p_inspector: p.inspector,
      });
      if (error) throw error;
    },
    onSuccess: (_d, p) => {
      qc.invalidateQueries({ queryKey: ['receipt_inspections'] });
      qc.invalidateQueries({ queryKey: ['held_stock'] });
      toast.success(p.rejected > 0 ? `Inspeção registrada — ${p.rejected} enviado(s) à quarentena.` : 'Inspeção registrada.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

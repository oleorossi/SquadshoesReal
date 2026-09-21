import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type DispatchState = 'due' | 'ready' | 'held' | 'exported' | string;

export interface SourcePvLabel {
  sale_order_id: string;
  order_number: string;
  client_order_number: string;
}

export interface DispatchQueueItem {
  id: string;
  order_number: string;
  status: string;
  approval_status: string | null;
  supplier_id: string | null;
  supplier_name: string;
  total_value: number;
  source_pv_labels: SourcePvLabel[];
  purchase_by_date: string | null;
  promised_date: string | null;
  sector_need_date: string | null;
  setup_days_applied: number;
  dispatch_hold: boolean;
  dispatch_hold_reason: string | null;
  exported_at: string | null;
  supplier_export_xml: boolean;
  dispatch_state: DispatchState;
  items_summary: Array<{
    product_id: string | null;
    product_name: string | null;
    color: string | null;
    quantity: number;
    unit: string | null;
  }>;
  created_at: string;
}

const KEY = ['purchase-dispatch-queue'] as const;

export function usePurchaseDispatchQueue() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<DispatchQueueItem[]> => {
      const { data, error } = await supabase
        .from('v_purchase_dispatch_queue' as never)
        .select('*')
        .order('purchase_by_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return ((data || []) as unknown as DispatchQueueItem[]).map((row) => ({
        ...row,
        source_pv_labels: Array.isArray(row.source_pv_labels) ? row.source_pv_labels : [],
        items_summary: Array.isArray(row.items_summary) ? row.items_summary : [],
      }));
    },
    staleTime: 30_000,
  });
}

function invalidateDispatch(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ['purchase-orders'] });
}

export function useSetPurchaseDispatchHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; hold: boolean; reason?: string }) => {
      const { data, error } = await supabase.rpc('set_purchase_order_dispatch_hold' as never, {
        p_purchase_order_id: args.id,
        p_hold: args.hold,
        p_reason: args.reason ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      invalidateDispatch(qc);
      toast.success(vars.hold ? 'Envio segurado' : 'Hold liberado');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao alterar hold'),
  });
}

export function useAdvancePurchaseDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('advance_purchase_order_dispatch' as never, {
        p_purchase_order_id: id,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateDispatch(qc);
      toast.success('Compra adiantada para hoje');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao adiantar'),
  });
}

export function useCancelSuggestedPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; reason?: string }) => {
      const { data, error } = await supabase.rpc('cancel_suggested_purchase_order' as never, {
        p_purchase_order_id: args.id,
        p_reason: args.reason ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateDispatch(qc);
      toast.success('OC cancelada');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao cancelar'),
  });
}

export function useMarkPurchaseOrderExported() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; pdfPath?: string; xmlPath?: string }) => {
      const { data, error } = await supabase.rpc('mark_purchase_order_exported' as never, {
        p_purchase_order_id: args.id,
        p_pdf_storage_path: args.pdfPath ?? null,
        p_xml_path: args.xmlPath ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateDispatch(qc);
      toast.success('Export marcada como enviada');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao marcar export'),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SplitSuggestion {
  order_id: string;
  order_number: string;
  sale_order_id: string | null;
  sale_order_number: string | null;
  quantity: number;
  color: string | null;
  status: string;
  production_step: string | null;
  planned_delivery: string | null;
  sheet_id: string;
  sheet_name: string;
  sheet_code: string;
  bottleneck_capacity: number;
  suggested_lots: number;
}

export interface OrderLot {
  id: string;
  order_id: string;
  lot_number: number;
  quantity: number;
  status: 'pending' | 'in_progress' | 'done' | 'shipped' | 'cancelled';
  current_sector: string | null;
  expected_complete_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

/** Lista OPs ativas onde quantity > capacity_gargalo × 2 (vale splitar). */
export function useSplitSuggestions() {
  return useQuery({
    queryKey: ['v_order_split_suggestions'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_order_split_suggestions')
        .select('*');
      if (error) throw error;
      return (data || []) as SplitSuggestion[];
    },
    staleTime: 60_000,
  });
}

/** Lotes de uma OP. Vazio = OP não foi splitada (comportamento atual). */
export function useOrderLots(orderId: string | null | undefined) {
  return useQuery({
    queryKey: ['order_lots', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('order_lots')
        .select('*')
        .eq('order_id', orderId)
        .order('lot_number', { ascending: true });
      if (error) throw error;
      return (data || []) as OrderLot[];
    },
    staleTime: 30_000,
  });
}

export function useSplitOrderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await (supabase as any)
        .rpc('split_order_into_lots', { p_order_id: orderId });
      if (error) throw error;
      return data as { order_id: string; lot_size: number; n_lots: number; total_quantity: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['v_order_split_suggestions'] });
      qc.invalidateQueries({ queryKey: ['order_lots', data.order_id] });
      toast.success(
        `OP dividida em ${data.n_lots} lotes de até ${data.lot_size} pares.`
      );
    },
    onError: (err: any) => {
      toast.error(err.message || 'Falha ao dividir OP em lotes.');
    },
  });
}

export function useResetOrderLotsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await (supabase as any)
        .rpc('reset_order_lots', { p_order_id: orderId });
      if (error) throw error;
      return { order_id: orderId, deleted: data as number };
    },
    onSuccess: ({ order_id, deleted }) => {
      qc.invalidateQueries({ queryKey: ['v_order_split_suggestions'] });
      qc.invalidateQueries({ queryKey: ['order_lots', order_id] });
      toast.success(`${deleted} lote${deleted === 1 ? '' : 's'} removido${deleted === 1 ? '' : 's'}. OP volta ao formato único.`);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Falha ao resetar lotes.');
    },
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useOrderReservations(orderId?: string) {
  return useQuery({
    queryKey: ['material_reservations', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('material_reservations')
        .select('*, products(name, sku, color, unit, category), orders(order_number, references(name))')
        .eq('order_id', orderId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!orderId,
  });
}

export function useAllReservations() {
  return useQuery({
    queryKey: ['material_reservations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('material_reservations')
        .select('*, products(name, sku, color, unit, category)')
        .in('status', ['reserved', 'partially_consumed'])
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useConfirmPicking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ reservationId, pickedBy }: { reservationId: string; pickedBy?: string }) => {
      const { error } = await supabase.rpc('confirm_picking_reservation', {
        p_reservation_id: reservationId,
        p_picked_by: pickedBy || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      toast.success('Picking confirmado - material debitado!');
    },
    onError: (err: Error) => toast.error(`Erro no picking: ${err.message}`),
  });
}

// Confirma picking de TODAS as reservas de uma OP de uma vez. Usado pelo
// fluxo Reserve→Debit (Phase 1): aprovar PV cria reservas soft; confirmar
// picking aplica débito real (incl. solado por grade, tiras, embalagem).
export function useConfirmAllPicking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, pickedBy }: { orderId: string; pickedBy?: string }) => {
      const { data, error } = await supabase.rpc('consume_all_reservations_for_order' as any, {
        p_order_id: orderId,
        p_picked_by: pickedBy || '',
      });
      if (error) throw error;
      return data as { order_id: string; consumed_count: number; skipped_count: number; reservations: any[]; packaging?: any };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      const n = data?.consumed_count ?? 0;
      toast.success(`Picking confirmado — ${n} ${n === 1 ? 'material debitado' : 'materiais debitados'}.`);
    },
    onError: (err: Error) => toast.error(`Erro no picking: ${err.message}`),
  });
}

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

/**
 * Contagem de reservas por status — agregada NO BANCO (2026-08-03).
 *
 * Substitui o antigo `useAllReservations`, que baixava até 500 linhas
 * (`material_reservations` tem 1.472) só pra o PCPDashboard fazer
 * `.filter(...).length`. Dois defeitos no caminho antigo:
 *
 * 1. **O card "consumido" vivia zerado.** A query filtrava
 *    `.in('status', ['reserved','partially_consumed'])` e a tela contava
 *    `status === 'consumed'` — status que, por construção, nunca chegava. Havia
 *    86 reservas consumidas no banco e o painel mostrava 0. De quebra,
 *    `partially_consumed` não existe: os status reais são `cancelled` (922),
 *    `reserved` (324), `converted` (140) e `consumed` (86).
 * 2. **Teto de 500** — `reserved` cabia hoje (324), mas era questão de tempo.
 *
 * Agora são contagens exatas com `head: true`: o Postgres conta e **nenhuma
 * linha trafega**. Contar não é listar — por isso este hook não pagina.
 */
export function useReservationStatusCounts() {
  return useQuery({
    queryKey: ['material_reservations', 'status-counts'],
    queryFn: async () => {
      const countByStatus = async (status: string) => {
        const { count, error } = await supabase
          .from('material_reservations')
          .select('id', { count: 'exact', head: true })
          .eq('status', status);
        if (error) throw error;
        return count ?? 0;
      };

      const [pending, consumed] = await Promise.all([
        countByStatus('reserved'),
        countByStatus('consumed'),
      ]);

      return { pending, consumed, total: pending + consumed };
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

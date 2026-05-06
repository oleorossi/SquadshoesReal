import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type ReservationPolicy = {
  permit_partial?: boolean;
  consider_safety_stock?: boolean;
  priority?: 'normal' | 'high' | 'urgent';
  allow_expedite?: boolean;
  consolidate_po?: boolean;
};

export type TryReserveInput = {
  order_id: string;
  reference_id: string;
  order_quantity: number;
  color?: string;
  production_date?: string; // ISO date
  policy?: ReservationPolicy;
};

export type ReservationResult = {
  order_id: string;
  batch_id: string;
  reservations: Array<{
    product_id: string;
    product_name: string;
    qty_reserved: number;
    source: 'onhand' | 'inbound';
    rule: string;
    category?: string;
  }>;
  purchase_orders: Array<{
    po_id: string;
    product_name: string;
    qty_ordered: number;
    expedite?: boolean;
    rule: string;
  }>;
  notes: string[];
  status: 'fully_reserved' | 'partially_reserved' | 'pending_purchase' | 'no_materials';
};

export function useTryReserve() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: TryReserveInput): Promise<ReservationResult> => {
      const policy = input.policy || {};
      const { data, error } = await supabase.rpc('try_reserve_materials', {
        p_order_id: input.order_id,
        p_reference_id: input.reference_id,
        p_order_quantity: input.order_quantity,
        p_color: input.color || '',
        p_production_date: input.production_date || null,
        p_permit_partial: policy.permit_partial ?? true,
        p_consider_safety_stock: policy.consider_safety_stock ?? true,
        p_priority: policy.priority || 'normal',
        p_allow_expedite: policy.allow_expedite ?? false,
        p_consolidate_po: policy.consolidate_po ?? true,
      } as any);

      if (error) throw error;
      return data as unknown as ReservationResult;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['products'] });

      const statusMsg: Record<string, string> = {
        fully_reserved: 'Materiais reservados com sucesso!',
        partially_reserved: 'Reserva parcial — ordens de compra criadas para faltantes.',
        pending_purchase: 'Estoque insuficiente — ordens de compra criadas.',
        no_materials: 'Nenhum material encontrado na ficha técnica.',
      };

      if (result.status === 'fully_reserved') {
        toast.success(statusMsg[result.status]);
      } else if (result.status === 'no_materials') {
        toast.warning(statusMsg[result.status]);
      } else {
        toast.info(statusMsg[result.status], {
          description: `${result.reservations.length} reservas, ${result.purchase_orders.length} OCs criadas`,
          duration: 6000,
        });
      }
    },
    onError: (err: Error) => {
      toast.error(`Erro na reserva: ${err.message}`);
    },
  });
}

export function useReleaseReservations() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc('release_order_reservations', {
        p_order_id: orderId,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Reservas liberadas!');
    },
    onError: (err: Error) => toast.error(`Erro ao liberar: ${err.message}`),
  });
}

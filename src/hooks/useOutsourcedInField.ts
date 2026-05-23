import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { SectorKey } from '@/hooks/useSectorBottlenecks';

export type OutsourceSource = 'service_order' | 'outsourced_op';

export interface OutsourcedItem {
  source: OutsourceSource;
  id: string;
  contractor_id: string;
  contractor_name: string;
  sector: SectorKey | string;
  order_id: string | null;
  op_number: string;
  sale_order_id: string | null;
  sale_order_number: string;
  client_name: string;
  sheet_name: string;
  color: string;
  pairs: number;
  sent_at: string | null;
  expected_back: string | null;
  days_late: number;
  status: string;
  unit_price: number | null;
  total_value: number | null;
  created_at: string;
}

export function useOutsourcedInField() {
  return useQuery({
    queryKey: ['v_outsourced_in_field'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_outsourced_in_field')
        .select('*')
        .order('expected_back', { ascending: true, nullsFirst: false })
        .order('sent_at', { ascending: true });
      if (error) throw error;
      return (data || []) as OutsourcedItem[];
    },
    staleTime: 30_000,
  });
}

/**
 * Marca uma OS/OP como devolvida pela terceirizada.
 *  - source='service_order' → service_orders.status = 'received'
 *  - source='outsourced_op' → orders.outsourced_returned_at = now()
 */
export function useReceiveOutsourcedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: Pick<OutsourcedItem, 'id' | 'source' | 'order_id'>) => {
      if (item.source === 'service_order') {
        const { error } = await (supabase as any)
          .from('service_orders')
          .update({ status: 'received' })
          .eq('id', item.id);
        if (error) throw error;
      } else {
        const targetId = item.order_id ?? item.id;
        const { error } = await (supabase as any)
          .from('orders')
          .update({ outsourced_returned_at: new Date().toISOString() })
          .eq('id', targetId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['v_outsourced_in_field'] });
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['v_sector_bottlenecks'] });
      toast.success('Item marcado como recebido.');
    },
    onError: (err: any) => {
      toast.error(`Falha ao marcar como recebido: ${err?.message || 'erro desconhecido'}`);
    },
  });
}

/**
 * Prorroga o prazo prometido de uma OS terceirizada (somente service_orders;
 * OPs outsourced_op não têm campo de prazo dedicado, usam planned_delivery).
 */
export function useExtendOutsourcedDeadline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ item, newDeadline }: { item: OutsourcedItem; newDeadline: string }) => {
      if (item.source !== 'service_order') {
        throw new Error(
          'Prorrogação de OPs terceirizadas pré-produção é feita ajustando o prazo de entrega da OP em /orders.',
        );
      }
      const { error } = await (supabase as any)
        .from('service_orders')
        .update({ quoted_deadline: newDeadline })
        .eq('id', item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['v_outsourced_in_field'] });
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      toast.success('Prazo prorrogado.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha ao prorrogar prazo.');
    },
  });
}

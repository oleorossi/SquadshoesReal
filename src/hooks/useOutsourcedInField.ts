import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { SectorKey } from '@/hooks/useSectorBottlenecks';

export type OutsourceSource = 'service_order' | 'outsourced_op';

export interface MaterialSent {
  material: string;
  color: string;
  meters: number;
  completed?: boolean;
}

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
  // Breakdown (expand row) — todos opcionais (view v2)
  is_artisanal?: boolean;
  materials_sent?: MaterialSent[];
  material_name?: string | null;
  material_color?: string | null;
  material_meters?: number | null;
  artisanal_output_name?: string | null;
  artisanal_output_color?: string | null;
  artisanal_output_meters?: number | null;
  artisanal_base_color?: string | null;
  artisanal_for_order_meters?: number | null;
  artisanal_for_stock_meters?: number | null;
  order_grade?: Record<string, number> | null;
  description?: string | null;
  notes?: string | null;
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
        // Auditoria 28/05/2026: limpa override flag ao receber legitimamente.
        // Antes a flag ficava stale — se a OS fosse re-aberta no futuro,
        // continuaria marcada como overridden mesmo tendo sido entregue.
        const { error } = await (supabase as any)
          .from('service_orders')
          .update({
            status: 'received',
            montagem_override_at: null,
            montagem_override_by: null,
            montagem_override_reason: null,
          })
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

/**
 * Libera uma OS terceirizada do bloqueio de Montagem mesmo sem o material
 * ter voltado. Chama RPC override_service_order_for_montagem(uuid, text) —
 * exige justificativa (mín 5 caracteres) e registra audit log.
 *
 * `silent` (default false): quando true, NÃO mostra toast individual nem
 * invalida caches a cada call. Usado em batch (OverrideOSDialog) onde o
 * caller agrega resultados via Promise.allSettled e mostra UM toast final
 * — antes a UI era inundada com N toasts em paralelo.
 */
export function useOverrideOSForMontagem(options?: { silent?: boolean }) {
  const qc = useQueryClient();
  const silent = options?.silent ?? false;
  return useMutation({
    mutationFn: async ({ serviceOrderId, reason }: { serviceOrderId: string; reason: string }) => {
      if (!reason || reason.trim().length < 5) {
        throw new Error('Justificativa obrigatória (mín 5 caracteres).');
      }
      const { error } = await (supabase as any).rpc('override_service_order_for_montagem', {
        p_so_id: serviceOrderId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      if (silent) return;
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['v_outsourced_in_field'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['production_waves'] });
      qc.invalidateQueries({ queryKey: ['pending-os-for-order'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['v_sector_bottlenecks'] });
      toast.success('OS liberada — Montagem desbloqueada.');
    },
    onError: (err: any) => {
      if (silent) return;
      toast.error(err?.message || 'Falha ao liberar OS.');
    },
  });
}

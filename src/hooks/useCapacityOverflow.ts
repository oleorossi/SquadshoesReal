import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CapacityOverflowRow {
  order_id: string;
  order_number: string;
  sale_order_id: string;
  sheet_id: string;
  sheet_name: string;
  color: string;
  quantity: number;
  sector: string;
  week_start: string;
  total_pairs_planned: number;
  total_capacity_week: number;
  utilization_pct: number;
  severity: 'ok' | 'warning' | 'critical';
}

export interface OutsourcingAssignment {
  order_id: string;
  sector: string;
  contractor_id: string | null;
}

export interface OutsourcingResult {
  processed_count: number;
  created_service_order_ids: string[];
  skipped: string[];
}

/**
 * Detecta OPs (do conjunto p_order_ids) que caíram em setor/semana com
 * utilização > 100%. Usado pelo WaveBuilder logo após criar onda pra
 * abrir o CapacityOverflowDialog quando há transbordo.
 */
export function useCapacityOverflow(orderIds: string[]) {
  return useQuery<CapacityOverflowRow[]>({
    queryKey: ['capacity_overflow', [...orderIds].sort().join(',')],
    enabled: orderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('detect_wave_capacity_overflow', {
        p_order_ids: orderIds,
      });
      if (error) throw error;
      return (data || []) as CapacityOverflowRow[];
    },
    staleTime: 30_000,
  });
}

/**
 * Aplica a seleção do CapacityOverflowDialog: marca OPs como terceirizadas
 * e cria as service_orders correspondentes via RPC atômica.
 */
export function useCommitOutsourcing() {
  const qc = useQueryClient();
  return useMutation<OutsourcingResult, Error, OutsourcingAssignment[]>({
    mutationFn: async (assignments) => {
      const { data, error } = await (supabase as any).rpc('commit_capacity_overflow_outsourcing', {
        p_assignments: assignments,
      });
      if (error) throw new Error(error.message);
      return data as OutsourcingResult;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['capacity_overflow'] });
      qc.invalidateQueries({ queryKey: ['production_kanban'] });
      if (result.processed_count > 0) {
        const skipMsg = result.skipped.length > 0
          ? ` (${result.skipped.length} pulado(s): ${result.skipped.slice(0, 2).join('; ')})`
          : '';
        toast.success(
          `${result.processed_count} ${result.processed_count === 1 ? 'OP transferida' : 'OPs transferidas'} pra terceiros${skipMsg}`,
        );
      } else if (result.skipped.length > 0) {
        toast.warning(`Nenhuma OP transferida — ${result.skipped.length} pulado(s).`);
      } else {
        toast.info('Nenhuma OP selecionada pra transbordo.');
      }
    },
    onError: (err: Error) => toast.error(`Erro no transbordo: ${err.message}`),
  });
}

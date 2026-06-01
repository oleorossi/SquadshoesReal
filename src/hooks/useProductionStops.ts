import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ════════════════════════════════════════════════════════════════════════
// Paradas de produção + OEE (paridade Tutor32)
//
// Toda a infra de banco JÁ EXISTIA (tabelas production_stops +
// production_stop_reasons com 13 motivos seedados, view v_sector_oee) mas
// nunca foi ligada à UI — production_stops estava vazia e o relatório de OEE
// era mockado. Estes hooks operacionalizam o apontamento de parada e leem o
// OEE real calculado pela view (disponibilidade × performance por setor, 30d).
// ════════════════════════════════════════════════════════════════════════

export interface StopReason {
  id: string;
  code: string;
  description: string;
  category: string;
  impacts_availability: boolean;
  impacts_performance: boolean;
  is_planned: boolean;
}

export interface ProductionStop {
  id: string;
  order_id: string | null;
  stage_name: string;
  reason_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  observation: string | null;
  reported_by: string | null;
  created_at: string;
  reason?: StopReason | null;
}

export interface SectorOee {
  stage_name: string;
  pairs_produced_30d: number;
  downtime_unplanned_min: number;
  performance_loss_min: number;
  availability_pct: number;
  performance_pct: number;
}

/** Setores de produção — stage_name canônico de order_stages (ordem do fluxo). */
export const PRODUCTION_SECTORS = [
  'Corte Palmilha', 'Corte Forração', 'Costura', 'Silk', 'Aviamento',
  'Montagem', 'Colagem', 'Solagem', 'Acabamento', 'Expedição',
] as const;

/** Rótulos PT-BR das categorias de motivo de parada (production_stop_reasons.category). */
export const STOP_CATEGORY_LABELS: Record<string, string> = {
  manutencao: 'Manutenção',
  falta_material: 'Falta de Material',
  setup: 'Setup',
  troca_cor: 'Troca de Cor',
  rh: 'RH / Pessoal',
  qualidade: 'Qualidade',
  externa: 'Externa',
};

export function useStopReasons() {
  return useQuery({
    queryKey: ['production_stop_reasons'],
    queryFn: async (): Promise<StopReason[]> => {
      const { data, error } = await supabase
        .from('production_stop_reasons')
        .select('id, code, description, category, impacts_availability, impacts_performance, is_planned')
        .eq('active', true)
        .order('category', { ascending: true })
        .order('description', { ascending: true });
      if (error) throw error;
      return (data || []) as StopReason[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useProductionStops(limit = 50) {
  return useQuery({
    queryKey: ['production_stops', limit],
    queryFn: async (): Promise<ProductionStop[]> => {
      const { data, error } = await supabase
        .from('production_stops')
        .select('*, reason:production_stop_reasons(id, code, description, category, impacts_availability, impacts_performance, is_planned)')
        .order('started_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as unknown as ProductionStop[];
    },
  });
}

export function useSectorOee() {
  return useQuery({
    queryKey: ['v_sector_oee'],
    queryFn: async (): Promise<SectorOee[]> => {
      const { data, error } = await supabase.from('v_sector_oee').select('*');
      if (error) throw error;
      return (data || []) as unknown as SectorOee[];
    },
  });
}

export function useCreateProductionStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      stage_name: string;
      reason_id: string;
      started_at: string;
      ended_at?: string | null;
      observation?: string | null;
      order_id?: string | null;
    }) => {
      // duration_minutes é derivada de início+fim (a view de OEE só conta
      // paradas com duration_minutes preenchido). Parada "em aberto" (sem fim)
      // fica com duration nula até ser encerrada.
      let duration_minutes: number | null = null;
      if (input.started_at && input.ended_at) {
        const ms = new Date(input.ended_at).getTime() - new Date(input.started_at).getTime();
        if (Number.isFinite(ms) && ms >= 0) duration_minutes = Math.round(ms / 60000);
      }
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from('production_stops').insert({
        stage_name: input.stage_name,
        reason_id: input.reason_id,
        started_at: input.started_at,
        ended_at: input.ended_at || null,
        duration_minutes,
        observation: input.observation || '',
        order_id: input.order_id || null,
        reported_by: userData?.user?.id || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_stops'] });
      qc.invalidateQueries({ queryKey: ['v_sector_oee'] });
      toast.success('Parada registrada com sucesso.');
    },
    onError: (e: Error) => toast.error(`Erro ao registrar parada: ${e.message}`),
  });
}

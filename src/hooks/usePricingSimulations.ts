/**
 * usePricingSimulations — hooks pra histórico do simulador Markup.
 * Tabela: pricing_simulations (mig 20260530170000)
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type PricingSimulation = {
  id: string;
  sheet_id: string | null;
  sheet_code: string | null;
  sheet_name: string | null;
  material_cost: number;
  labor_cost: number;
  overhead_cost: number;
  packaging_cost: number;
  freight_cost: number;
  total_cost: number;
  tax_pct: number;
  factoring_rate_pct: number;
  factoring_days: number;
  factoring_total_pct: number;
  commission_pct: number;
  profit_margin_pct: number;
  suggested_price: number;
  cash_price: number;
  real_profit: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type NewPricingSimulation = Omit<PricingSimulation, 'id' | 'created_by' | 'created_at'>;

export function usePricingSimulations(sheetId?: string | null) {
  return useQuery({
    queryKey: ['pricing_simulations', sheetId ?? 'all'],
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('pricing_simulations' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (sheetId) q = q.eq('sheet_id', sheetId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as PricingSimulation[];
    },
  });
}

export function useCreatePricingSimulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sim: NewPricingSimulation) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('pricing_simulations' as any).insert({
        ...sim,
        created_by: user?.id ?? null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricing_simulations'] });
      toast.success('Simulação salva no histórico!');
    },
    onError: (err: Error) => toast.error(`Erro ao salvar: ${err.message}`),
  });
}

export function useDeletePricingSimulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pricing_simulations' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricing_simulations'] });
      toast.success('Simulação excluída.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

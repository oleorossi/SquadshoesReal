import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type CostPolicy = {
  id: string;
  valuation_method: string;
  overhead_rate_per_pair: number;
  overhead_monthly_total: number;
  monthly_production_target: number;
  freight_allocation_pct: number;
  packaging_cost_per_pair: number;
  active: boolean;
  notes: string;
};

export function useCostPolicies() {
  return useQuery({
    queryKey: ['cost_policies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cost_policies')
        .select('*')
        .eq('active', true)
        .limit(1);
      if (error) throw error;
      return data?.[0] || null;
    },
  });
}

export function useUpdateCostPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CostPolicy> }) => {
      const numFields: (keyof CostPolicy)[] = ['overhead_rate_per_pair', 'freight_allocation_pct', 'packaging_cost_per_pair', 'overhead_monthly_total'];
      for (const f of numFields) {
        const v = data[f];
        if (v !== undefined && (!Number.isFinite(v as number) || (v as number) < 0)) throw new Error(`Campo ${f} deve ser um número não-negativo.`);
      }
      const { error } = await supabase
        .from('cost_policies')
        .update(data as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cost_policies'] });
      toast.success('Política de custo atualizada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

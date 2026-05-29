import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ProductionSettings {
  id: boolean;
  costura_pairs_per_day_total: number;
  costura_overflow_tolerance_pct: number;
  costura_dispatch_horizon_days: number;
  updated_at: string | null;
  updated_by: string | null;
}

export function useProductionSettings() {
  return useQuery({
    queryKey: ['production_settings'],
    queryFn: async (): Promise<ProductionSettings | null> => {
      const { data, error } = await (supabase as any)
        .from('production_settings')
        .select('*')
        .eq('id', true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateProductionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<ProductionSettings, 'id' | 'updated_at' | 'updated_by'>>) => {
      const { data, error } = await (supabase as any)
        .from('production_settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', true)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_settings'] });
      qc.invalidateQueries({ queryKey: ['costura_capacity_plan'] });
    },
  });
}

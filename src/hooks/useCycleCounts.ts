import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CycleCountSummary {
  id: string;
  count_number: string;
  count_date: string;
  status: 'open' | 'closed' | string;
  total_items: number;
  accurate_items: number;
  accuracy_pct: number;
  counted_by: string | null;
  approved_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items_over: number;
  items_under: number;
  items_adjusted: number;
}

export interface CycleCountItem {
  id: string;
  cycle_count_id: string;
  product_id: string;
  system_quantity: number;
  counted_quantity: number;
  variance: number;
  bin_location: string | null;
  lot_number: string | null;
  notes: string | null;
  adjusted: boolean;
  created_at: string;
}

export function useCycleCounts() {
  return useQuery({
    queryKey: ['cycle_counts_summary'],
    queryFn: async (): Promise<CycleCountSummary[]> => {
      const { data, error } = await (supabase as any)
        .from('v_cycle_counts_summary')
        .select('*')
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });
}

export function useCycleCountItems(cycleId: string | null | undefined) {
  return useQuery({
    queryKey: ['cycle_count_items', cycleId],
    enabled: !!cycleId,
    queryFn: async (): Promise<CycleCountItem[]> => {
      if (!cycleId) return [];
      const { data, error } = await (supabase as any)
        .from('cycle_count_items')
        .select('*')
        .eq('cycle_count_id', cycleId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    staleTime: 10_000,
  });
}

export function useCreateCycleCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notes?: string): Promise<string> => {
      const { data, error } = await (supabase as any).rpc('create_cycle_count', { p_notes: notes ?? null });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cycle_counts_summary'] });
      toast.success('Ciclo de contagem criado');
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao criar ciclo'),
  });
}

export function useAddCycleCountItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      cycleId: string;
      productId: string;
      countedQuantity: number;
      binLocation?: string | null;
      lotNumber?: string | null;
      notes?: string | null;
    }) => {
      const { data, error } = await (supabase as any).rpc('add_cycle_count_item', {
        p_cycle_id: input.cycleId,
        p_product_id: input.productId,
        p_counted_quantity: input.countedQuantity,
        p_bin_location: input.binLocation ?? null,
        p_lot_number: input.lotNumber ?? null,
        p_notes: input.notes ?? null,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['cycle_count_items', vars.cycleId] });
      qc.invalidateQueries({ queryKey: ['cycle_counts_summary'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao registrar contagem'),
  });
}

export function useFinalizeCycleCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { cycleId: string; applyAdjustments?: boolean }) => {
      const { data, error } = await (supabase as any).rpc('finalize_cycle_count', {
        p_cycle_id: input.cycleId,
        p_apply_adjustments: input.applyAdjustments ?? true,
      });
      if (error) throw new Error(error.message);
      return data as {
        success: boolean;
        total_items: number;
        accurate_items: number;
        adjustments_applied: number;
        failures: number;
        failure_details: any[];
        accuracy_pct: number;
      };
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['cycle_count_items', vars.cycleId] });
      qc.invalidateQueries({ queryKey: ['cycle_counts_summary'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      if (data.failures > 0) {
        toast.warning(`Ciclo fechado: ${data.adjustments_applied} ajustes aplicados, ${data.failures} falharam (veja relatório)`);
      } else {
        toast.success(`Ciclo fechado · Acuracidade ${data.accuracy_pct}% · ${data.adjustments_applied} ajustes aplicados`);
      }
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao finalizar ciclo'),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Resultados salvos da calculadora manual de custo de MO (aba "Mão de Obra" em
 * /pricing-calculator). Cada resultado guarda a referência, as linhas com
 * SNAPSHOT do valor-hora e o total. Ver migration 20260613140000_labor-cost-results.
 */

export interface LaborCostResultLine {
  sector_key: string;
  hours: number;
  hourly_rate: number; // snapshot no momento de salvar
  cost: number;
}

export interface LaborCostResult {
  id: string;
  reference: string;
  lines: LaborCostResultLine[];
  total_cost: number;
  created_at: string;
  updated_at: string;
}

const QUERY_KEY = ['labor-cost-results'] as const;

export function useLaborCostResults() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<LaborCostResult[]> => {
      const { data, error } = await supabase
        .from('labor_cost_results')
        .select('id, reference, lines, total_cost, created_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        reference: r.reference,
        lines: (r.lines as unknown as LaborCostResultLine[]) ?? [],
        total_cost: Number(r.total_cost) || 0,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    },
  });
}

export interface SaveLaborCostResultInput {
  id?: string | null;
  reference: string;
  lines: LaborCostResultLine[];
  total: number;
}

/** Insere (sem id) ou atualiza (com id). Retorna o id salvo. */
export function useSaveLaborCostResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reference, lines, total }: SaveLaborCostResultInput): Promise<string> => {
      const linesJson = lines as unknown as never; // jsonb
      if (id) {
        const { data, error } = await supabase
          .from('labor_cost_results')
          .update({ reference, lines: linesJson, total_cost: total, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select('id')
          .single();
        if (error) throw error;
        return data.id;
      }
      const { data, error } = await supabase
        .from('labor_cost_results')
        .insert({ reference, lines: linesJson, total_cost: total })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeleteLaborCostResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('labor_cost_results').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

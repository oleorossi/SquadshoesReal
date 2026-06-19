import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Resultados salvos da calculadora de custo de MO por SETOR baseada em TEMPO
 * (aba "MOD por Setor" em /pricing-calculator). Cada resultado guarda a
 * referência, as linhas (setor / minutos por par / custo-hora SNAPSHOT) e o
 * total. Ver migration 20260806120000_reference-sector-pricing.
 *
 * Independente de labor_cost_results (aba "Mão de Obra", que guarda HORAS).
 */

export interface ReferenceSectorPricingLine {
  sector_key: string;
  /** Tempo gasto no setor, por par, em MINUTOS. */
  time_per_pair_min: number;
  /** Custo-hora do setor no momento de salvar (default = salário ÷ 220, editável). */
  cost_per_hour: number;
  /** Custo/par derivado = (time_per_pair_min / 60) × cost_per_hour. */
  cost: number;
}

export interface ReferenceSectorPricing {
  id: string;
  reference: string;
  lines: ReferenceSectorPricingLine[];
  total_cost: number;
  created_at: string;
  updated_at: string;
}

const QUERY_KEY = ['reference-sector-pricing'] as const;

export function useReferenceSectorPricing() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<ReferenceSectorPricing[]> => {
      const { data, error } = await supabase
        .from('reference_sector_pricing')
        .select('id, reference, lines, total_cost, created_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        reference: r.reference,
        lines: (r.lines as unknown as ReferenceSectorPricingLine[]) ?? [],
        total_cost: Number(r.total_cost) || 0,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    },
  });
}

export interface SaveReferenceSectorPricingInput {
  id?: string | null;
  reference: string;
  lines: ReferenceSectorPricingLine[];
  total: number;
}

/** Insere (sem id) ou atualiza (com id). Retorna o id salvo. */
export function useSaveReferenceSectorPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reference, lines, total }: SaveReferenceSectorPricingInput): Promise<string> => {
      const linesJson = lines as unknown as never; // jsonb
      if (id) {
        const { data, error } = await supabase
          .from('reference_sector_pricing')
          .update({ reference, lines: linesJson, total_cost: total, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select('id')
          .single();
        if (error) throw error;
        return data.id;
      }
      const { data, error } = await supabase
        .from('reference_sector_pricing')
        .insert({ reference, lines: linesJson, total_cost: total })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeleteReferenceSectorPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('reference_sector_pricing').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

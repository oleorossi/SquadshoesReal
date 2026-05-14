import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SectorWorkloadRow {
  sector: string;
  reference_id: string;
  model_name: string;
  shoe_category: string | null;
  color: string | null;
  ops_count: number;
  total_pairs: number;
  remaining_pairs: number;
  processed_pairs: number;
  earliest_deadline: string | null;
  latest_deadline: string | null;
  order_ids: string[];
  order_numbers: string[];
  aggregated_grade: Record<string, number> | null;
  aggregated_status: 'pendente' | 'em_andamento';
}

/**
 * Carga ativa do setor agregada por (modelo, cor).
 * Cada linha representa N OPs do mesmo combo consolidadas em 1 bloco.
 * Use `groupByColor=false` em setores onde a cor não muda a operação
 * (ex.: Corte Palmilha — mesmo molde pra todas as cores).
 */
export function useSectorWorkload(stageName: string | null, opts?: { groupByColor?: boolean }) {
  const groupByColor = opts?.groupByColor ?? true;
  return useQuery({
    queryKey: ['v_sector_workload_active', stageName, groupByColor],
    enabled: !!stageName,
    queryFn: async (): Promise<SectorWorkloadRow[]> => {
      const { data, error } = await (supabase as any)
        .from('v_sector_workload_active')
        .select('*')
        .eq('sector', stageName);
      if (error) throw error;
      const rows = (data || []) as SectorWorkloadRow[];

      // Em setores que não dependem de cor, reagrupa somando todas as cores
      // do mesmo modelo num único bloco no client (mais simples que view dedicada).
      if (!groupByColor) {
        const byModel = new Map<string, SectorWorkloadRow>();
        for (const r of rows) {
          const key = r.reference_id;
          const existing = byModel.get(key);
          if (!existing) {
            byModel.set(key, { ...r, color: null });
            continue;
          }
          existing.ops_count += r.ops_count;
          existing.total_pairs += r.total_pairs;
          existing.remaining_pairs += r.remaining_pairs;
          existing.processed_pairs += r.processed_pairs;
          existing.order_ids = [...existing.order_ids, ...r.order_ids];
          existing.order_numbers = [...existing.order_numbers, ...r.order_numbers];
          if (r.earliest_deadline && (!existing.earliest_deadline || r.earliest_deadline < existing.earliest_deadline)) {
            existing.earliest_deadline = r.earliest_deadline;
          }
          // Merge grades por tamanho
          if (r.aggregated_grade) {
            const merged: Record<string, number> = { ...(existing.aggregated_grade || {}) };
            for (const [k, v] of Object.entries(r.aggregated_grade)) {
              merged[k] = (Number(merged[k]) || 0) + (Number(v) || 0);
            }
            existing.aggregated_grade = merged;
          }
        }
        return Array.from(byModel.values());
      }

      return rows;
    },
    staleTime: 30_000,
  });
}

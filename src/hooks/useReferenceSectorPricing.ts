import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Resultados salvos da calculadora de custo de MO por SETOR baseada em
 * PRODUTIVIDADE (pares por hora) — aba "MOD por Setor" em /pricing-calculator.
 * Cada resultado guarda a referência, as linhas (setor / pares por hora /
 * custo-hora SNAPSHOT) e o total. Ver migration 20260806120000 +
 * 20260807120000 (min/par → pares/hora).
 *
 * Independente de labor_cost_results (aba "Mão de Obra", que guarda HORAS).
 *
 * Retrocompat: linhas salvas no formato antigo (`time_per_pair_min`) são
 * convertidas na leitura para `pairs_per_hour = 60 / time_per_pair_min` — o que
 * preserva o custo exatamente (hora/(60/min) = (min/60)×hora).
 */

export interface ReferenceSectorPricingLine {
  sector_key: string;
  /** Produtividade do setor: pares produzidos por hora. */
  pairs_per_hour: number;
  /** Custo-hora do setor no momento de salvar (default = salário ÷ 220, editável). */
  cost_per_hour: number;
  /** Custo/par derivado = cost_per_hour / pairs_per_hour. */
  cost: number;
}

/** Converte uma linha de qualquer formato (novo pairs_per_hour OU legado
 *  time_per_pair_min) na forma canônica atual. */
function normalizeLine(raw: any): ReferenceSectorPricingLine {
  const costPerHour = Number(raw?.cost_per_hour) || 0;
  let pph = Number(raw?.pairs_per_hour) || 0;
  if (pph <= 0) {
    const legacyMin = Number(raw?.time_per_pair_min) || 0;
    if (legacyMin > 0) pph = 60 / legacyMin; // preserva o custo (hora/(60/min) = (min/60)×hora)
  }
  return {
    sector_key: String(raw?.sector_key ?? ''),
    pairs_per_hour: pph,
    cost_per_hour: costPerHour,
    cost: Number(raw?.cost) || (pph > 0 ? costPerHour / pph : 0),
  };
}

export interface ReferenceSectorPricing {
  id: string;
  reference: string;
  lines: ReferenceSectorPricingLine[];
  /** Custo de MO por par já AJUSTADO pela eficiência (= Σ line.cost ÷ efficiency). */
  total_cost: number;
  /** Eficiência produtiva aplicada (%). Linhas legadas (sem a coluna) ⇒ 100 (bruto). */
  efficiency_pct: number;
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
        .select('id, reference, lines, total_cost, efficiency_pct, created_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        reference: r.reference,
        lines: Array.isArray(r.lines) ? (r.lines as unknown[]).map(normalizeLine) : [],
        total_cost: Number(r.total_cost) || 0,
        // Linhas anteriores à coluna não têm o campo ⇒ 100 (total já era bruto).
        efficiency_pct: Number((r as { efficiency_pct?: number }).efficiency_pct) || 100,
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
  /** Total já AJUSTADO pela eficiência (o custo de MO real por par). */
  total: number;
  /** Eficiência produtiva aplicada (%). Default 100 = sem ajuste (retrocompat). */
  efficiencyPct?: number;
}

/** Insere (sem id) ou atualiza (com id). Retorna o id salvo. */
export function useSaveReferenceSectorPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reference, lines, total, efficiencyPct = 100 }: SaveReferenceSectorPricingInput): Promise<string> => {
      const linesJson = lines as unknown as never; // jsonb
      if (id) {
        const { data, error } = await supabase
          .from('reference_sector_pricing')
          .update({ reference, lines: linesJson, total_cost: total, efficiency_pct: efficiencyPct, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select('id')
          .single();
        if (error) throw error;
        return data.id;
      }
      const { data, error } = await supabase
        .from('reference_sector_pricing')
        .insert({ reference, lines: linesJson, total_cost: total, efficiency_pct: efficiencyPct })
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

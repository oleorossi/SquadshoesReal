import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  aggregateProducaoByMontador,
  FICHA_MONTADORES_PRODUCAO_COLUMNS,
  type FichaMontadorRow,
  type ProducaoAgg,
} from '@/lib/montadorProduction';

/**
 * Produção por par (Ficha de Montadores) agregada por montador no intervalo
 * [from, to]. Fonte da folha "por par" e do KPI "Variável (por par)". Só linhas
 * origem='chamada'; usa o R$/par snapshot da própria linha.
 */
export function useMontadorProducao(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['montador_producao', from, to],
    enabled: enabled && !!from && !!to,
    queryFn: async (): Promise<Map<string, ProducaoAgg>> => {
      const { data, error } = await (supabase as any)
        .from('ficha_montadores')
        .select(FICHA_MONTADORES_PRODUCAO_COLUMNS)
        .gte('dia', from)
        .lte('dia', to);
      if (error) throw error;
      return aggregateProducaoByMontador((data || []) as FichaMontadorRow[]);
    },
    staleTime: 60_000,
  });
}

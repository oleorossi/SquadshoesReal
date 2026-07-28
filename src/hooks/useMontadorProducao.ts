import { useQuery } from '@tanstack/react-query';
import {
  aggregateProducaoByMontador,
  fetchMontadorProducaoInRange,
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
      return aggregateProducaoByMontador(await fetchMontadorProducaoInRange(from, to));
    },
    staleTime: 60_000,
  });
}

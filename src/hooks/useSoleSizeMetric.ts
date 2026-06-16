import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Área por numeração do solado vinculado à ficha — usada pela aba de
 * Escalonamento como RAZÃO real de escala (gradeScaling.scaleConsumptionBySize).
 *
 * Lê `sole_technical_specs.insole_consumption_dm2` (dm²/par por número) dos
 * solados do grupo `soleGroupId` e devolve o mapa `{ size: dm2 }` do solado com
 * mais dados. Hoje costuma vir CHAPADO (mesmo valor em todo número) — nesse caso
 * o escalonamento ignora e cai na grade padrão (isNonFlatProgression).
 */
export function useSoleSizeMetric(soleGroupId: string | null | undefined) {
  return useQuery({
    queryKey: ['sole-size-metric', soleGroupId],
    enabled: !!soleGroupId,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<number, number>> => {
      const { data: soleProducts, error: e1 } = await supabase
        .from('products')
        .select('id')
        .eq('group_id', soleGroupId as string);
      if (e1) throw e1;
      const ids = (soleProducts ?? []).map((p) => p.id);
      if (ids.length === 0) return {};

      const { data: specs, error: e2 } = await supabase
        .from('sole_technical_specs')
        .select('sole_id, size, insole_consumption_dm2')
        .in('sole_id', ids);
      if (e2) throw e2;

      // Agrupa por solado; escolhe o que tiver mais números preenchidos.
      const bySole: Record<string, Record<number, number>> = {};
      for (const s of specs ?? []) {
        const v = Number(s.insole_consumption_dm2) || 0;
        if (v <= 0) continue;
        (bySole[s.sole_id] ??= {})[Number(s.size)] = v;
      }
      let best: Record<number, number> = {};
      for (const m of Object.values(bySole)) {
        if (Object.keys(m).length > Object.keys(best).length) best = m;
      }
      return best;
    },
  });
}

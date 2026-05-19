import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Helper compartilhado pra montar a lista de keys que devem aparecer numa
 * grade de tamanhos quando o solado pode ter CONJUGAÇÕES (ex: 23/24 = 1 par
 * único). Quando o solado tem conjugações cadastradas em
 * sole_size_conjugations, os tamanhos individuais que estão dentro de uma
 * conjugação são SUBSTITUÍDOS pelo key conjugado.
 *
 * Origem: 19/05/2026 — user reportou que a grade de "Consumo de Cabedal por
 * Numeração" só mostrava tamanhos individuais, mesmo quando o solado tinha
 * conjugações cadastradas (gerando consumo zero pros conjugados em produção).
 *
 * Já estava implementado em SaleOrderItemForm.tsx — extraído pra util pra
 * reuso na ficha técnica (cabedal/forro/palmilha/fachete) sem duplicação.
 */

type Conjugation = { size_key: string; sizes: number[]; display_order?: number };

/** Faixa numérica → keys com conjugações aplicadas. */
export function buildDisplayKeysWithConjugations(opts: {
  sizes: number[];
  conjugations: Conjugation[];
}): string[] {
  const { sizes, conjugations } = opts;
  if (!conjugations || conjugations.length === 0) return sizes.map(String);

  const result: string[] = [];
  const added = new Set<string>();
  for (const s of sizes) {
    const conj = conjugations.find(c => c.sizes.includes(s));
    if (conj) {
      if (!added.has(conj.size_key)) {
        result.push(conj.size_key);
        added.add(conj.size_key);
      }
    } else {
      result.push(String(s));
    }
  }
  return result;
}

/** Hook React: carrega conjugações do solado e retorna lista pronta. */
export function useDisplaySizeKeys(opts: {
  sizes: number[];
  soleGroupId?: string | null;
}): string[] {
  const { sizes, soleGroupId } = opts;
  const { data: conjugations = [] } = useQuery({
    queryKey: ['sole_size_conjugations', soleGroupId || null],
    enabled: !!soleGroupId,
    queryFn: async () => {
      if (!soleGroupId) return [] as Conjugation[];
      const { data } = await (supabase as any)
        .from('sole_size_conjugations')
        .select('size_key, sizes, display_order')
        .eq('sole_group_id', soleGroupId)
        .order('display_order');
      return (data || []) as Conjugation[];
    },
    staleTime: 5 * 60_000,
  });
  return buildDisplayKeysWithConjugations({ sizes, conjugations });
}

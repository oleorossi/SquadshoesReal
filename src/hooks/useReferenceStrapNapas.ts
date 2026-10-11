import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { parseReferenceStrapNapas, type ReferenceStrapNapa } from '@/lib/referenceStrapNapas';
import { isUuid } from '@/lib/technicalStrapLines';

export const referenceStrapNapasKey = (referenceId: string | null | undefined) =>
  ['reference_strap_napas', referenceId || ''] as const;

/**
 * Napas que a referência possui (napa-base da ficha + variantes ativas), para
 * o seletor de cor das tiras multicolor. Só consulta quando a ficha tem tira
 * que escolhe a napa no PV — `enabled` vem de `strapChoosesReferenceNapa`.
 */
export function useReferenceStrapNapas(referenceId: string | null | undefined, enabled = true) {
  return useQuery<ReferenceStrapNapa[]>({
    queryKey: referenceStrapNapasKey(referenceId),
    enabled: enabled && isUuid(referenceId),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_reference_strap_napas' as never, {
        p_reference_ids: [referenceId],
      } as never);
      if (error) throw error;
      return parseReferenceStrapNapas(data).get(referenceId as string) || [];
    },
  });
}

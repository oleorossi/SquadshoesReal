import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  parseOutsourcedPairLine,
  type OutsourcedGrain,
  type OutsourcedPairLine,
} from '@/lib/outsourcedPairLedger';

export function useOutsourcedPairLedger(grain: OutsourcedGrain) {
  return useQuery({
    queryKey: ['outsourced-pair-ledger', grain],
    staleTime: 30_000,
    queryFn: async (): Promise<OutsourcedPairLine[]> => {
      const { data, error } = await supabase.rpc('outsourced_pair_ledger' as never, {
        p_grain: grain,
      } as never);
      if (error) throw error;
      return (Array.isArray(data) ? data : []).map((row) =>
        parseOutsourcedPairLine(row as Record<string, unknown>),
      );
    },
  });
}

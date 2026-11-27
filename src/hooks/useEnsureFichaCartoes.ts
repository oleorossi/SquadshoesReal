import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  FICHA_CARTAO_SETOR_PALMILHA,
  type FichaCartaoRow,
} from '@/lib/fichaCartoes';

type EnsureFichaCartoesRpc = {
  rpc: (
    fn: 'ensure_ficha_cartoes_for_ops',
    args: { p_order_ids: string[]; p_setor: string },
  ) => Promise<{ data: FichaCartaoRow[] | null; error: { message: string } | null }>;
};

export function useEnsureFichaCartoes(orderIds: string[], enabled: boolean) {
  const ids = Array.from(new Set(orderIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ['ficha_cartoes', 'ensure', FICHA_CARTAO_SETOR_PALMILHA, ids.join(',')],
    enabled: enabled && ids.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<FichaCartaoRow[]> => {
      const { data, error } = await (supabase as unknown as EnsureFichaCartoesRpc).rpc(
        'ensure_ficha_cartoes_for_ops',
        {
          p_order_ids: ids,
          p_setor: FICHA_CARTAO_SETOR_PALMILHA,
        },
      );
      if (error) throw error;
      return data || [];
    },
  });
}

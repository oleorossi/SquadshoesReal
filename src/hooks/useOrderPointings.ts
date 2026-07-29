import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * LEDGER DE PRODUÇÃO — a trilha de quem apontou o quê, quando e quanto.
 *
 * ⚠ Este é o PRIMEIRO leitor de `production_pointings` no sistema. A tabela
 * existia, tinha RLS, era append-only e alimentava o recompute por trigger — mas
 * NENHUMA tela consultava (a key `['production_pointings']` só aparecia na lista
 * de invalidação). Na prática o histórico de produção era invisível: não dava pra
 * responder "quem fechou esse setor?", "quando entrou?", "quanto foi apontado de
 * uma vez?" nem desfazer com confiança.
 *
 * ⚠ COBERTURA: o ledger só reflete o que passou por `apontar_producao_setor`.
 * Até 2026-07-29 as telas de setor finalizavam por `finalize_production_sector`,
 * que não grava aqui — por isso OPs antigas aparecem com trilha vazia ou parcial
 * mesmo tendo produção. Não é bug desta tela; é o passivo daquele caminho.
 * Ver `useProductionTransitions.finalizeSectorTask`.
 */
export interface OrderPointing {
  id: string;
  order_id: string;
  order_stage_id: string | null;
  stage_name: string;
  /** Incremento em pares. NEGATIVO = estorno/correção. */
  quantity: number;
  note: string | null;
  created_at: string;
  created_by: string | null;
  confirmed_warnings: string[] | null;
  /** Nome de quem lançou, resolvido de `profiles` (pode faltar em linha antiga). */
  author_name: string | null;
}

export function useOrderPointings(orderId: string | null | undefined) {
  return useQuery({
    queryKey: ['production_pointings', orderId],
    enabled: !!orderId,
    // Curto: a trilha é lida logo depois de apontar, e a lista central de
    // invalidação já inclui ['production_pointings'].
    staleTime: 10 * 1000,
    queryFn: async (): Promise<OrderPointing[]> => {
      const { data, error } = await supabase
        .from('production_pointings')
        .select('id, order_id, order_stage_id, stage_name, quantity, note, created_at, created_by, confirmed_warnings')
        .eq('order_id', orderId!)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const rows = (data || []) as Omit<OrderPointing, 'author_name'>[];
      const authorIds = [...new Set(rows.map(r => r.created_by).filter(Boolean))] as string[];
      if (authorIds.length === 0) return rows.map(r => ({ ...r, author_name: null }));

      // Join no cliente: `production_pointings.created_by` aponta pra auth.users,
      // sem FK declarada pra `profiles` — o embed do PostgREST não resolve.
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', authorIds);
      const byId = new Map(
        (profs || []).map((p: { id: string; full_name: string | null; email: string | null }) =>
          [p.id, p.full_name || p.email || null]),
      );
      return rows.map(r => ({ ...r, author_name: r.created_by ? byId.get(r.created_by) ?? null : null }));
    },
  });
}

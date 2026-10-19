/**
 * Rendimento e origem operacional do grupo de tira (specs/tira-material-de-estoque.md R3/R18).
 * Fonte: product_groups.strap_* + strap_group_napa_yields via set_strap_group_napa_yield.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface UntypedQueryResult {
  data: unknown;
  error: unknown;
}

interface UntypedQueryBuilder extends PromiseLike<UntypedQueryResult> {
  select: (columns?: string) => UntypedQueryBuilder;
  eq: (column: string, value: unknown) => UntypedQueryBuilder;
  in: (column: string, values: unknown[]) => UntypedQueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => UntypedQueryBuilder;
  is: (column: string, value: null) => UntypedQueryBuilder;
}

interface UntypedSupabaseClient {
  rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<UntypedQueryResult>;
  from: (name: string) => UntypedQueryBuilder;
}

const db = supabase as unknown as UntypedSupabaseClient;

export type StrapOrigin = 'comprar_pronto' | 'fabrica' | 'prestador';

export interface StrapGroupNapaYield {
  napa_group_id: string;
  napa_group_name: string;
  yield_m_per_m: number | null;
}

export const strapGroupYieldsKey = (strapGroupId: string | null | undefined) =>
  ['strap-group-napa-yields', strapGroupId ?? ''] as const;

function errMsg(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Erro desconhecido';
}

/** Napas-base elegíveis para cadastrar rendimento (mesmo critério do Hub). */
export function useStrapNapaBaseCandidates(enabled = true) {
  return useQuery({
    queryKey: ['strap-napa-base-candidates'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc('list_strap_base_group_candidates');
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: String(r.group_id ?? r.id ?? ''),
          name: String(r.group_name ?? r.name ?? ''),
        };
      }).filter((r) => r.id && r.name);
    },
  });
}

export function useStrapGroupNapaYields(strapGroupId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: strapGroupYieldsKey(strapGroupId),
    enabled: enabled && !!strapGroupId,
    staleTime: 15_000,
    queryFn: async (): Promise<StrapGroupNapaYield[]> => {
      const plain = await db
        .from('strap_group_napa_yields')
        .select('napa_group_id, yield_m_per_m')
        .eq('strap_group_id', strapGroupId);
      if (plain.error) throw plain.error;
      const rows = (Array.isArray(plain.data) ? plain.data : []) as Array<{
        napa_group_id: string;
        yield_m_per_m: number;
      }>;
      const ids = rows.map((r) => r.napa_group_id);
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const groups = await db.from('product_groups').select('id, name').in('id', ids);
        if (groups.error) throw groups.error;
        for (const g of (Array.isArray(groups.data) ? groups.data : []) as Array<{ id: string; name: string }>) {
          names.set(g.id, g.name);
        }
      }
      return rows.map((row) => ({
        napa_group_id: row.napa_group_id,
        napa_group_name: names.get(row.napa_group_id) || 'Napa',
        yield_m_per_m: Number(row.yield_m_per_m) || null,
      }));
    },
  });
}

export function useSetStrapGroupNapaYield() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      strapGroupId: string;
      napaGroupId: string;
      yieldMPerM: number | null;
    }) => {
      const { error } = await db.rpc('set_strap_group_napa_yield', {
        p_strap_group_id: input.strapGroupId,
        p_napa_group_id: input.napaGroupId,
        p_yield_m_per_m: input.yieldMPerM,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: strapGroupYieldsKey(vars.strapGroupId) });
      toast.success(
        vars.yieldMPerM == null
          ? 'Rendimento removido.'
          : `Rendimento ${vars.yieldMPerM} m/m gravado.`,
      );
    },
    onError: (err: unknown) => toast.error(`Erro ao gravar rendimento: ${errMsg(err)}`),
  });
}

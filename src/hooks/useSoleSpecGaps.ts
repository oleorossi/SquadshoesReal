import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Linha acionável de `list_sole_spec_gaps()` — numeração vendida sem spec. */
export interface SoleSpecGapRow {
  solado: string;
  solado_id: string;
  numeracao: number;
  pares_vendidos: number;
  fichas: string;
  pvs: string;
  forro_palmilha_zera: boolean;
}

/** Solado marcado fachetado sem dm² de fachete nas specs. */
export interface SoleFacheteGapRow {
  product_id: string;
  name: string;
  color: string | null;
  group_id: string | null;
}

export const soleSpecGapsKey = ['list_sole_spec_gaps'] as const;
export const soleFacheteGapsKey = ['sole_fachetado_sem_specs_fachete'] as const;

export function useSoleSpecGaps(enabled = true) {
  return useQuery({
    queryKey: soleSpecGapsKey,
    enabled,
    queryFn: async (): Promise<SoleSpecGapRow[]> => {
      const { data, error } = await supabase.rpc('list_sole_spec_gaps');
      if (error) throw error;
      return ((data ?? []) as SoleSpecGapRow[]).map((row) => ({
        ...row,
        pares_vendidos: Number(row.pares_vendidos) || 0,
        numeracao: Number(row.numeracao) || 0,
        forro_palmilha_zera: Boolean(row.forro_palmilha_zera),
      }));
    },
    staleTime: 60_000,
  });
}

/**
 * Espelha o check `solado_fachetado_sem_specs_fachete` do consistency report:
 * produto de solado com `is_fachetado` e sem nenhum valor > 0 em
 * fachete_lining_consumption_per_size / escalar.
 */
export function useSoleFacheteGaps(enabled = true) {
  return useQuery({
    queryKey: soleFacheteGapsKey,
    enabled,
    queryFn: async (): Promise<SoleFacheteGapRow[]> => {
      const { data: products, error } = await supabase
        .from('products')
        .select('id, name, color, group_id, is_fachetado, category')
        .eq('active', true)
        .eq('is_fachetado', true);
      if (error) throw error;

      const soles = ((products ?? []) as Array<{
        id: string;
        name: string;
        color: string | null;
        group_id: string | null;
        category: string | null;
      }>).filter((p) => {
        const cat = (p.category ?? '').toLowerCase();
        return cat === 'solado' || cat === 'sola' || cat.startsWith('solado');
      });
      if (soles.length === 0) return [];

      const ids = soles.map((p) => p.id);
      const { data: specs, error: specsError } = await supabase
        .from('sole_technical_specs')
        .select('sole_id, fachete_lining_consumption_dm2, fachete_lining_consumption_per_size')
        .in('sole_id', ids);
      if (specsError) throw specsError;

      const hasFachete = new Set<string>();
      for (const row of (specs ?? []) as Array<{
        sole_id: string;
        fachete_lining_consumption_dm2: number | null;
        fachete_lining_consumption_per_size: Record<string, unknown> | null;
      }>) {
        if (Number(row.fachete_lining_consumption_dm2) > 0) {
          hasFachete.add(row.sole_id);
          continue;
        }
        const perSize = row.fachete_lining_consumption_per_size || {};
        if (Object.values(perSize).some((v) => Number(v) > 0)) {
          hasFachete.add(row.sole_id);
        }
      }

      return soles
        .filter((p) => !hasFachete.has(p.id))
        .map((p) => ({
          product_id: p.id,
          name: p.name,
          color: p.color,
          group_id: p.group_id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    },
    staleTime: 60_000,
  });
}

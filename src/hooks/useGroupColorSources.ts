import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface GroupColorSource {
  source_group_id: string;
  source_group_name: string;
}

export interface AvailableSourceColor {
  color_id: string;
  color_name: string;
  color_hex: string;
  color_pantone: string;
  source_group_id: string;
  source_group_name: string;
}

/** Lista grupos-origem cujas cores podem ser importadas pra este grupo. */
export function useGroupColorSources(groupId: string | null) {
  return useQuery({
    queryKey: ['group_color_sources', groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('group_color_sources')
        .select('source_group_id, product_groups!group_color_sources_source_group_id_fkey(name)')
        .eq('group_id', groupId);
      if (error) throw error;
      return ((data || []) as any[]).map(r => ({
        source_group_id: r.source_group_id,
        source_group_name: r.product_groups?.name ?? '—',
      })) as GroupColorSource[];
    },
    staleTime: 60_000,
  });
}

/** Cores das fontes que NÃO estão na paleta deste grupo — pra importação. */
export function useAvailableSourceColors(groupId: string | null) {
  return useQuery({
    queryKey: ['available_source_colors', groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .rpc('list_available_source_colors', { p_group_id: groupId });
      if (error) throw error;
      return (data || []) as AvailableSourceColor[];
    },
    staleTime: 30_000,
  });
}

export function useAddColorSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, sourceGroupId }: { groupId: string; sourceGroupId: string }) => {
      const { error } = await (supabase as any).from('group_color_sources').insert({
        group_id: groupId,
        source_group_id: sourceGroupId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['group_color_sources', vars.groupId] });
      qc.invalidateQueries({ queryKey: ['available_source_colors', vars.groupId] });
      toast.success('Grupo-origem vinculado. Importe as cores que quiser usar.');
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
}

export function useRemoveColorSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, sourceGroupId }: { groupId: string; sourceGroupId: string }) => {
      const { error } = await (supabase as any).from('group_color_sources')
        .delete()
        .eq('group_id', groupId)
        .eq('source_group_id', sourceGroupId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['group_color_sources', vars.groupId] });
      qc.invalidateQueries({ queryKey: ['available_source_colors', vars.groupId] });
      toast.success('Grupo-origem removido. Cores já importadas permanecem.');
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
}

/**
 * Importa N cores selecionadas pra paleta do grupo. NÃO duplica:
 * group_colors tem unique (group_id, color_id) implícito via PK.
 */
export function useImportColorsFromSources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, colorIds }: { groupId: string; colorIds: string[] }) => {
      if (colorIds.length === 0) return { inserted: 0 };
      const rows = colorIds.map(cid => ({ group_id: groupId, color_id: cid }));
      const { error } = await (supabase as any).from('group_colors')
        .upsert(rows, { onConflict: 'group_id,color_id', ignoreDuplicates: true });
      if (error) throw error;
      return { inserted: rows.length };
    },
    onSuccess: ({ inserted }, vars) => {
      qc.invalidateQueries({ queryKey: ['group_colors', vars.groupId] });
      qc.invalidateQueries({ queryKey: ['available_source_colors', vars.groupId] });
      qc.invalidateQueries({ queryKey: ['group_colors_all'] });
      toast.success(`${inserted} ${inserted === 1 ? 'cor importada' : 'cores importadas'} pra paleta.`);
    },
    onError: (err: any) => toast.error(`Erro ao importar: ${err.message}`),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface GroupColor {
  id: string;
  group_id: string;
  color_id: string;
  color_name: string;
  color_hex: string;
  color_pantone: string;
}

export function useGroupColors(groupId: string | null) {
  return useQuery({
    queryKey: ['group_colors', groupId],
    enabled: !!groupId,
    queryFn: async () => {
      if (!groupId) return [];
      const { data, error } = await supabase
        .from('group_colors')
        .select('id, group_id, color_id, colors!inner(nome, referencia_hex, referencia_pantone)')
        .eq('group_id', groupId);
      if (error) throw error;
      return (data || []).map((row: any) => ({
        id: row.id,
        group_id: row.group_id,
        color_id: row.color_id,
        color_name: row.colors.nome,
        color_hex: row.colors.referencia_hex || '',
        color_pantone: row.colors.referencia_pantone || '',
      })) as GroupColor[];
    },
  });
}

export function useAllGroupColors() {
  return useQuery({
    queryKey: ['group_colors_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_colors')
        .select('id, group_id, color_id, colors!inner(nome, referencia_hex, referencia_pantone)');
      if (error) throw error;
      return (data || []).map((row: any) => ({
        id: row.id,
        group_id: row.group_id,
        color_id: row.color_id,
        color_name: row.colors.nome,
        color_hex: row.colors.referencia_hex || '',
        color_pantone: row.colors.referencia_pantone || '',
      })) as GroupColor[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useAddGroupColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, colorId }: { groupId: string; colorId: string }) => {
      const { error } = await supabase
        .from('group_colors')
        .insert({ group_id: groupId, color_id: colorId } as any);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['group_colors', vars.groupId] });
      qc.invalidateQueries({ queryKey: ['group_colors_all'] });
    },
    onError: (err: Error) => {
      if (err.message.includes('duplicate')) {
        toast.info('Cor já vinculada a este grupo');
      } else {
        toast.error(`Erro: ${err.message}`);
      }
    },
  });
}

export function useRemoveGroupColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, groupId }: { id: string; groupId: string }) => {
      const { error } = await supabase
        .from('group_colors')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return groupId;
    },
    onSuccess: (groupId) => {
      qc.invalidateQueries({ queryKey: ['group_colors', groupId] });
      qc.invalidateQueries({ queryKey: ['group_colors_all'] });
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useSyncGroupColors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, colorIds }: { groupId: string; colorIds: string[] }) => {
      // Get current links
      const { data: existing, error: fetchErr } = await supabase
        .from('group_colors')
        .select('id, color_id')
        .eq('group_id', groupId);
      if (fetchErr) throw new Error(`Falha ao carregar cores do grupo: ${fetchErr.message}`);
      const currentIds = new Set((existing || []).map((e: any) => e.color_id));
      const targetIds = new Set(colorIds);

      // Remove old
      const toRemove = (existing || []).filter((e: any) => !targetIds.has(e.color_id));
      if (toRemove.length > 0) {
        const { error: delErr } = await supabase
          .from('group_colors')
          .delete()
          .in('id', toRemove.map((e: any) => e.id));
        if (delErr) throw new Error(`Falha ao remover cores antigas: ${delErr.message}`);
      }

      // Add new
      const toAdd = colorIds.filter(id => !currentIds.has(id));
      if (toAdd.length > 0) {
        const { error: insErr } = await supabase
          .from('group_colors')
          .insert(toAdd.map(color_id => ({ group_id: groupId, color_id })) as any);
        if (insErr) throw new Error(`Falha ao adicionar novas cores: ${insErr.message}`);
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['group_colors', vars.groupId] });
      qc.invalidateQueries({ queryKey: ['group_colors_all'] });
      toast.success('Cores do grupo atualizadas!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Padrões GLOBAIS de componente por cor (component_color_defaults, mig
 * 20260928120000): regra (grupo de componente + cor do cabedal/PV) → produto,
 * válida pra TODA ficha que use o grupo (componentes diretos e tiras). A ficha
 * continua definindo a QUANTIDADE; a lista por-cor da ficha
 * (technical_sheet_component_colors) tem precedência. Linha is_default =
 * catch-all do grupo (cabedal_color = '*'). Espelha o padrão de
 * useComponentColorMappings, mas com escopo global (sem sheet_id).
 */
export type ComponentColorDefault = {
  id: string;
  group_id: string;
  cabedal_color: string;
  product_id: string;
  is_default: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/** Todas as regras (ativas e inativas). groupId opcional filtra por grupo. */
export function useComponentColorDefaults(groupId?: string) {
  return useQuery({
    queryKey: ['component_color_defaults', groupId ?? 'all'],
    queryFn: async () => {
      let query = (supabase as any)
        .from('component_color_defaults')
        .select('*')
        .order('cabedal_color');
      if (groupId) query = query.eq('group_id', groupId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as ComponentColorDefault[];
    },
  });
}

/** Cria uma regra (cor exata ou default/catch-all com cabedal_color '*'). */
export function useAddComponentColorDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      groupId,
      cabedalColor,
      productId,
      isDefault,
    }: {
      groupId: string;
      cabedalColor: string;
      productId: string;
      isDefault?: boolean;
    }) => {
      const { error } = await (supabase as any)
        .from('component_color_defaults')
        .insert({
          group_id: groupId,
          cabedal_color: isDefault ? '*' : cabedalColor,
          product_id: productId,
          is_default: !!isDefault,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['component_color_defaults'] });
      toast.success('Regra criada!');
    },
    onError: (err: any) => {
      // 23505: unique (grupo, cor normalizada) OU default duplicado do grupo.
      toast.error(err?.code === '23505'
        ? 'Já existe regra pra essa cor neste grupo.'
        : `Erro: ${err.message}`);
    },
  });
}

/** Atualiza produto/cor/ativo de uma regra. */
export function useUpdateComponentColorDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      productId,
      cabedalColor,
      active,
    }: {
      id: string;
      productId?: string;
      cabedalColor?: string;
      active?: boolean;
    }) => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (productId !== undefined) patch.product_id = productId;
      if (cabedalColor !== undefined) patch.cabedal_color = cabedalColor;
      if (active !== undefined) patch.active = active;
      const { error } = await (supabase as any)
        .from('component_color_defaults')
        .update(patch)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['component_color_defaults'] });
      toast.success('Regra atualizada!');
    },
    onError: (err: any) => {
      toast.error(err?.code === '23505'
        ? 'Já existe regra pra essa cor neste grupo.'
        : `Erro: ${err.message}`);
    },
  });
}

/** Remove uma regra. */
export function useDeleteComponentColorDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await (supabase as any)
        .from('component_color_defaults')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['component_color_defaults'] });
      toast.success('Regra removida.');
    },
    onError: (err: any) => {
      toast.error(`Erro: ${err.message}`);
    },
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Organização dos Grupos de Estoque — árvore Setor → Família → Grupo.
 * Ver specs/grupos-estoque.md.
 *
 * - Rollups de estoque por grupo-folha (read model SQL get_group_stock_rollups).
 * - Sugestões de família opt-in (suggest_group_families) — read-only, não aplica nada.
 * - Mutations de organização: criar família, mover grupos p/ família, mover itens
 *   entre grupos, desvincular subgrupo. Os invariantes (container/profundidade/
 *   mono-setor) são garantidos por triggers no banco; aqui só disparamos os writes
 *   e traduzimos o erro PT-BR do trigger no toast.
 */

export type GroupStockRollup = {
  group_id: string;
  item_count: number;
  stock_value: number;
  reserved: number;
  available: number;
  below_min_count: number;
  unit_count: number;
  stock_unit: string | null;
};

export type FamilySuggestion = {
  suggested_family: string;
  sector: string;
  member_group_ids: string[];
  member_names: string[];
};

/** Mapa group_id → rollup de estoque (só grupos-folha com itens aparecem). */
export function useGroupStockRollups() {
  return useQuery({
    queryKey: ['group_stock_rollups'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_group_stock_rollups');
      if (error) throw error;
      const map = new Map<string, GroupStockRollup>();
      for (const r of (data ?? []) as GroupStockRollup[]) map.set(r.group_id, r);
      return map;
    },
    staleTime: 60 * 1000,
  });
}

/** Sugestões opt-in de famílias (prefixo comum entre grupos soltos, por setor). */
export function useSuggestGroupFamilies(enabled = true) {
  return useQuery({
    queryKey: ['group_family_suggestions'],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('suggest_group_families');
      if (error) throw error;
      return (data ?? []) as FamilySuggestion[];
    },
    staleTime: 30 * 1000,
  });
}

function invalidateGroupData(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['product_groups'] });
  qc.invalidateQueries({ queryKey: ['products'] });
  qc.invalidateQueries({ queryKey: ['group_stock_rollups'] });
  qc.invalidateQueries({ queryKey: ['group_family_suggestions'] });
}

/** Cria uma família (grupo container). Nome em CAIXA ALTA, setor obrigatório. */
export function useCreateFamily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, sector, description }: { name: string; sector: string; description?: string }) => {
      const { data, error } = await supabase
        .from('product_groups')
        .insert({ name: name.trim().toUpperCase(), sector, description: description ?? '', is_family: true } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidateGroupData(qc); toast.success('Família criada!'); },
    onError: (err: any) => {
      if (err?.code === '23505') { toast.error('Já existe um grupo/família com esse nome.'); return; }
      toast.error(err?.message ?? 'Erro ao criar família.');
    },
  });
}

/**
 * Move grupos-folha para uma família (ou desvincula, se familyId === null).
 * Vínculo não reclassifica setor: a UI oferece apenas famílias do mesmo setor e
 * o banco recusa qualquer drift. Ao desvincular, mantém o setor atual.
 */
export function useMoveGroupsToFamily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ familyId, groupIds }: { familyId: string | null; groupIds: string[] }) => {
      if (groupIds.length === 0) return;
      const { error } = await supabase
        .from('product_groups')
        .update({ parent_group_id: familyId } as any)
        .in('id', groupIds);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidateGroupData(qc);
      toast.success(vars.familyId ? 'Grupos movidos para a família!' : 'Grupos desvinculados (viraram soltos).');
    },
    onError: (err: any) => toast.error(err?.message ?? 'Erro ao mover grupos.'),
  });
}

/** Move itens (produtos) para um grupo-folha. Bloqueado pelo trigger se o destino for container. */
export function useMoveItemsToGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, productIds }: { groupId: string; productIds: string[] }) => {
      if (productIds.length === 0) return;
      const { error } = await (supabase.from('products') as any).update({ group_id: groupId }).in('id', productIds);
      if (error) throw error;
    },
    onSuccess: () => { invalidateGroupData(qc); toast.success('Itens movidos!'); },
    onError: (err: any) => toast.error(err?.message ?? 'Erro ao mover itens.'),
  });
}

/** Aplica uma sugestão de família: cria a família e vincula os grupos membros. */
export function useApplyFamilySuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, sector, memberGroupIds }: { name: string; sector: string; memberGroupIds: string[] }) => {
      const { data: family, error: cErr } = await supabase
        .from('product_groups')
        .insert({ name: name.trim().toUpperCase(), sector, description: '', is_family: true } as any)
        .select()
        .single();
      if (cErr) throw cErr;
      const { error: mErr } = await supabase
        .from('product_groups')
        .update({ parent_group_id: (family as any).id } as any)
        .in('id', memberGroupIds);
      if (mErr) throw mErr;
      return family;
    },
    onSuccess: () => { invalidateGroupData(qc); toast.success('Família criada e grupos vinculados!'); },
    onError: (err: any) => {
      if (err?.code === '23505') { toast.error('Já existe um grupo/família com esse nome — renomeie a sugestão.'); return; }
      toast.error(err?.message ?? 'Erro ao aplicar sugestão.');
    },
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Consumo padrão de um MODELO (grupo) de solado.
 *
 * Duas naturezas de linha, uma tela só:
 *
 *  ITEM  — o solado manda no material E na quantidade (cola, linha, EVA).
 *          Mora em `sole_group_standard_items`, chaveado por grupo.
 *
 *  PAPEL — o solado manda só na quantidade; QUAL material entra é decidido pela
 *          ficha do modelo / PV (forro do cabedal, placa e forração da palmilha,
 *          fachete). Continua em `sole_technical_specs` — é a fonte canônica que
 *          o motor TS (orderConsumption.ts) e o SQL (calculate_order_consumption*)
 *          já leem. Aqui só mudamos a ESCRITA: passa a ser por grupo, espelhada
 *          em todas as cores pelo RPC `set_sole_group_role_consumption`.
 *
 * Ver migrations 20261102120000 / 20261102120100.
 */

export type SoleRole = 'forro_cabedal' | 'placa_palmilha' | 'forracao_palmilha' | 'fachete';

/** Papel → coluna escalar e coluna por-numeração em `sole_technical_specs`. */
export const ROLE_COLUMNS: Record<SoleRole, { scalar: string; perSize: string }> = {
  forro_cabedal: { scalar: 'lining_consumption_dm2', perSize: 'lining_consumption_per_size' },
  placa_palmilha: { scalar: 'insole_consumption_dm2', perSize: 'insole_consumption_per_size' },
  forracao_palmilha: { scalar: 'insole_lining_consumption_dm2', perSize: 'insole_lining_consumption_per_size' },
  fachete: { scalar: 'fachete_lining_consumption_dm2', perSize: 'fachete_lining_consumption_per_size' },
};

export const ROLE_LABEL: Record<SoleRole, string> = {
  forro_cabedal: 'Forro do cabedal',
  placa_palmilha: 'Placa da palmilha',
  forracao_palmilha: 'Forração da palmilha',
  fachete: 'Fachete',
};

/** Quem escolhe o material de cada papel — texto exibido na linha. */
export const ROLE_SOURCE: Record<SoleRole, string> = {
  forro_cabedal: 'material escolhido pela ficha e pelo PV',
  placa_palmilha: 'material escolhido pela ficha',
  forracao_palmilha: 'material escolhido pela ficha e pelo PV',
  fachete: 'material escolhido pelo grupo de fachete do solado',
};

/**
 * Papéis aplicáveis à classificação do solado. Palmilha pronta vem forrada de
 * fábrica: não tem placa nem forração de palmilha. Fachete só quando fachetado.
 */
export function rolesForSole(
  classification?: string | null,
  isFachetado?: boolean | null,
): SoleRole[] {
  const roles: SoleRole[] = ['forro_cabedal'];
  if (classification !== 'palmilha_pronta') {
    roles.push('placa_palmilha', 'forracao_palmilha');
  }
  if (isFachetado) roles.push('fachete');
  return roles;
}

export interface SoleGroupItemRow {
  id: string;
  sole_group_id: string;
  material_product_id: string;
  consumption_per_pair: number;
  consumption_per_size: Record<string, number>;
  unit: string | null;
  applies_to: 'any' | 'palmilha_cortada' | 'palmilha_pronta';
  notes: string | null;
  display_order: number;
  products?: { name: string; sku: string | null; unit: string; category: string; color: string | null };
}

export interface RoleValue {
  role: SoleRole;
  /** Valor único por par. Quando a grade varia, é a média das numerações. */
  perPair: number;
  /** { '33': 3.8, … } — só preenchido quando as numerações divergem. */
  perSize: Record<string, number>;
  /** true quando as numerações NÃO são todas iguais. */
  variesBySize: boolean;
  /** Numerações da grade do solado, ordenadas. */
  sizes: number[];
}

/** Linhas do tipo ITEM de um grupo de solado. */
export function useSoleGroupItems(soleGroupId: string | null | undefined) {
  return useQuery({
    queryKey: ['sole_group_standard_items', soleGroupId],
    enabled: !!soleGroupId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sole_group_standard_items')
        .select('*, products!material_product_id(name, sku, unit, category, color)')
        .eq('sole_group_id', soleGroupId)
        .order('display_order')
        .order('created_at');
      if (error) throw error;
      return (data || []) as SoleGroupItemRow[];
    },
    staleTime: 30_000,
  });
}

/**
 * Linhas do tipo PAPEL, derivadas de `sole_technical_specs` de TODAS as cores
 * do grupo. Auditoria de 02/08/2026: os valores são idênticos entre variantes
 * de cor nos 5 grupos, então colapsar por numeração é sem perda. Se um dia
 * divergirem, vence a primeira variante e `variesBySize` acusa a diferença
 * entre numerações (não entre cores).
 */
export function useSoleGroupRoles(soleGroupId: string | null | undefined) {
  return useQuery({
    queryKey: ['sole_group_roles', soleGroupId],
    enabled: !!soleGroupId,
    queryFn: async () => {
      const { data: soles, error: solesErr } = await supabase
        .from('products')
        .select('id')
        .eq('group_id', soleGroupId);
      if (solesErr) throw solesErr;

      const soleIds = (soles || []).map((s: any) => s.id);
      if (soleIds.length === 0) return { byRole: {} as Record<SoleRole, RoleValue>, sizes: [] as number[] };

      const cols = Object.values(ROLE_COLUMNS).map((c) => c.scalar).join(', ');
      const { data, error } = await (supabase as any)
        .from('sole_technical_specs')
        .select(`sole_id, size, ${cols}`)
        .in('sole_id', soleIds)
        .order('size');
      if (error) throw error;

      const rows = (data || []) as any[];
      const sizes = Array.from(new Set(rows.map((r) => Number(r.size)))).sort((a, b) => a - b);

      const byRole = {} as Record<SoleRole, RoleValue>;
      (Object.keys(ROLE_COLUMNS) as SoleRole[]).forEach((role) => {
        const col = ROLE_COLUMNS[role].scalar;
        const perSize: Record<string, number> = {};
        sizes.forEach((s) => {
          // Primeira variante de cor que tiver valor para esta numeração.
          const hit = rows.find((r) => Number(r.size) === s && r[col] != null);
          if (hit) perSize[String(s)] = Number(hit[col]);
        });
        const values = Object.values(perSize);
        const variesBySize = values.length > 1 && new Set(values).size > 1;
        const perPair = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        byRole[role] = {
          role,
          perPair: Number(perPair.toFixed(4)),
          perSize,
          variesBySize,
          sizes,
        };
      });

      return { byRole, sizes };
    },
    staleTime: 30_000,
  });
}

/** Grava um PAPEL em todas as cores e numerações do grupo. */
export function useSetSoleGroupRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      soleGroupId: string;
      role: SoleRole;
      perPair: number;
      perSize?: Record<string, number>;
    }) => {
      const { data, error } = await (supabase as any).rpc('set_sole_group_role_consumption', {
        p_sole_group_id: params.soleGroupId,
        p_role: params.role,
        p_per_pair: params.perPair,
        p_per_size: params.perSize && Object.keys(params.perSize).length > 0 ? params.perSize : {},
      });
      if (error) throw error;
      return Number(data) || 0;
    },
    onSuccess: (rows, vars) => {
      qc.invalidateQueries({ queryKey: ['sole_group_roles', vars.soleGroupId] });
      qc.invalidateQueries({ queryKey: ['sole_technical_specs'] });
      toast.success(`${ROLE_LABEL[vars.role]} salvo em ${rows} ${rows === 1 ? 'numeração' : 'numerações'} do modelo.`);
    },
    onError: (err: Error) => toast.error(`Erro ao salvar: ${err.message}`),
  });
}

/** Cria ou atualiza uma linha do tipo ITEM. */
export function useUpsertSoleGroupItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id?: string;
      soleGroupId: string;
      materialProductId: string;
      perPair: number;
      perSize?: Record<string, number>;
      unit?: string | null;
      appliesTo?: 'any' | 'palmilha_cortada' | 'palmilha_pronta';
      notes?: string | null;
      displayOrder?: number;
    }) => {
      const payload = {
        sole_group_id: params.soleGroupId,
        material_product_id: params.materialProductId,
        consumption_per_pair: params.perPair,
        consumption_per_size: params.perSize || {},
        unit: params.unit ?? null,
        applies_to: params.appliesTo || 'any',
        notes: params.notes ?? null,
        display_order: params.displayOrder ?? 0,
      };
      const query = params.id
        ? (supabase as any).from('sole_group_standard_items').update(payload).eq('id', params.id)
        : (supabase as any).from('sole_group_standard_items').insert(payload);
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['sole_group_standard_items', vars.soleGroupId] });
      toast.success('Item padrão salvo.');
    },
    onError: (err: Error) => toast.error(`Erro ao salvar: ${err.message}`),
  });
}

export function useRemoveSoleGroupItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; soleGroupId: string }) => {
      const { error } = await (supabase as any)
        .from('sole_group_standard_items')
        .delete()
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['sole_group_standard_items', vars.soleGroupId] });
      toast.success('Item removido.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/** Copia todos os itens de um grupo de solado para outro (modo merge). */
export function useCopySoleGroupItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { fromGroupId: string; toGroupId: string; overwrite: boolean }) => {
      const { data: source, error: srcErr } = await (supabase as any)
        .from('sole_group_standard_items')
        .select('material_product_id, consumption_per_pair, consumption_per_size, unit, applies_to, notes, display_order')
        .eq('sole_group_id', params.fromGroupId);
      if (srcErr) throw srcErr;
      if (!source || source.length === 0) throw new Error('O modelo de origem não tem itens cadastrados.');

      if (params.overwrite) {
        await (supabase as any)
          .from('sole_group_standard_items')
          .delete()
          .eq('sole_group_id', params.toGroupId);
      }

      const { data: existing } = await (supabase as any)
        .from('sole_group_standard_items')
        .select('material_product_id, applies_to')
        .eq('sole_group_id', params.toGroupId);
      const seen = new Set((existing || []).map((r: any) => `${r.material_product_id}|${r.applies_to}`));

      const rows = (source as any[])
        .filter((r) => !seen.has(`${r.material_product_id}|${r.applies_to}`))
        .map((r, i) => ({ ...r, sole_group_id: params.toGroupId, display_order: i }));

      if (rows.length === 0) throw new Error('Todos os itens já estão neste modelo.');

      const { error } = await (supabase as any).from('sole_group_standard_items').insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count, vars) => {
      qc.invalidateQueries({ queryKey: ['sole_group_standard_items', vars.toGroupId] });
      toast.success(`${count} ${count === 1 ? 'item copiado' : 'itens copiados'}.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Grupos de solado que já têm itens — alimenta o "copiar de outro modelo". */
export function useSoleGroupsWithItems(exceptGroupId?: string | null) {
  return useQuery({
    queryKey: ['sole_groups_with_items', exceptGroupId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sole_group_standard_items')
        .select('sole_group_id, product_groups!sole_group_id(id, name)');
      if (error) throw error;
      const uniq = new Map<string, { id: string; name: string; count: number }>();
      ((data || []) as any[]).forEach((r) => {
        const g = r.product_groups;
        if (!g || g.id === exceptGroupId) return;
        const entry = uniq.get(g.id) || { id: g.id, name: g.name, count: 0 };
        entry.count += 1;
        uniq.set(g.id, entry);
      });
      return Array.from(uniq.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    },
    staleTime: 60_000,
  });
}

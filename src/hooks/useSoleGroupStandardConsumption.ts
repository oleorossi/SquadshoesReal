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
 *          fachete). Mora na MESMA tabela, com `role` preenchido e
 *          `material_product_id` nulo.
 *
 * `sole_technical_specs` continua existindo, mas como ESPELHO DERIVADO: o
 * trigger `tg_sgsi_mirror_papel` replica as linhas PAPEL nas colunas de consumo
 * de todas as cores × numerações do grupo. É o que mantém corretos os 12
 * consumidores SQL e o motor TS sem precisar migrar leitor a leitor. Por isso a
 * aba "Forração / Palmilha" é somente leitura no consumo — escrever lá geraria
 * um valor que o próximo salvamento daqui sobrescreve.
 *
 * Ver migrations 20261102120000 / 20261102120100 / 20261102120200.
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
        // PAPEL (role preenchido) é renderizado no bloco próprio da tela.
        .is('role', null)
        .order('display_order')
        .order('created_at');
      if (error) throw error;
      return (data || []) as SoleGroupItemRow[];
    },
    staleTime: 30_000,
  });
}

/**
 * Linhas do tipo PAPEL — lidas de `sole_group_standard_items` (fonte da verdade
 * desde a migration 20261102120200). `sole_technical_specs` continua existindo
 * como ESPELHO derivado, mantido pelo trigger `tg_sgsi_mirror_papel`, e é dele
 * que vem a lista de NUMERAÇÕES da grade — a grade é do solado, não do consumo.
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

      const [{ data: gradeRows, error: gradeErr }, { data: roleRows, error: roleErr }] = await Promise.all([
        (supabase as any).from('sole_technical_specs').select('size').in('sole_id', soleIds).order('size'),
        (supabase as any)
          .from('sole_group_standard_items')
          .select('role, consumption_per_pair, consumption_per_size')
          .eq('sole_group_id', soleGroupId)
          .not('role', 'is', null),
      ]);
      if (gradeErr) throw gradeErr;
      if (roleErr) throw roleErr;

      const sizes = Array.from(new Set(((gradeRows || []) as any[]).map((r) => Number(r.size))))
        .sort((a, b) => a - b);

      const byRole = {} as Record<SoleRole, RoleValue>;
      (Object.keys(ROLE_COLUMNS) as SoleRole[]).forEach((role) => {
        const row = ((roleRows || []) as any[]).find((r) => r.role === role);
        const perSize = (row?.consumption_per_size || {}) as Record<string, number>;
        byRole[role] = {
          role,
          perPair: Number(row?.consumption_per_pair) || 0,
          perSize,
          variesBySize: Object.keys(perSize).length > 0,
          sizes,
        };
      });

      return { byRole, sizes };
    },
    staleTime: 30_000,
  });
}

/**
 * Grava um PAPEL na tabela de origem. O espelho em `sole_technical_specs`
 * (todas as cores × todas as numerações) é responsabilidade do trigger — o
 * cliente não replica nada à mão.
 */
export function useSetSoleGroupRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      soleGroupId: string;
      role: SoleRole;
      perPair: number;
      perSize?: Record<string, number>;
    }) => {
      const { error } = await (supabase as any)
        .from('sole_group_standard_items')
        .upsert(
          {
            sole_group_id: params.soleGroupId,
            role: params.role,
            material_product_id: null,
            consumption_per_pair: params.perPair,
            consumption_per_size:
              params.perSize && Object.keys(params.perSize).length > 0 ? params.perSize : {},
            unit: 'dm²',
          },
          { onConflict: 'sole_group_id,role' },
        );
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['sole_group_roles', vars.soleGroupId] });
      qc.invalidateQueries({ queryKey: ['sole_group_standard_items', vars.soleGroupId] });
      // O espelho mudou em todas as cores do grupo — quem lê specs recarrega.
      qc.invalidateQueries({ queryKey: ['sole_technical_specs'] });
      qc.invalidateQueries({ queryKey: ['soleSpecs'] });
      toast.success(`${ROLE_LABEL[vars.role]} salvo para todas as cores do modelo.`);
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
        .eq('sole_group_id', params.fromGroupId)
        .is('role', null);
      if (srcErr) throw srcErr;
      if (!source || source.length === 0) throw new Error('O modelo de origem não tem itens cadastrados.');

      if (params.overwrite) {
        await (supabase as any)
          .from('sole_group_standard_items')
          .delete()
          .eq('sole_group_id', params.toGroupId)
          .is('role', null);
      }

      const { data: existing } = await (supabase as any)
        .from('sole_group_standard_items')
        .select('material_product_id, applies_to')
        .eq('sole_group_id', params.toGroupId)
        .is('role', null);
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
        .select('sole_group_id, product_groups!sole_group_id(id, name)')
        .is('role', null);
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

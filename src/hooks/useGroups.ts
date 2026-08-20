import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { stripSearchNorm } from '@/lib/searchUtils';

export type ProductGroup = {
  id: string;
  name: string;
  description: string | null;
  is_bom_color_source: boolean;
  auto_component_sheet: boolean;
  dimensions_length: number;
  dimensions_width: number;
  dimensions_thickness: number;
  dimensions_unit: string;
  package_weight_kg: number;
  unit_weight_kg: number;
  package_price: number;
  calculation_method: 'weight' | 'meter';
  parent_group_id: string | null;
  /** Família técnica explícita. Diferente de grupo/linha mesmo quando ainda
   * vazia; famílias nunca recebem produtos diretamente. */
  is_family?: boolean;
  /** Caixas vinculadas ao grupo (solado) por tipo. Fonte que o débito de embalagem
   *  (SQL debit_packaging_for_order) lê pra saber qual box_type consumir. Elo
   *  solado↔caixa: se NULL, o débito não tem o que debitar. */
  box_type_id: string | null;
  box_type_master_id?: string | null;
  box_type_colmeia_id?: string | null;
  box_type_fitilho_id?: string | null;
  /** Pares por caixa por tipo (embalagem). Individual sem valor cai no default
   *  canônico (12, alinhado com NF/TS). */
  pairs_per_box_individual?: number | null;
  pairs_per_box_master?: number | null;
  pairs_per_box_colmeia?: number | null;
  pairs_per_box_fitilho?: number | null;
  /** Metros de fitilho por amarrado (modo individual_fitilho/amarrado). */
  metros_fitilho_per_amarrado?: number | null;
  shared_specs?: boolean;
  consumption_unit?: string | null;
  /** Múltiplo de compra padrão do grupo (embalagem); fallback do item. */
  purchase_multiple?: number | null;
  /** Material BASE sem cor (EVA, cola): consumo/débito resolvem por grupo, nunca
   *  color_mismatch — não dispara o guard "cor não cadastrada". */
  is_color_agnostic?: boolean;
  /** Grupo acabado de tira controlado exclusivamente pelo catálogo canônico. */
  is_artisanal_strap?: boolean;
  /** Setor/categoria EXPLÍCITO do grupo (= products.category canônico). Fonte da
   *  categoria dos itens (substitui a dedução por nome). Mover o grupo de setor
   *  cascateia pra products.category no banco. Ver lib/categoryFromGroup.ts. */
  sector?: string | null;
  created_at: string;
  updated_at: string;
};

export function useGroups() {
  return useQuery({
    queryKey: ['product_groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_groups')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as ProductGroup[];
    },
  });
}

export function useAddGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: {
      name: string;
      description: string;
      sector: string;
      auto_component_sheet?: boolean;
      /** Largura útil do material (mm). O GRUPO é a fonte: o item herda na
       *  criação e só diverge de propósito. Sem ela o dm²/par não vira metro. */
      dimensions_width?: number | null;
      dimensions_unit?: string | null;
      parent_group_id?: string | null;
      is_family?: boolean;
      pairs_per_box_individual?: number | null;
      pairs_per_box_master?: number | null;
      pairs_per_box_colmeia?: number | null;
      pairs_per_box_fitilho?: number | null;
      box_type_id?: string | null;
      box_type_master_id?: string | null;
      box_type_colmeia_id?: string | null;
      box_type_fitilho_id?: string | null;
    }) => {
      const { data, error } = await supabase.from('product_groups').insert(stripSearchNorm(form) as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['product_groups'] }); toast.success('Grupo criado!'); },
    onError: (err: any) => {
      if (err?.code === '23505') { toast.error('Já existe um grupo com esse nome.'); return; }
      toast.error(`Erro: ${err.message}`);
    },
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ProductGroup> }) => {
      const { error } = await supabase.from('product_groups').update(stripSearchNorm(data) as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['product_groups'] }); toast.success('Grupo atualizado!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Preflight: count FKs that the nullify loop below does NOT handle.
      // If these exist the final DELETE will fail anyway, but we surface a friendly
      // error before partially mutating technical_sheets and products.
      const [sheetMatRes, supplierMatRes] = await Promise.all([
        supabase.from('sheet_materials').select('id', { count: 'exact', head: true }).eq('group_id', id),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('group_supplier_materials') as any).select('id', { count: 'exact', head: true }).eq('group_id', id),
      ]);
      // CRITICAL: capture errors. A silent SELECT failure (RLS / network) would
      // produce count===null which (count ?? 0) maps to 0, letting the unsafe
      // FK-nullify step run and partially corrupt technical_sheets/products.
      if (sheetMatRes.error) throw new Error(`Falha ao verificar materiais de BOM: ${sheetMatRes.error.message}`);
      if (supplierMatRes.error) throw new Error(`Falha ao verificar materiais de fornecedor: ${supplierMatRes.error.message}`);
      const blockers: string[] = [];
      if ((sheetMatRes.count ?? 0) > 0) blockers.push(`${sheetMatRes.count} material(is) de BOM`);
      if ((supplierMatRes.count ?? 0) > 0) blockers.push(`${supplierMatRes.count} material(is) de fornecedor`);
      if (blockers.length > 0) {
        throw new Error(`Grupo possui referências ativas: ${blockers.join(' e ')}. Remova-as antes de excluir.`);
      }
      // Manually nullify FK references first. Done before DELETE so PostgreSQL can
      // apply the DELETE atomically: if any unhandled FK still blocks it, we fail
      // here rather than after partially corrupting technical_sheets.
      // cor_palmilha_id e cor_tiras_id foram dropadas em 2026-05 (dead fields).
      // Mantém apenas as FKs ainda usadas.
      const cols = ['cor_predominante_id', 'cor_solado_id'];
      for (const col of cols) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: colErr } = await (supabase.from('technical_sheets') as any).update({ [col]: null }).eq(col, id);
        if (colErr) throw new Error(`Falha ao desvincular fichas técnicas (${col}): ${colErr.message}`);
      }
      // Cabedal Material 1 tem vínculo canônico por UUID. Limpa também o nome
      // espelho para não deixar a ficha apontando para um grupo já excluído.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upperErr } = await (supabase.from('technical_sheets') as any)
        .update({ upper_material_group_id: null, upper_material: '' })
        .eq('upper_material_group_id', id);
      if (upperErr) throw new Error(`Falha ao desvincular cabedal das fichas técnicas: ${upperErr.message}`);
      // Detach products from group (keep them in stock)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: prodErr } = await (supabase.from('products') as any).update({ group_id: null }).eq('group_id', id);
      if (prodErr) throw new Error(`Falha ao desvincular produtos: ${prodErr.message}`);
      const { error } = await supabase.from('product_groups').delete().eq('id', id);
      if (error) throw new Error(`Grupo possui referências ativas — desvincule produtos e fichas técnicas antes de excluir. Detalhe: ${error.message}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product_groups'] });
      // A exclusão desvincula produtos (group_id = null) e fichas no banco —
      // sem invalidar estes, os itens continuavam exibidos sob o grupo apagado.
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['technical_sheets'] });
      toast.success('Grupo excluído!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

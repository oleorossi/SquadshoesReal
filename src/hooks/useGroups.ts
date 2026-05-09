import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  box_type_id: string | null;
  shared_specs?: boolean;
  consumption_unit?: string | null;
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
      auto_component_sheet?: boolean;
      parent_group_id?: string | null;
    }) => {
      const { data, error } = await supabase.from('product_groups').insert(form).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['product_groups'] }); toast.success('Grupo criado!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ProductGroup> }) => {
      const { error } = await supabase.from('product_groups').update(data as any).eq('id', id);
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
      const cols = ['cor_predominante_id', 'cor_palmilha_id', 'cor_tiras_id', 'cor_solado_id'];
      for (const col of cols) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: colErr } = await (supabase.from('technical_sheets') as any).update({ [col]: null }).eq(col, id);
        if (colErr) throw new Error(`Falha ao desvincular fichas técnicas (${col}): ${colErr.message}`);
      }
      // Detach products from group (keep them in stock)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: prodErr } = await (supabase.from('products') as any).update({ group_id: null }).eq('group_id', id);
      if (prodErr) throw new Error(`Falha ao desvincular produtos: ${prodErr.message}`);
      const { error } = await supabase.from('product_groups').delete().eq('id', id);
      if (error) throw new Error(`Grupo possui referências ativas — desvincule produtos e fichas técnicas antes de excluir. Detalhe: ${error.message}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['product_groups'] }); toast.success('Grupo excluído!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

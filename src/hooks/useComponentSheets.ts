import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type ComponentSheetFormData = {
  product_id: string;
  group_id?: string | null;
  default_sole_group_id?: string | null;
  dimensions_length: number;
  dimensions_width: number;
  dimensions_thickness: number;
  dimensions_unit: string;
  yield_per_size: Record<string, number>;
  waste_pct: number;
  notes: string;
};

/** Perda de corte padrão (%) — ZERO por decisão do dono (03/08/2026).
 *
 *  REGRA DE NEGÓCIO: os valores de consumo cadastrados na ficha (dm²/par) JÁ
 *  incluem a perda de corte. Aplicar um percentual por cima conta a mesma perda
 *  DUAS vezes e infla o consumo, a reserva, o débito e o custeio. Nada no
 *  sistema deve acrescentar perda ao que foi digitado.
 *
 *  Por que a constante continua existindo em vez de o campo sumir: a perda é
 *  aplicada em 6 pontos do TS e 7 funções SQL, sempre como `× (1 + waste/100)`.
 *  Mantendo o valor em 0 o fator vira × 1 em todos eles de uma vez, sem tocar em
 *  nenhuma linha de cálculo e sem risco de dessincronizar TS e SQL. Todo caminho
 *  que semeia ou grava `waste_pct` DEVE usar esta constante — um `8` solto
 *  reintroduz a duplicidade num material só, e o sintoma é sutil: mesma grade e
 *  mesma quantidade saindo com consumos diferentes (bug do PV-00150). */
export const DEFAULT_WASTE_PCT = 0;

export const emptyComponentForm: ComponentSheetFormData = {
  product_id: '',
  default_sole_group_id: null,
  dimensions_length: 0,
  dimensions_width: 0,
  dimensions_thickness: 0,
  dimensions_unit: 'mm',
  yield_per_size: {},
  waste_pct: DEFAULT_WASTE_PCT,
  notes: '',
};

export function useComponentSheets() {
  return useQuery({
    queryKey: ['component_sheets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_sheets')
        .select('*, products(name, sku, unit, purchase_unit, purchase_order_unit, category, unit_price, quantity, image_url, group_id, color), product_groups!component_sheets_group_id_fkey(id, name, colors), default_sole_group:product_groups!component_sheets_default_sole_group_id_fkey(id, name)')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

/** Lista grupos de produtos categorizados como 'Solado' para usar como solado padrão. */
export function useSoleGroups() {
  return useQuery({
    queryKey: ['product_groups', 'solado'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_groups')
        .select('id, name, category, colors')
        .ilike('category', '%solado%')
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });
}

/** Propaga um grupo de solado como padrão para todas as fichas técnicas que usam o componente. */
export function usePropagateSoleToTechnicalSheets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ componentSheetId, soleGroupId }: { componentSheetId: string; soleGroupId: string }) => {
      const { data, error } = await (supabase as any).rpc('propagate_component_sole_to_sheets', {
        p_component_sheet_id: componentSheetId,
        p_sole_group_id: soleGroupId,
      });
      if (error) throw error;
      return data as { sheets_updated: number };
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['component_sheets'] });
      qc.invalidateQueries({ queryKey: ['technical_sheets'] });
      toast.success(`Solado propagado para ${data?.sheets_updated ?? 0} ${(data?.sheets_updated ?? 0) === 1 ? 'ficha técnica' : 'fichas técnicas'}!`);
    },
    onError: (err: Error) => toast.error(`Erro ao propagar: ${err.message}`),
  });
}

export function useAddComponentSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: ComponentSheetFormData) => {
      // upsert por product_id: convive com o trigger que herda a ficha do grupo
      // ao criar a cor (trg_inherit_component_sheet_on_product). Se a ficha já
      // existir (herdada), atualiza com os valores informados em vez de quebrar
      // no UNIQUE(product_id).
      const { data, error } = await supabase
        .from('component_sheets')
        .upsert(form as any, { onConflict: 'product_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['component_sheets'] }); toast.success('Ficha de componente criada!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateComponentSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ComponentSheetFormData> }) => {
      const { error } = await supabase
        .from('component_sheets')
        .update(data as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['component_sheets'] }); toast.success('Ficha atualizada!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useBulkUpdateComponentSheets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, data }: { ids: string[]; data: Partial<ComponentSheetFormData> }) => {
      const { error } = await supabase
        .from('component_sheets')
        .update(data as any)
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['component_sheets'] }); toast.success('Fichas atualizadas!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteComponentSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('component_sheets')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['component_sheets'] }); toast.success('Ficha excluída!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

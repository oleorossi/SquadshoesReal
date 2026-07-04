import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Componentes por cor predominante (opt-in via technical_sheets.component_colors_enabled).
 * Cada cor lista a lista COMPLETA de componentes (mini-BOM por cor). Espelha o padrão
 * de useLiningColorMappings, mas orientado a LISTA (1 cor → N componentes).
 */
export type ComponentColorMapping = {
  id: string;
  sheet_id: string;
  cabedal_color: string;
  product_id: string;
  quantity_per_unit: number;
  created_at: string;
};

export function useComponentColorMappings(sheetId: string | undefined) {
  return useQuery({
    queryKey: ['component_color_mappings', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheet_component_colors')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('cabedal_color');
      if (error) throw error;
      return (data || []) as ComponentColorMapping[];
    },
  });
}

/** Insere um componente para uma cor. */
export function useAddComponentColorRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sheetId,
      cabedalColor,
      productId,
      quantityPerUnit,
    }: {
      sheetId: string;
      cabedalColor: string;
      productId: string;
      quantityPerUnit: number;
    }) => {
      const { error } = await (supabase as any)
        .from('technical_sheet_component_colors')
        .insert({
          sheet_id: sheetId,
          cabedal_color: cabedalColor,
          product_id: productId,
          quantity_per_unit: quantityPerUnit,
        });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['component_color_mappings', vars.sheetId] });
    },
    onError: (err: any) => {
      // 23505 = violação da unique (sheet, cor, produto) — componente já existe pra a cor.
      toast.error(err?.code === '23505' ? 'Esse componente já está nessa cor.' : `Erro: ${err.message}`);
    },
  });
}

/** Atualiza product_id e/ou quantidade de uma linha. */
export function useUpdateComponentColorRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      productId,
      quantityPerUnit,
    }: {
      id: string;
      sheetId: string;
      productId?: string;
      quantityPerUnit?: number;
    }) => {
      const patch: Record<string, unknown> = {};
      if (productId !== undefined) patch.product_id = productId;
      if (quantityPerUnit !== undefined) patch.quantity_per_unit = quantityPerUnit;
      const { error } = await (supabase as any)
        .from('technical_sheet_component_colors')
        .update(patch)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['component_color_mappings', vars.sheetId] });
    },
    onError: (err: any) => {
      toast.error(err?.code === '23505' ? 'Esse componente já está nessa cor.' : `Erro: ${err.message}`);
    },
  });
}

/** Remove uma linha. */
export function useDeleteComponentColorRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; sheetId: string }) => {
      const { error } = await (supabase as any)
        .from('technical_sheet_component_colors')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['component_color_mappings', vars.sheetId] });
    },
    onError: (err: any) => {
      toast.error(`Erro: ${err.message}`);
    },
  });
}

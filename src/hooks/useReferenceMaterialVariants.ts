import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ReferenceMaterialVariant {
  id: string;
  reference_id: string;
  material_name: string;
  sku: string | null;
  barcode: string | null;
  ncm: string | null;
  description_override: string | null;
  upper_material_product_id: string | null;
  unit_price_override: number | null;
  available_colors: string[];
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export type ReferenceMaterialVariantInsert = Omit<ReferenceMaterialVariant, 'id' | 'created_at' | 'updated_at'>;
export type ReferenceMaterialVariantUpdate = Partial<Omit<ReferenceMaterialVariant, 'id' | 'reference_id' | 'created_at' | 'updated_at'>>;

const QUERY_KEY = (referenceId: string | null) => ['reference_material_variants', referenceId];

export function useReferenceMaterialVariants(referenceId: string | null) {
  return useQuery({
    queryKey: QUERY_KEY(referenceId),
    enabled: !!referenceId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('reference_material_variants')
        .select('*')
        .eq('reference_id', referenceId!)
        .order('display_order')
        .order('material_name');
      if (error) throw error;
      return (data || []) as ReferenceMaterialVariant[];
    },
    staleTime: 60_000,
  });
}

const ALL_ACTIVE_KEY = ['reference_material_variants_all_active'];

export function useUpsertReferenceMaterialVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ReferenceMaterialVariantInsert & { id?: string }) => {
      const { id, ...rest } = payload;
      if (id) {
        const { data, error } = await (supabase as any)
          .from('reference_material_variants')
          .update(rest)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return data as ReferenceMaterialVariant;
      }
      const { data, error } = await (supabase as any)
        .from('reference_material_variants')
        .insert(rest)
        .select()
        .single();
      if (error) throw error;
      return data as ReferenceMaterialVariant;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: QUERY_KEY(variables.reference_id) });
      qc.invalidateQueries({ queryKey: ALL_ACTIVE_KEY });
    },
    onError: (err: any) => toast.error(`Erro ao salvar variação: ${err.message}`),
  });
}

export function useDeleteReferenceMaterialVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, referenceId }: { id: string; referenceId: string }) => {
      const { error } = await (supabase as any)
        .from('reference_material_variants')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return referenceId;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: QUERY_KEY(variables.referenceId) });
      qc.invalidateQueries({ queryKey: ALL_ACTIVE_KEY });
    },
    onError: (err: any) => toast.error(`Erro ao excluir variação: ${err.message}`),
  });
}

export type VariantSummary = { id: string; material_name: string; sku: string | null; available_colors: string[] };

/** Fetches all active material variants for all references in one query. */
export function useAllActiveReferenceMaterialVariants() {
  return useQuery({
    queryKey: ALL_ACTIVE_KEY,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('reference_material_variants')
        .select('id, reference_id, material_name, sku, available_colors')
        .eq('active', true)
        .order('display_order');
      if (error) throw error;
      const map = new Map<string, VariantSummary[]>();
      for (const v of (data || [])) {
        const arr = map.get(v.reference_id) ?? [];
        arr.push({ id: v.id, material_name: v.material_name, sku: v.sku, available_colors: v.available_colors ?? [] });
        map.set(v.reference_id, arr);
      }
      return map;
    },
    staleTime: 60_000,
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export type BaseMaterialKit = {
  id: string;
  shoe_category: string;
  name: string;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type BaseMaterialKitItem = {
  id: string;
  kit_id: string;
  line_kind: 'material' | 'ajuste';
  description: string;
  product_id: string | null;
  group_id: string | null;
  unit: string;
  quantity_per_unit: number;
  cost_mode: 'fixed_per_pair' | 'consumo_x_preco';
  cost_per_pair: number | null;
  estimated_unit_price: number | null;
  is_active: boolean;
  sort_order: number;
  products?: { id: string; name: string | null; unit: string | null; unit_price: number | null } | null;
};

export const baseMaterialKitsKey = ['base_material_kits'] as const;

export function useBaseMaterialKits() {
  return useQuery({
    queryKey: baseMaterialKitsKey,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('base_material_kits')
        .select('*')
        .order('shoe_category');
      if (error) throw error;
      return (data || []) as BaseMaterialKit[];
    },
    staleTime: 60_000,
  });
}

export function useBaseMaterialKitItems(kitId: string | null) {
  return useQuery({
    queryKey: [...baseMaterialKitsKey, 'items', kitId],
    enabled: !!kitId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('base_material_kit_items')
        .select('*, products(id, name, unit, unit_price)')
        .eq('kit_id', kitId!)
        .order('sort_order');
      if (error) throw error;
      return (data || []) as BaseMaterialKitItem[];
    },
  });
}

export function useUpsertBaseMaterialKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      shoe_category: string;
      name: string;
      notes?: string | null;
      active?: boolean;
    }) => {
      if (input.id) {
        const { data, error } = await (supabase as any)
          .from('base_material_kits')
          .update({
            shoe_category: input.shoe_category.trim(),
            name: input.name.trim(),
            notes: input.notes ?? null,
            active: input.active ?? true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', input.id)
          .select()
          .single();
        if (error) throw error;
        return data as BaseMaterialKit;
      }
      const { data, error } = await (supabase as any)
        .from('base_material_kits')
        .insert({
          shoe_category: input.shoe_category.trim(),
          name: input.name.trim(),
          notes: input.notes ?? null,
          active: input.active ?? true,
        })
        .select()
        .single();
      if (error) throw error;
      return data as BaseMaterialKit;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: baseMaterialKitsKey });
      toast.success('Kit de materiais base salvo.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useSaveBaseMaterialKitItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<BaseMaterialKitItem> & { kit_id: string; description: string }) => {
      const payload = {
        kit_id: input.kit_id,
        line_kind: input.line_kind || 'material',
        description: input.description.trim(),
        product_id: input.line_kind === 'ajuste' ? null : (input.product_id || null),
        group_id: input.group_id || null,
        unit: input.unit || 'par',
        quantity_per_unit: Number(input.quantity_per_unit) || 1,
        cost_mode: input.cost_mode || 'fixed_per_pair',
        cost_per_pair: input.cost_per_pair ?? null,
        estimated_unit_price: input.estimated_unit_price ?? null,
        is_active: input.is_active !== false,
        sort_order: Number(input.sort_order) || 0,
        updated_at: new Date().toISOString(),
      };
      if (input.id) {
        const { error } = await (supabase as any)
          .from('base_material_kit_items')
          .update(payload)
          .eq('id', input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await (supabase as any)
        .from('base_material_kit_items')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (_id, variables) => {
      qc.invalidateQueries({ queryKey: [...baseMaterialKitsKey, 'items', variables.kit_id] });
      toast.success('Item do kit salvo.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteBaseMaterialKitItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, kitId }: { id: string; kitId: string }) => {
      const { error } = await (supabase as any)
        .from('base_material_kit_items')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return kitId;
    },
    onSuccess: (kitId) => {
      qc.invalidateQueries({ queryKey: [...baseMaterialKitsKey, 'items', kitId] });
      toast.success('Item removido.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export async function applyBaseMaterialKitToSheet(sheetId: string): Promise<number> {
  const { data, error } = await (supabase as any).rpc('apply_base_material_kit_to_sheet', {
    p_sheet_id: sheetId,
  });
  if (error) throw error;
  return Number(data) || 0;
}

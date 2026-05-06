import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ReferenceFormData, MaterialFormData } from '@/types/references';
import { toast } from 'sonner';
import { sanitizeUuidFields } from '@/lib/utils';

export function useReferences() {
  return useQuery({
    queryKey: ['references'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_references')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useReferenceMaterials(referenceId: string | null) {
  return useQuery({
    queryKey: ['reference_materials', referenceId],
    enabled: !!referenceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reference_materials')
        .select('*, products(name, unit, sku, category, unit_price, quantity)')
        .eq('reference_id', referenceId!);
      if (error) throw error;
      return data;
    },
  });
}

export function useAddReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: ReferenceFormData) => {
      const { data, error } = await supabase
        .from('product_references')
        .insert(sanitizeUuidFields(form) as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['references'] }); toast.success('Referência criada!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ReferenceFormData }) => {
      const { error } = await supabase
        .from('product_references')
        .update(sanitizeUuidFields(data) as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['references'] }); toast.success('Referência atualizada!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Preflight: block delete if any live records reference this entry.
      // purchase_order_items has no reference_id/status columns — that check was
      // always erroring and permanently blocking all reference deletions.
      const [
        { count: saleItemsCount, error: e1 },
        { count: ordersCount, error: e2 },
      ] = await Promise.all([
        supabase.from('sale_order_items').select('id', { count: 'exact', head: true }).eq('reference_id', id),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('reference_id', id).not('status', 'in', '("Cancelada","Finalizado")'),
      ]);
      if (e1 || e2) throw new Error('Erro ao verificar vínculos da referência.');
      const msgs: string[] = [];
      if ((saleItemsCount ?? 0) > 0) msgs.push(`${saleItemsCount} item(ns) de PV`);
      if ((ordersCount ?? 0) > 0) msgs.push(`${ordersCount} OP(s) ativa(s)`);
      if (msgs.length > 0) {
        throw new Error(`Não é possível excluir: referência usada em ${msgs.join(', ')}.`);
      }
      const { error } = await supabase
        .from('product_references')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['references'] }); toast.success('Referência excluída!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useAddMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ referenceId, data }: { referenceId: string; data: MaterialFormData }) => {
      const { error } = await supabase
        .from('reference_materials')
        .insert({ reference_id: referenceId, ...data });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reference_materials'] }); toast.success('Material adicionado!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useBulkAddMaterials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ referenceId, materials }: { referenceId: string; materials: MaterialFormData[] }) => {
      const rows = materials.map(m => ({ reference_id: referenceId, ...m }));
      const { error } = await supabase.from('reference_materials').insert(rows);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['reference_materials'] });
      toast.success(`${vars.materials.length} materiais adicionados!`);
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useRecentMaterials() {
  return useQuery({
    queryKey: ['recent_materials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reference_materials')
        .select('product_id, quantity_per_unit, color, width, weight, supplier, notes, products(name, sku, category)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      // Deduplicate by product_id, keep first (most recent)
      const seen = new Set<string>();
      return (data || []).filter(m => {
        if (seen.has(m.product_id)) return false;
        seen.add(m.product_id);
        return true;
      }).slice(0, 10);
    },
  });
}

export function useDeleteMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('reference_materials')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reference_materials'] }); toast.success('Material removido!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type GroupSupplier = {
  id: string;
  group_id: string;
  supplier_name: string;
  supplier_cnpj: string;
  supplier_contact: string;
  supplier_phone: string;
  supplier_email: string;
  supplier_address: string;
  payment_terms: string;
  lead_time_days: number;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type GroupSupplierMaterial = {
  id: string;
  supplier_id: string;
  group_id: string;
  material_name: string;
  material_code: string;
  color: string;
  width: string;
  weight: string;
  thickness: string;
  composition: string;
  unit: string;
  unit_price: number;
  minimum_order: number;
  stock_available: number;
  invoice_number: string;
  invoice_date: string | null;
  invoice_value: number;
  invoice_key: string;
  notes: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export function useGroupSuppliers(groupId?: string) {
  return useQuery({
    queryKey: ['group_suppliers', groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_suppliers')
        .select('*')
        .eq('group_id', groupId!)
        .order('supplier_name');
      if (error) throw error;
      return data as GroupSupplier[];
    },
  });
}

export function useGroupSupplierMaterials(supplierId?: string) {
  return useQuery({
    queryKey: ['group_supplier_materials', supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_supplier_materials')
        .select('*')
        .eq('supplier_id', supplierId!)
        .order('material_name');
      if (error) throw error;
      return data as GroupSupplierMaterial[];
    },
  });
}

export function useAllGroupSupplierMaterials(groupId?: string) {
  return useQuery({
    queryKey: ['group_supplier_materials_all', groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_supplier_materials')
        .select('*')
        .eq('group_id', groupId!)
        .order('material_name');
      if (error) throw error;
      return data as GroupSupplierMaterial[];
    },
  });
}

export function useAddGroupSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: Partial<GroupSupplier> & { group_id: string; supplier_name: string }) => {
      const { data, error } = await supabase.from('group_suppliers').insert(form).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['group_suppliers', vars.group_id] });
      toast.success('Fornecedor adicionado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateGroupSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<GroupSupplier> }) => {
      const { error } = await supabase.from('group_suppliers').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group_suppliers'] });
      toast.success('Fornecedor atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteGroupSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('group_suppliers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group_suppliers'] });
      toast.success('Fornecedor removido!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useAddGroupSupplierMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: Partial<GroupSupplierMaterial> & { supplier_id: string; group_id: string; material_name: string }) => {
      const { data, error } = await supabase.from('group_supplier_materials').insert(form).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['group_supplier_materials', vars.supplier_id] });
      qc.invalidateQueries({ queryKey: ['group_supplier_materials_all', vars.group_id] });
      toast.success('Material adicionado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateGroupSupplierMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<GroupSupplierMaterial> }) => {
      const { error } = await supabase.from('group_supplier_materials').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group_supplier_materials'] });
      qc.invalidateQueries({ queryKey: ['group_supplier_materials_all'] });
      toast.success('Material atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteGroupSupplierMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('group_supplier_materials').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group_supplier_materials'] });
      qc.invalidateQueries({ queryKey: ['group_supplier_materials_all'] });
      toast.success('Material removido!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface TechnicalReferenceRow {
  id: string;
  sheet_id: string;
  reference_code: string;
  name: string;
  description: string | null;
  category: string;
  final_length: number;
  final_width: number;
  final_height: number;
  dimensions_unit: string;
  tolerance: number;
  status: string;
  is_valid: boolean;
  dimensional_check: boolean;
  material_availability: boolean;
  cost_calculated: boolean;
  estimated_cost: number;
  estimated_production_time: number;
  validation_errors: any[];
  validation_warnings: any[];
  last_validated_at: string | null;
  validated_at: string | null;
  validated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TechnicalRefMaterialRow {
  id: string;
  technical_reference_id: string;
  product_id: string | null;
  sequence: number;
  quantity_needed: number;
  unit: string;
  cut_length: number | null;
  cut_width: number | null;
  cut_thickness: number | null;
  cut_unit: string | null;
  notes: string | null;
  is_critical: boolean;
  waste_factor: number;
  alternative_products: string[];
  created_at: string;
  updated_at: string;
  products?: {
    name: string;
    sku: string;
    category: string;
    unit: string;
    unit_price: number;
    quantity: number;
  } | null;
}

export function useTechnicalReferences(sheetId: string | null) {
  return useQuery({
    queryKey: ['technical_references', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_references')
        .select('*')
        .eq('sheet_id', sheetId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as TechnicalReferenceRow[];
    },
  });
}

export function useTechnicalRefMaterials(refId: string | null) {
  return useQuery({
    queryKey: ['technical_ref_materials', refId],
    enabled: !!refId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_reference_materials')
        .select('*, products(name, sku, category, unit, unit_price, quantity)')
        .eq('technical_reference_id', refId!)
        .order('sequence', { ascending: true });
      if (error) throw error;
      return data as TechnicalRefMaterialRow[];
    },
  });
}

export function useAddTechnicalReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: Partial<TechnicalReferenceRow>) => {
      const { data, error } = await (supabase as any)
        .from('technical_references')
        .insert(form)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['technical_references'] });
      toast.success('Referência técnica criada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateTechnicalReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TechnicalReferenceRow> }) => {
      const { error } = await (supabase as any)
        .from('technical_references')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['technical_references'] });
      toast.success('Referência técnica atualizada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteTechnicalReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('technical_references')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['technical_references'] });
      toast.success('Referência técnica excluída!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useAddTechRefMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: Partial<TechnicalRefMaterialRow>) => {
      const { error } = await (supabase as any)
        .from('technical_reference_materials')
        .insert(form);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['technical_ref_materials'] });
      toast.success('Material adicionado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateTechRefMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TechnicalRefMaterialRow> }) => {
      const { error } = await (supabase as any)
        .from('technical_reference_materials')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['technical_ref_materials'] });
      toast.success('Material atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteTechRefMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('technical_reference_materials')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['technical_ref_materials'] });
      toast.success('Material removido!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/** Validate a technical reference against current stock (enhanced) */
export function useValidateTechnicalReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (refId: string) => {
      const { runFullValidation } = await import('@/hooks/useTechnicalReferenceValidation');
      return runFullValidation(refId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['technical_references'] });
      qc.invalidateQueries({ queryKey: ['technical_ref_materials'] });
    },
  });
}

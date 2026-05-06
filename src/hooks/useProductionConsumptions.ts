import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type ProductionConsumption = {
  id: string;
  order_id: string;
  product_id: string | null;
  component_name: string | null;
  component_type: string;
  standard_quantity: number;
  actual_quantity: number;
  standard_cost: number;
  actual_cost: number;
  variance_quantity: number | null;
  variance_cost: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export function useProductionConsumptions(orderId?: string) {
  return useQuery({
    queryKey: ['production_consumptions', orderId],
    enabled: !!orderId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_consumptions')
        .select('*')
        .eq('order_id', orderId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as ProductionConsumption[];
    },
  });
}

export function useAllProductionConsumptions() {
  return useQuery({
    queryKey: ['production_consumptions'],
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_consumptions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data as ProductionConsumption[];
    },
  });
}

export function useAddProductionConsumption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      order_id: string;
      product_id?: string;
      component_name?: string;
      component_type: string;
      standard_quantity: number;
      actual_quantity: number;
      standard_cost: number;
      actual_cost: number;
      notes?: string;
    }) => {
      const stdQty = Number(payload.standard_quantity) || 0;
      const actQty = Number(payload.actual_quantity) || 0;
      const stdCost = Number(payload.standard_cost) || 0;
      const actCost = Number(payload.actual_cost) || 0;
      if (![stdQty, actQty, stdCost, actCost].every(v => Number.isFinite(v) && v >= 0 && v < 1e12)) {
        throw new Error('Valor inválido — quantidades e custos devem ser números finitos não-negativos.');
      }
      const variance_quantity = Math.round((actQty - stdQty) * 1000) / 1000;
      const variance_cost = Math.round((actCost - stdCost) * 100) / 100;
      const { error } = await supabase
        .from('production_consumptions')
        .insert({ ...payload, variance_quantity, variance_cost } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      toast.success('Consumo registrado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateProductionConsumption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ProductionConsumption> }) => {
      const updates: any = { ...data };
      // Always refetch standard values when updating actuals so variance is
      // recomputed against the current DB standard, not just what was passed in.
      if (data.actual_quantity !== undefined || data.actual_cost !== undefined) {
        const { data: current, error: fetchErr } = await supabase
          .from('production_consumptions')
          .select('standard_quantity, standard_cost')
          .eq('id', id)
          .single();
        if (fetchErr) throw fetchErr;
        const stdQ = data.standard_quantity ?? current.standard_quantity;
        const actQ = data.actual_quantity;
        const stdC = data.standard_cost ?? current.standard_cost;
        const actC = data.actual_cost;
        if (actQ !== undefined) updates.variance_quantity = Math.round((actQ - stdQ) * 1000) / 1000;
        if (actC !== undefined) updates.variance_cost = Math.round((actC - stdC) * 100) / 100;
      } else if (data.actual_quantity !== undefined && data.standard_quantity !== undefined) {
        updates.variance_quantity = Math.round((data.actual_quantity - data.standard_quantity) * 1000) / 1000;
      }
      if (data.actual_cost !== undefined && data.standard_cost !== undefined) {
        updates.variance_cost = Math.round((data.actual_cost - data.standard_cost) * 100) / 100;
      }
      const { error } = await supabase
        .from('production_consumptions')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      toast.success('Consumo atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteProductionConsumption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('production_consumptions')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      toast.success('Consumo removido!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

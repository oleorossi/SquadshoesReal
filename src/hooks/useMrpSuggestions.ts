import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useMrpSuggestions(status?: string) {
  return useQuery({
    queryKey: ['mrp_suggestions', status],
    queryFn: async () => {
      let query = supabase
        .from('mrp_suggestions')
        .select('*, products(name, sku, unit, quantity, min_stock)')
        .order('created_at', { ascending: false });
      if (status && status !== 'all') query = query.eq('status', status);
      const { data, error } = await query.limit(300);
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 1000,
  });
}

export function useCreateMrpSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (suggestion: {
      suggestion_type: string;
      product_id?: string;
      product_name?: string;
      sale_order_id?: string;
      order_id?: string;
      required_quantity: number;
      available_quantity: number;
      shortage_quantity: number;
      priority?: string;
      due_date?: string;
      notes?: string;
    }) => {
      const { error } = await supabase.from('mrp_suggestions').insert(suggestion as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mrp_suggestions'] });
      toast.success('Sugestão MRP criada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateMrpSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; status?: string; notes?: string; resolved_by?: string }) => {
      const updates: any = { ...data };
      if (data.status === 'resolved') updates.resolved_at = new Date().toISOString();
      const { error } = await supabase.from('mrp_suggestions').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mrp_suggestions'] });
      toast.success('Sugestão MRP atualizada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface LastWithUsage {
  id: string;
  code: string;
  name: string;
  description: string | null;
  size_range_min: number | null;
  size_range_max: number | null;
  toe_shape: string | null;
  heel_type: string | null;
  heel_height_mm: number | null;
  material: string | null;
  unit_cost: number | null;
  owner_client_id: string | null;
  owner_name: string | null;
  owner_cnpj: string | null;
  status: 'dev' | 'active' | 'retired' | string;
  notes: string | null;
  active: boolean;
  sheets_using: number;
  created_at: string;
  updated_at: string;
}

export interface LastInput {
  code: string;
  name: string;
  description?: string | null;
  size_range_min?: number | null;
  size_range_max?: number | null;
  toe_shape?: string | null;
  heel_type?: string | null;
  heel_height_mm?: number | null;
  material?: string | null;
  unit_cost?: number | null;
  owner_client_id?: string | null;
  status?: 'dev' | 'active' | 'retired' | string;
  notes?: string | null;
  active?: boolean;
}

export function useLasts() {
  return useQuery({
    queryKey: ['lasts_with_usage'],
    queryFn: async (): Promise<LastWithUsage[]> => {
      const { data, error } = await (supabase as any)
        .from('v_lasts_with_usage')
        .select('*')
        .limit(500);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });
}

export function useCreateLast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LastInput): Promise<string> => {
      const { data, error } = await (supabase as any)
        .from('lasts')
        .insert({ ...input, active: input.active ?? true, status: input.status ?? 'dev' } as any)
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lasts_with_usage'] });
      toast.success('Forma criada');
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao criar forma'),
  });
}

export function useUpdateLast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<LastInput> }) => {
      const { error } = await (supabase as any)
        .from('lasts')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lasts_with_usage'] });
      toast.success('Forma atualizada');
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao atualizar forma'),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface BinLocation {
  id: string;
  code: string;
  name: string;
  warehouse: string;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  capacity: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BinLocationInput {
  code: string;
  name: string;
  warehouse: string;
  zone?: string | null;
  aisle?: string | null;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  capacity?: number | null;
  active?: boolean;
}

export function useBinLocations(opts?: { activeOnly?: boolean }) {
  return useQuery({
    queryKey: ['bin_locations', opts?.activeOnly ?? false],
    queryFn: async (): Promise<BinLocation[]> => {
      let query = (supabase as any).from('bin_locations').select('*').order('warehouse').order('code');
      if (opts?.activeOnly) query = query.eq('active', true);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateBinLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BinLocationInput): Promise<BinLocation> => {
      const { data, error } = await (supabase as any)
        .from('bin_locations')
        .insert({ ...input, active: input.active ?? true } as any)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as BinLocation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bin_locations'] });
      toast.success('Localização criada');
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao criar localização'),
  });
}

export function useUpdateBinLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<BinLocationInput> }) => {
      const { data, error } = await (supabase as any)
        .from('bin_locations')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as BinLocation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bin_locations'] });
      qc.invalidateQueries({ queryKey: ['products_with_location'] });
      toast.success('Localização atualizada');
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao atualizar localização'),
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const shoeCategoriesKey = ['shoe-categories'] as const;

export function useShoeCategories() {
  return useQuery({
    queryKey: shoeCategoriesKey,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('silk_shoe_category')
        .select('name')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((category) => category.name);
    },
  });
}

export function useCreateShoeCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, description }: { name: string; description?: string | null }) => {
      const { data, error } = await (supabase as any).rpc('create_shoe_category', {
        p_name: name,
        p_description: description ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shoeCategoriesKey });
      toast.success('Tipo de calçado adicionado.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useRenameShoeCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      const { error } = await (supabase as any).rpc('rename_shoe_category', {
        p_old: oldName,
        p_new: newName,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shoeCategoriesKey });
      queryClient.invalidateQueries({ queryKey: ['default-lead-times'] });
      queryClient.invalidateQueries({ queryKey: ['default-lead-time-categories'] });
      toast.success('Tipo de calçado renomeado.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteShoeCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await (supabase as any).rpc('delete_shoe_category', { p_name: name });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shoeCategoriesKey });
      toast.success('Tipo de calçado excluído.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

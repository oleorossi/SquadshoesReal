import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export const DEFAULT_LEAD_TIME_CAPACITY_FIELDS = [
  'sewing_capacity_per_day',
  'cutting_capacity_per_day',
  'costura_capacity_per_day',
  'costura_cabedal_capacity_per_day',
  'costura_palmilha_capacity_per_day',
  'mesa_daily_capacity',
  'silk_capacity_per_day',
  'gluing_capacity_per_day',
  'assembly_capacity_per_day',
  'soling_capacity_per_day',
  'finishing_capacity_per_day',
  'expedition_capacity_per_day',
] as const;

export type DefaultLeadTimeCapacityField = (typeof DEFAULT_LEAD_TIME_CAPACITY_FIELDS)[number];

export type DefaultLeadTimesCapacity = Record<DefaultLeadTimeCapacityField, number>;

export type DefaultLeadTimeRow = {
  id: string;
  shoe_category: string;
} & Partial<Record<DefaultLeadTimeCapacityField, number | null>>;

export type UpsertDefaultLeadTimesInput = {
  shoe_category: string;
} & DefaultLeadTimesCapacity;

const DEFAULT_LEAD_TIME_CAPACITY_COLUMNS = [
  'id',
  'shoe_category',
  ...DEFAULT_LEAD_TIME_CAPACITY_FIELDS,
].join(', ');

export const emptyDefaultLeadTimesCapacity = (): DefaultLeadTimesCapacity =>
  Object.fromEntries(
    DEFAULT_LEAD_TIME_CAPACITY_FIELDS.map((field) => [field, 0]),
  ) as DefaultLeadTimesCapacity;

/** Carrega o padrão da categoria; `null` significa que ainda não foi cadastrado. */
export function useDefaultLeadTimes(shoeCategory: string) {
  return useQuery({
    queryKey: ['default-lead-times', shoeCategory],
    enabled: Boolean(shoeCategory),
    queryFn: async (): Promise<DefaultLeadTimeRow | null> => {
      const { data, error } = await supabase
        .from('default_lead_times' as any)
        .select(DEFAULT_LEAD_TIME_CAPACITY_COLUMNS)
        .eq('shoe_category', shoeCategory)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as DefaultLeadTimeRow | null;
    },
  });
}

/** Inclui eventuais padrões históricos além da lista canônica das Fichas Técnicas. */
export function useDefaultLeadTimeCategories() {
  return useQuery({
    queryKey: ['default-lead-time-categories'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('default_lead_times')
        .select('shoe_category')
        .order('shoe_category');

      if (error) throw error;
      return (data || []).map((row) => row.shoe_category).filter(Boolean);
    },
  });
}

/** Persiste um único padrão por categoria e mantém os consumidores do fallback atualizados. */
export function useUpsertDefaultLeadTimes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpsertDefaultLeadTimesInput) => {
      const { data, error } = await supabase
        .from('default_lead_times' as any)
        .upsert(payload, { onConflict: 'shoe_category' })
        .select(DEFAULT_LEAD_TIME_CAPACITY_COLUMNS)
        .single();

      if (error) throw error;
      return data as unknown as DefaultLeadTimeRow;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['default-lead-times', variables.shoe_category], data);
      queryClient.invalidateQueries({ queryKey: ['default-lead-times'] });
      queryClient.invalidateQueries({ queryKey: ['default-lead-time-categories'] });
      queryClient.invalidateQueries({ queryKey: ['category-default-lead-times'] });
      queryClient.invalidateQueries({ queryKey: ['capacity-driven-lead-times'] });
      queryClient.invalidateQueries({ queryKey: ['production_reverse_schedule'] });
      toast.success('Tempos-padrão por setor salvos');
    },
  });
}

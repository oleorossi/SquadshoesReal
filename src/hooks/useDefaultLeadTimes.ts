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

/**
 * Categorias realmente EM USO por alguma ficha técnica.
 *
 * Serve pra separar o que importa do que é config morta: em 03/08/2026 só 5 das
 * 12 categorias cadastradas eram usadas por ficha (Rasteirinha 27, Infantil 10,
 * Sandália 8, Plataforma 5, Bota 2) — e "Plataforma" não tinha padrão salvo,
 * então as 5 fichas dela caíam nas constantes hard-coded do motor.
 */
export function useShoeCategoriesInUse() {
  return useQuery({
    queryKey: ['shoe-categories-in-use'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ category: string; sheets: number }[]> => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('shoe_category');

      if (error) throw error;
      const counts = new Map<string, number>();
      (data || []).forEach((row: { shoe_category: string | null }) => {
        // Categoria vazia/nula é agrupada sob '' — a ficha existe e também fica
        // sem fallback nenhum, então precisa aparecer no aviso.
        const key = (row.shoe_category ?? '').trim();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
      return Array.from(counts, ([category, sheets]) => ({ category, sheets }))
        .sort((a, b) => b.sheets - a.sheets);
    },
  });
}

export type RecalcWavesResult = {
  categoria: string;
  recalculadas: number;
  falhas: number;
  primeiro_erro: string | null;
};

// A RPC é nova (migration 20261112120500) e `integrations/supabase/types.ts` é
// GERADO — enquanto não regerarem os tipos, o nome não existe no Database type.
// Cast estreito em vez de `as any` pra não somar erro de lint novo no arquivo.
type RpcCaller = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>;
};

/** Recalcula as ondas das fichas da categoria — ver migration 20261112120500. */
export function useRecalcWavesForCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shoeCategory: string): Promise<RecalcWavesResult> => {
      const { data, error } = await (supabase as unknown as RpcCaller).rpc(
        'recalc_waves_for_shoe_category',
        { p_shoe_category: shoeCategory },
      );
      if (error) throw error;
      return data as RecalcWavesResult;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['production_waves'] });
      queryClient.invalidateQueries({ queryKey: ['production_reverse_schedule'] });
      if (result.recalculadas === 0 && result.falhas === 0) {
        toast.info('Nenhuma onda usa esta categoria — nada a recalcular.');
      } else if (result.falhas > 0) {
        toast.warning(
          `${result.recalculadas} onda(s) recalculada(s), ${result.falhas} falhou(aram). ${result.primeiro_erro ?? ''}`,
        );
      } else {
        toast.success(`${result.recalculadas} onda(s) recalculada(s) com a capacidade atual.`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
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

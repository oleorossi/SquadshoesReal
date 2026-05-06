import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type LiningColorMapping = {
  id: string;
  sheet_id: string;
  cabedal_color: string;
  lining_color: string;
  created_at: string;
};

export const LINING_DEFAULT_KEY = '__DEFAULT__';

export function useLiningColorMappings(sheetId: string | undefined) {
  return useQuery({
    queryKey: ['lining_color_mappings', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheet_lining_colors')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('cabedal_color');
      if (error) throw error;
      return (data || []) as LiningColorMapping[];
    },
  });
}

export function useUpsertLiningColorMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sheetId,
      cabedelColor,
      liningColor,
    }: {
      sheetId: string;
      cabedelColor: string;
      liningColor: string;
    }) => {
      if (!liningColor.trim()) {
        const { error } = await (supabase as any)
          .from('technical_sheet_lining_colors')
          .delete()
          .eq('sheet_id', sheetId)
          .eq('cabedal_color', cabedelColor);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any)
        .from('technical_sheet_lining_colors')
        .upsert(
          { sheet_id: sheetId, cabedal_color: cabedelColor, lining_color: liningColor },
          { onConflict: 'sheet_id,cabedal_color' }
        );
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['lining_color_mappings', vars.sheetId] });
      toast.success('Mapeamento cabedal × forração salvo');
    },
    onError: (err: any) => {
      toast.error(`Erro: ${err.message}`);
    },
  });
}

/** Resolve a lining color for a given cabedal color using the saved mappings. */
export function resolveLiningColor(
  cabedelColor: string,
  mappings: LiningColorMapping[],
): string | null {
  const exact = mappings.find(m => m.cabedal_color.toLowerCase() === cabedelColor.toLowerCase());
  if (exact) return exact.lining_color;
  const fallback = mappings.find(m => m.cabedal_color === LINING_DEFAULT_KEY);
  return fallback?.lining_color ?? null;
}

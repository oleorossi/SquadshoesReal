import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type PalmilhaColorMapping = {
  id: string;
  sheet_id: string;
  cabedal_color: string;
  sole_color?: string;
  palmilha_color: string;
  palmilha_product_id?: string;
  palmilha_group_id?: string;
  created_at: string;
};

export const PALMILHA_DEFAULT_KEY = '__DEFAULT__';

export function usePalmilhaColorMappings(sheetId: string | undefined) {
  return useQuery({
    queryKey: ['palmilha_color_mappings', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheet_palmilha_colors')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('cabedal_color');
      if (error) throw error;
      return (data || []) as PalmilhaColorMapping[];
    },
  });
}

export function useUpsertPalmilhaColorMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sheetId,
      cabedelColor,
      soleColor,
      palmilhaColor,
      palmilhaProductId,
      palmilhaGroupId,
    }: {
      sheetId: string;
      cabedelColor: string;
      soleColor?: string;
      palmilhaColor: string;
      palmilhaProductId?: string | null;
      palmilhaGroupId?: string | null;
    }) => {
      if (!palmilhaColor.trim()) {
        const query = (supabase as any)
          .from('technical_sheet_palmilha_colors')
          .delete()
          .eq('sheet_id', sheetId);
        
        if (cabedelColor) query.eq('cabedal_color', cabedelColor);
        else if (soleColor) query.eq('sole_color', soleColor);
        
        const { error } = await query;
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any)
        .from('technical_sheet_palmilha_colors')
        .upsert(
          { 
            sheet_id: sheetId, 
            cabedal_color: cabedelColor || '', 
            sole_color: soleColor || '',
            palmilha_color: palmilhaColor,
            palmilha_product_id: palmilhaProductId,
            palmilha_group_id: palmilhaGroupId
          },
          { onConflict: 'sheet_id,cabedal_color,sole_color' }
        );
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['palmilha_color_mappings', vars.sheetId] });
      toast.success('Mapeamento cabedal × palmilha salvo');
    },
    onError: (err: any) => {
      toast.error(`Erro: ${err.message}`);
    },
  });
}

/** Resolve a palmilha color for a given cabedal color using the saved mappings. */
export function resolvePalmilhaColor(
  cabedelColor: string,
  mappings: PalmilhaColorMapping[],
  insoleHasLining: boolean,
): string | null {
  if (insoleHasLining) return cabedelColor; // follows cabedal
  const exact = mappings.find(m => m.cabedal_color.toLowerCase() === cabedelColor.toLowerCase());
  if (exact) return exact.palmilha_color;
  const fallback = mappings.find(m => m.cabedal_color === PALMILHA_DEFAULT_KEY);
  return fallback?.palmilha_color ?? null;
}

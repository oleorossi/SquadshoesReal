import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type InsoleColorMapping = {
  id: string;
  sheet_id: string;
  sole_color: string;
  insole_color: string;
  created_at: string;
};

export function useInsoleColorMappings(sheetId: string | undefined) {
  return useQuery({
    queryKey: ['insole_color_mappings', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheet_insole_colors')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('insole_color');
      if (error) throw error;
      return (data || []) as InsoleColorMapping[];
    },
  });
}

export function useUpsertInsoleColorMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sheetId,
      insoleColor,
      soleColor,
    }: {
      sheetId: string;
      insoleColor: string;
      soleColor: string;
    }) => {
      if (!soleColor.trim()) {
        const { error } = await (supabase as any)
          .from('technical_sheet_insole_colors')
          .delete()
          .eq('sheet_id', sheetId)
          .eq('insole_color', insoleColor);
        if (error) throw error;
        return;
      }

      const { error } = await (supabase as any)
        .from('technical_sheet_insole_colors')
        .upsert(
          { sheet_id: sheetId, insole_color: insoleColor, sole_color: soleColor },
          { onConflict: 'sheet_id,insole_color' }
        );
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['insole_color_mappings', vars.sheetId] });
      toast.success('Mapeamento solado × palmilha salvo');
    },
    onError: (err: any) => {
      toast.error(`Erro: ${err.message}`);
    },
  });
}

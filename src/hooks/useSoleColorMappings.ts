import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type SoleColorMapping = {
  id: string;
  sheet_id: string;
  product_color: string;
  sole_group_id: string;
  sole_product_id: string | null;
  created_at: string;
};

export function useSoleColorMappings(sheetId: string | undefined) {
  return useQuery({
    queryKey: ['sole_color_mappings', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheet_sole_colors')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('product_color');
      if (error) throw error;
      return (data || []) as SoleColorMapping[];
    },
  });
}

export function useUpsertSoleColorMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sheetId,
      productColor,
      soleGroupId,
      soleProductId,
    }: {
      sheetId: string;
      productColor: string;
      soleGroupId: string | null;
      soleProductId: string | null;
    }) => {
      if (!soleGroupId || !soleProductId) {
        const { error } = await (supabase as any)
          .from('technical_sheet_sole_colors')
          .delete()
          .eq('sheet_id', sheetId)
          .eq('product_color', productColor);
        if (error) throw error;
        return;
      }

      const { error } = await (supabase as any)
        .from('technical_sheet_sole_colors')
        .upsert(
          {
            sheet_id: sheetId,
            product_color: productColor,
            sole_group_id: soleGroupId,
            sole_product_id: soleProductId,
          },
          { onConflict: 'sheet_id,product_color' }
        );
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sole_color_mappings', vars.sheetId] });
    },
    onError: (err: any) => {
      toast.error(`Erro ao salvar mapeamento: ${err.message}`);
    },
  });
}

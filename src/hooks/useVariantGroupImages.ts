import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type VariantGroupImage = {
  id: string;
  variant_id: string;
  group_id: string;
  image_url: string;
  created_at: string;
  updated_at: string;
};

export function useVariantGroupImages(referenceId?: string) {
  return useQuery({
    queryKey: ['variant_group_images', referenceId],
    enabled: !!referenceId,
    queryFn: async () => {
      // Get all variant IDs for this reference
      const { data: variants } = await supabase
        .from('reference_color_variants')
        .select('id')
        .eq('reference_id', referenceId!);
      if (!variants?.length) return [];

      const variantIds = variants.map(v => v.id);
      const { data, error } = await supabase
        .from('variant_group_images')
        .select('*')
        .in('variant_id', variantIds);
      if (error) throw error;
      return (data || []) as VariantGroupImage[];
    },
  });
}

export function useUpsertVariantGroupImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ variantId, groupId, imageUrl }: { variantId: string; groupId: string; imageUrl: string }) => {
      const { data, error } = await supabase
        .from('variant_group_images')
        .upsert(
          { variant_id: variantId, group_id: groupId, image_url: imageUrl, updated_at: new Date().toISOString() },
          { onConflict: 'variant_id,group_id' }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['variant_group_images'] });
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteVariantGroupImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('variant_group_images')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['variant_group_images'] });
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

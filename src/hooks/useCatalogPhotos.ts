import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Fotos de catálogo geradas por IA (catalog_photos + Edge Function
 * generate-catalog-photo). A geração é restrita a admin/gerente no servidor
 * (gasto de créditos de IA — mesma regra da recolor-image).
 */
export type CatalogPhoto = {
  id: string;
  reference_id: string | null;
  reference_code: string | null;
  color_nome: string;
  color_hex: string | null;
  image_url: string;
  source_image_url: string | null;
  created_by: string | null;
  created_at: string;
};

const RAW_PREFIX = 'catalog-raw';
const BUCKET = 'reference-images';

export function useCatalogPhotos(referenceId?: string | null) {
  return useQuery({
    queryKey: ['catalog_photos', referenceId ?? 'all'],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabela nova fora do types.ts gerado
      let query = (supabase as any)
        .from('catalog_photos')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(120);
      if (referenceId) query = query.eq('reference_id', referenceId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as CatalogPhoto[];
    },
  });
}

/** Sobe a foto CRUA pro bucket público e devolve a URL pública. */
export async function uploadRawCatalogPhoto(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    throw new Error(`Formato não suportado: .${ext} (use JPG, PNG ou WEBP)`);
  }
  if (file.size > 15 * 1024 * 1024) throw new Error('Foto maior que 15 MB.');
  const path = `${RAW_PREFIX}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export interface GenerateCatalogPhotoInput {
  imageUrl: string;
  colorName: string;
  colorHex: string;
  referenceId?: string | null;
  referenceCode?: string | null;
  extraInstructions?: string;
}

/** Chama a Edge Function que gera a foto de estúdio na cor pedida (~30-90s). */
export function useGenerateCatalogPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerateCatalogPhotoInput) => {
      const { data, error } = await supabase.functions.invoke('generate-catalog-photo', {
        body: input,
      });
      if (error) {
        // FunctionsHttpError esconde o body — tenta extrair a mensagem real.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FunctionsHttpError não expõe context tipado
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json();
            if (body?.error) throw new Error(body.error);
          } catch (e) {
            if (e instanceof Error && e.message && !/JSON/.test(e.message)) throw e;
          }
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      return data as { url: string; id: string | null; colorName: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalog_photos'] });
    },
  });
}

export function useDeleteCatalogPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photo: CatalogPhoto) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabela nova fora do types.ts gerado
      const { error } = await (supabase as any)
        .from('catalog_photos')
        .delete()
        .eq('id', photo.id);
      if (error) throw error;
      // Remove o arquivo do Storage (bucket permite delete autenticado);
      // falha aqui não é fatal — a foto some da galeria de qualquer jeito.
      const marker = `/storage/v1/object/public/${BUCKET}/`;
      const idx = photo.image_url.indexOf(marker);
      if (idx >= 0) {
        const path = decodeURIComponent(photo.image_url.slice(idx + marker.length));
        await supabase.storage.from(BUCKET).remove([path]);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalog_photos'] });
      toast.success('Foto excluída');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

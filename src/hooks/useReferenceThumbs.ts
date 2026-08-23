import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { resolveReferenceImageUrl } from '@/lib/referenceImage';

/**
 * Foto da referência por `technical_sheets.id`, pro card do Kanban.
 *
 * Por que não vem pronto da view: `v_production_queue_detail` expõe
 * `reference_photo_url = ts.image_url`, e essa coluna está VAZIA nas 51 fichas
 * (auditoria 2026-10-01) — o quadro mostrava um quadrado cinza pra toda OP. A
 * foto real mora em `technical_sheets.images[0]` (bucket público
 * `reference-images`), que é a convenção usada no resto do sistema
 * (`printGroupedReport`, `Costura`, `Aviamento`, `Montagem`…: `images[0]` com
 * fallback pra `image_url`). Aqui seguimos a MESMA precedência.
 *
 * Uma query só pro quadro inteiro (~51 fichas), cacheada — não é por card.
 */
export function useReferenceThumbs(referenceIds: (string | null | undefined)[]) {
  const ids = [...new Set(referenceIds.filter((v): v is string => !!v))].sort();
  return useQuery({
    queryKey: ['reference_thumbs', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, images, image_url')
        .in('id', ids);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const row of (data || []) as { id: string; images: unknown; image_url: string | null }[]) {
        const url = resolveReferenceImageUrl(row);
        if (url) map.set(row.id, url);
      }
      return map;
    },
  });
}

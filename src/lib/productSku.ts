import { supabase } from '@/integrations/supabase/client';

/**
 * Candidatos de SKU para uma cópia de material: `{sku}-COPIA`, `-COPIA2`…
 * Se o original já é uma cópia, recomeça do stem (sem o sufixo) pra não
 * virar `SKU-COPIA-COPIA`.
 */
export function copySkuCandidates(originalSku: string): string[] {
  const sku = (originalSku || '').trim() || 'SKU';
  const stem = sku.replace(/-COPIA\d*$/i, '');
  return [
    `${stem}-COPIA`,
    ...Array.from({ length: 8 }, (_, i) => `${stem}-COPIA${i + 2}`),
  ];
}

/**
 * Devolve o primeiro SKU da lista que ainda não existe em `products.sku`.
 * Se todos colidirem, acrescenta um sufixo aleatório curto.
 */
export async function allocateUniqueSku(candidates: string[]): Promise<string> {
  const seen = new Set<string>();
  for (const raw of candidates) {
    const cand = (raw || '').trim();
    if (!cand || seen.has(cand)) continue;
    seen.add(cand);
    const { data, error } = await supabase
      .from('products')
      .select('id')
      .eq('sku', cand)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return cand;
  }
  const base = [...seen][0] || 'SKU-COPIA';
  return `${base}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

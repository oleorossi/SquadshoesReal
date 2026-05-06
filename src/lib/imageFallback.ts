/**
 * 5-level image fallback for industrial labels and documents.
 *
 * Priority:
 * 1. Foto específica por grupo de material (variant_group_images)
 * 2. Foto da variante de cor (reference_color_variants)
 * 3. Foto principal do Produto Mestre (technical_sheets.image_url / images)
 * 4. Foto da variante "Preta" / "Black" do mesmo modelo
 * 5. Placeholder genérico (logo da fábrica ou silhueta)
 */

import { supabase } from '@/integrations/supabase/client';
import { getSignedUrl } from '@/lib/getSignedUrl';

export interface ImageFallbackInput {
  referenceId: string;
  colorName: string;
  /** Optional: falls back to factory logo / placeholder */
  fallbackUrl?: string;
}

/**
 * Resolves the best available product image following the 5-level hierarchy.
 * Returns a signed URL ready for rendering.
 */
export async function resolveProductImage({
  referenceId,
  colorName,
  fallbackUrl = '/placeholder.svg',
}: ImageFallbackInput): Promise<string> {
  // --- 1. Material-specific photo (variant_group_images) ---
  if (colorName) {
    const { data: variant } = await supabase
      .from('reference_color_variants')
      .select('id')
      .eq('reference_id', referenceId)
      .eq('color', colorName)
      .maybeSingle();

    if (variant?.id) {
      const { data: groupImgs } = await supabase
        .from('variant_group_images')
        .select('image_url')
        .eq('variant_id', variant.id)
        .limit(1);

      if (groupImgs?.[0]?.image_url) {
        const url = await getSignedUrl(groupImgs[0].image_url);
        if (url) return url;
      }
    }
  }

  // --- 2. Variant color photo (reference_color_variants.image_url) ---
  if (colorName) {
    const { data: variant } = await supabase
      .from('reference_color_variants')
      .select('image_url')
      .eq('reference_id', referenceId)
      .eq('color', colorName)
      .maybeSingle();

    if (variant?.image_url) {
      const url = await getSignedUrl(variant.image_url);
      if (url) return url;
    }
  }

  // --- 3. Master product image (technical_sheets) ---
  const { data: refData } = await supabase
    .from('technical_sheets')
    .select('image_url, images')
    .eq('id', referenceId)
    .single();

  const masterRaw = refData?.image_url || (refData?.images as any)?.[0] || '';
  if (masterRaw) {
    const url = await getSignedUrl(masterRaw);
    if (url) return url;
  }

  // --- 4. Any variant with an image (prefer Black/Preta, then any) ---
  const { data: allVariants } = await supabase
    .from('reference_color_variants')
    .select('id, image_url, color')
    .eq('reference_id', referenceId);

  if (allVariants && allVariants.length > 0) {
    const blackNames = ['preta', 'preto', 'black'];
    const blackRow = allVariants.find(v =>
      blackNames.includes((v.color || '').toLowerCase())
    );
    if (blackRow?.image_url) {
      const url = await getSignedUrl(blackRow.image_url);
      if (url) return url;
    }

    // Try any variant that has a direct image_url
    const anyWithImage = allVariants.find(v => !!v.image_url);
    if (anyWithImage?.image_url) {
      const url = await getSignedUrl(anyWithImage.image_url);
      if (url) return url;
    }

    // Try variant_group_images for any variant of this reference
    const variantIds = allVariants.map(v => v.id);
    const { data: anyGroupImgs } = await supabase
      .from('variant_group_images')
      .select('image_url')
      .in('variant_id', variantIds)
      .limit(1);

    if (anyGroupImgs?.[0]?.image_url) {
      const url = await getSignedUrl(anyGroupImgs[0].image_url);
      if (url) return url;
    }
  }

  // --- 5. Fallback ---
  return fallbackUrl;
}

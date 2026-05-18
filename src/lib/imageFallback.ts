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
 * Source da imagem retornada — usado pra decidir tratamento downstream
 * (ex: etiquetas industriais aplicam grayscale quando matchedColor=false,
 * já que a foto exibida não corresponde à cor real do produto pedido).
 */
export type ImageMatchSource =
  | 'variant_group'   // nível 1: variant_group_images da variante da cor
  | 'variant_color'   // nível 2: reference_color_variants.image_url da cor
  | 'master_fallback' // nível 3: technical_sheets.image_url (cor pedida não cadastrada)
  | 'other_variant'   // nível 4: variante preta ou qualquer outra variante
  | 'placeholder';    // nível 5: logo da fábrica ou silhueta genérica

export interface ImageResolution {
  url: string;
  source: ImageMatchSource;
  /** True quando a imagem retornada corresponde EXATAMENTE à cor pedida
   *  (níveis 1 ou 2). False pra qualquer fallback (níveis 3-5). */
  matchedColor: boolean;
}

/**
 * Versão estendida que retorna a fonte da imagem além da URL. Use quando
 * o caller precisa saber se a foto corresponde à cor pedida — ex: etiquetas
 * de caixa que aplicam grayscale quando imagem é fallback do master.
 */
export async function resolveProductImageWithSource({
  referenceId,
  colorName,
  fallbackUrl = '/placeholder.svg',
}: ImageFallbackInput): Promise<ImageResolution> {
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
        if (url) return { url, source: 'variant_group', matchedColor: true };
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
      if (url) return { url, source: 'variant_color', matchedColor: true };
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
    if (url) return { url, source: 'master_fallback', matchedColor: false };
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
      if (url) return { url, source: 'other_variant', matchedColor: false };
    }

    const anyWithImage = allVariants.find(v => !!v.image_url);
    if (anyWithImage?.image_url) {
      const url = await getSignedUrl(anyWithImage.image_url);
      if (url) return { url, source: 'other_variant', matchedColor: false };
    }

    const variantIds = allVariants.map(v => v.id);
    const { data: anyGroupImgs } = await supabase
      .from('variant_group_images')
      .select('image_url')
      .in('variant_id', variantIds)
      .limit(1);

    if (anyGroupImgs?.[0]?.image_url) {
      const url = await getSignedUrl(anyGroupImgs[0].image_url);
      if (url) return { url, source: 'other_variant', matchedColor: false };
    }
  }

  // --- 5. Fallback ---
  return { url: fallbackUrl, source: 'placeholder', matchedColor: false };
}

/**
 * Resolves the best available product image following the 5-level hierarchy.
 * Returns a signed URL ready for rendering. (Compat wrapper — use
 * resolveProductImageWithSource quando precisar saber a fonte.)
 */
export async function resolveProductImage(input: ImageFallbackInput): Promise<string> {
  const result = await resolveProductImageWithSource(input);
  return result.url;
}

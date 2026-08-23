import { thumbUrl } from '@/lib/imageThumb';

export interface ReferenceImageSource {
  images?: unknown;
  image_url?: unknown;
}

function imageEntryUrl(entry: unknown): string {
  if (typeof entry === 'string') return entry.trim();
  if (!entry || typeof entry !== 'object') return '';

  const url = (entry as { url?: unknown }).url;
  return typeof url === 'string' ? url.trim() : '';
}

/**
 * Resolve a foto principal da ficha na ordem usada pelo cadastro atual.
 *
 * Fotos novas são persistidas em `technical_sheets.images[0]`; `image_url`
 * permanece apenas como fallback para fichas legadas.
 */
export function resolveReferenceImageUrl(
  reference: ReferenceImageSource | null | undefined,
): string {
  if (!reference) return '';

  const firstImage = Array.isArray(reference.images) ? reference.images[0] : null;
  return imageEntryUrl(firstImage) || imageEntryUrl(reference.image_url);
}

/** URL leve para usos pequenos de catálogo, sem alterar URLs externas. */
export function resolveReferenceThumbnailUrl(
  reference: ReferenceImageSource | null | undefined,
  sizePx: number,
): string {
  const imageUrl = resolveReferenceImageUrl(reference);
  return thumbUrl(imageUrl, sizePx, { resize: 'cover' }) || imageUrl;
}

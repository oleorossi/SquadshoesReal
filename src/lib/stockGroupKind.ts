import type { ProductGroup } from '@/hooks/useGroups';

/**
 * Como adicionar um item num subgrupo técnico.
 * A decisão usa as flags do grupo, nunca o nome: "TIRA STRASS" casava com
 * /tira/ e abria o diálogo artesanal, mesmo sendo tira pronta sem napa.
 */
export type AddColorMode = 'quick-color' | 'artisanal-strap' | 'generic-product';

export function isReadyMadeStrapGroup(group: Pick<ProductGroup, 'strap_origin' | 'is_artisanal_strap'>): boolean {
  return group.strap_origin === 'comprar_pronto' && group.is_artisanal_strap !== true;
}

export function isArtisanalStrapGroup(group: Pick<ProductGroup, 'strap_origin' | 'is_artisanal_strap'>): boolean {
  if (group.strap_origin === 'comprar_pronto') return false;
  return group.is_artisanal_strap === true;
}

export function addColorModeForGroup(
  group: Pick<ProductGroup, 'strap_origin' | 'is_artisanal_strap'>,
  options?: { hasTemplate?: boolean },
): AddColorMode {
  if (isArtisanalStrapGroup(group)) return 'artisanal-strap';
  if (isReadyMadeStrapGroup(group) || options?.hasTemplate) return 'quick-color';
  return 'generic-product';
}

/** Rótulo curto das características técnicas compartilhadas do subgrupo. */
export function subgroupTechnicalLabel(group: Pick<ProductGroup, 'dimensions_width' | 'is_artisanal_strap' | 'strap_origin' | 'sector'>): string | null {
  const parts: string[] = [];
  const width = Number(group.dimensions_width) || 0;
  if (width > 0 && width < 200) parts.push(`${width} mm`);
  if (isReadyMadeStrapGroup(group)) parts.push('tira pronta');
  else if (isArtisanalStrapGroup(group)) {
    parts.push('artesanal');
    if (group.strap_origin === 'fabrica') parts.push('fábrica');
    else if (group.strap_origin === 'prestador') parts.push('prestador');
  }
  if (group.sector) parts.push(group.sector);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function addColorActionLabel(group: Pick<ProductGroup, 'strap_origin' | 'is_artisanal_strap'>): string {
  if (isArtisanalStrapGroup(group) || isReadyMadeStrapGroup(group)) return 'Nova cor';
  return 'Nova variação de cor';
}

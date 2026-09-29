import { resolveImage } from './ProductImageBlock';
import type { SilkColorGroup, SoleSilkGroup } from '../SilkMontageWorkSheet';

/** Fontes de imagem pra o bloco hero do Aviamento (1ª cor elegível). */
export interface AviamentoHeroPhotoSources {
  variantImageUrl?: string | null;
  alternateVariants?: Array<{ color?: string; image_url?: string | null }>;
  technicalSheetImageUrl?: string | null;
  orderColor?: string;
}

/** Placeholder canônico do ProductImageBlock — URL sem cadastro real. */
const PLACEHOLDER_URL = '/placeholder.svg';

/**
 * Chave estável da referência no maço de Aviamento.
 * Preferência: 1º sheetId em refImages (ou refs via sheetId), senão soleName.
 */
export function aviamentoGroupKey(group: SoleSilkGroup): string {
  for (const cg of group.colorGroups || []) {
    for (const ri of cg.refImages || []) {
      const id = (ri.sheetId || '').trim();
      if (id) return id;
    }
  }
  return (group.soleName || '').trim() || 'ref';
}

/** Resolve a URL efetiva da cor; `null` se só houver placeholder. */
function resolvedPhotoUrl(cg: SilkColorGroup): string | null {
  const { url } = resolveImage(
    cg.variantImageUrl,
    cg.alternateVariants,
    cg.technicalSheetImageUrl,
  );
  if (!url || url === PLACEHOLDER_URL) return null;
  return url;
}

/** True se alguma cor do grupo resolve foto real (não placeholder). */
export function aviamentoGroupHasResolvablePhoto(group: SoleSilkGroup): boolean {
  return pickAviamentoHeroPhotoSources(group) != null;
}

/**
 * 1ª cor (ordem do grupo) com imagem resolvível — fontes pro ProductImageBlock.
 * `null` quando nenhuma cor tem foto cadastrada.
 */
export function pickAviamentoHeroPhotoSources(
  group: SoleSilkGroup,
): AviamentoHeroPhotoSources | null {
  for (const cg of group.colorGroups || []) {
    if (!resolvedPhotoUrl(cg)) continue;
    return {
      variantImageUrl: cg.variantImageUrl,
      alternateVariants: cg.alternateVariants,
      technicalSheetImageUrl: cg.technicalSheetImageUrl,
      orderColor: cg.color,
    };
  }
  return null;
}

/** Lista de refs elegíveis (com foto) pra a barra de checkboxes. */
export function listAviamentoHeroEligibleGroups(
  groups: SoleSilkGroup[] | null | undefined,
): Array<{ key: string; label: string }> {
  if (!groups?.length) return [];
  const out: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  for (const g of groups) {
    if (!aviamentoGroupHasResolvablePhoto(g)) continue;
    const key = aviamentoGroupKey(g);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: g.soleName || key });
  }
  return out;
}

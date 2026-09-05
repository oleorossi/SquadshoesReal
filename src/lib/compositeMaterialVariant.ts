import {
  evaluateUpperMaterialStructureCompatibility,
  type MaterialVariantGroupLayer,
} from '@/lib/materialVariantColorGroup';

export interface CompositeMaterialVariantGroup {
  id: string;
  name: string;
  is_family?: boolean | null;
  parent_group_id?: string | null;
}

export interface CompositeMaterialVariantLayer extends MaterialVariantGroupLayer {
  composite_group_id: string;
  display_order?: number | null;
}

export type CompositeMaterialLayer = CompositeMaterialVariantLayer;

export interface CompositeMaterialVariantCandidate {
  groupId: string;
  groupName: string;
}

export type CompositeMaterialVariantResolution =
  | { status: 'not_applicable' }
  | {
    status: 'invalid';
    reason: 'base_group_not_found' | 'base_color_source_invalid' | 'base_structure_missing'
      | 'main_group_not_found' | 'main_group_is_composite' | 'main_group_is_container';
  }
  | { status: 'missing'; expectedGroupName: string; sourceGroupId: string }
  | {
    status: 'ambiguous';
    expectedGroupName: string;
    sourceGroupId: string;
    candidates: CompositeMaterialVariantCandidate[];
  }
  | ({ status: 'resolved'; sourceGroupId: string } & CompositeMaterialVariantCandidate);

function identity(value?: string | null): string {
  return value?.trim().toLocaleLowerCase('pt-BR') || '';
}

function layersForGroup(layers: CompositeMaterialVariantLayer[], groupId: string) {
  return layers.filter((layer) => identity(layer.composite_group_id) === identity(groupId));
}

function uniqueColorSource(layers: MaterialVariantGroupLayer[]): string | null {
  const sources = layers.filter((layer) => layer.is_color_source === true);
  return sources.length === 1 ? identity(sources[0].component_group_id) || null : null;
}

/** A forração só acompanha a troca quando usa exatamente a fonte do dublado.
 * Rótulos parecidos e as camadas fixas não estabelecem essa relação. */
export function shouldVariantLiningFollowMainMaterial({
  baseGroupId,
  liningGroupId,
  layers,
}: {
  baseGroupId?: string | null;
  liningGroupId?: string | null;
  layers: CompositeMaterialVariantLayer[];
}): boolean {
  if (!baseGroupId || !liningGroupId) return false;
  const baseLayers = layersForGroup(layers, baseGroupId);
  if (!baseLayers.some((layer) => layer.is_color_source !== true)) return false;
  const sourceGroupId = uniqueColorSource(baseLayers);
  return sourceGroupId !== null && sourceGroupId === identity(liningGroupId);
}

/** Localiza o dublado da variante substituindo apenas a camada que fornece cor.
 * A identidade vem dos componentes: o nome sugerido serve só para apresentação.
 * Grupos ainda sem produtos continuam reutilizáveis, evitando duplicar cadastros. */
export function resolveCompositeMaterialVariant({
  baseGroupId,
  mainGroupId,
  groups,
  layers,
}: {
  baseGroupId?: string | null;
  mainGroupId?: string | null;
  groups: CompositeMaterialVariantGroup[];
  layers: CompositeMaterialVariantLayer[];
}): CompositeMaterialVariantResolution {
  if (!baseGroupId || !mainGroupId) return { status: 'not_applicable' };
  const baseLayers = layersForGroup(layers, baseGroupId);
  if (!baseLayers.length) return { status: 'not_applicable' };

  const baseGroup = groups.find((group) => identity(group.id) === identity(baseGroupId));
  if (!baseGroup) return { status: 'invalid', reason: 'base_group_not_found' };
  const sourceGroupId = uniqueColorSource(baseLayers);
  if (!sourceGroupId) return { status: 'invalid', reason: 'base_color_source_invalid' };
  if (!baseLayers.some((layer) => layer.is_color_source !== true)) {
    return { status: 'invalid', reason: 'base_structure_missing' };
  }

  const mainGroup = groups.find((group) => identity(group.id) === identity(mainGroupId));
  if (!mainGroup) return { status: 'invalid', reason: 'main_group_not_found' };
  const isContainer = (group: CompositeMaterialVariantGroup) => group.is_family === true
    || groups.some((child) => identity(child.parent_group_id) === identity(group.id));
  if (isContainer(mainGroup)) return { status: 'invalid', reason: 'main_group_is_container' };
  if (layersForGroup(layers, mainGroup.id).length) {
    return { status: 'invalid', reason: 'main_group_is_composite' };
  }

  // Selecionar a fonte original conserva a identidade da própria ficha,
  // mesmo se outro cadastro tiver composição idêntica.
  if (sourceGroupId === identity(mainGroup.id)) {
    return { status: 'resolved', groupId: baseGroup.id, groupName: baseGroup.name, sourceGroupId };
  }

  const expectedGroupName = [...baseLayers]
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((layer) => layer.is_color_source === true
      ? mainGroup.name
      : layer.component_label?.trim()
        || groups.find((group) => identity(group.id) === identity(layer.component_group_id))?.name
        || '')
    .filter(Boolean)
    .join(' + ');

  const candidates = groups.filter((group) => {
    if (isContainer(group)) return false;
    const candidateLayers = layersForGroup(layers, group.id);
    if (uniqueColorSource(candidateLayers) !== identity(mainGroup.id)) return false;
    return evaluateUpperMaterialStructureCompatibility({
      baseLayers,
      overrideLayers: candidateLayers,
      hasExplicitOverride: true,
    }).compatible;
  }).map((group) => ({ groupId: group.id, groupName: group.name }));

  if (!candidates.length) return { status: 'missing', expectedGroupName, sourceGroupId };
  if (candidates.length > 1) {
    return { status: 'ambiguous', expectedGroupName, sourceGroupId, candidates };
  }
  return { status: 'resolved', ...candidates[0], sourceGroupId };
}

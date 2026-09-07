/**
 * Tira artesanal nunca debita o grupo composto do cabedal (ex.: Soft+Massabox).
 * Padrão: usar a camada de napa (`is_color_source`) de `product_group_layers`.
 */

export interface StrapPeelLayer {
  composite_group_id?: string | null;
  component_group_id?: string | null;
  is_color_source?: boolean | null;
}

export interface StrapPeelGroup {
  id: string;
  name?: string | null;
}

/** Resolve o UUID efetivo da napa-base de uma tira a partir de um grupo (possivelmente composto). */
export function peelStrapBaseGroupId(
  groupId: string | null | undefined,
  layers: readonly StrapPeelLayer[] | null | undefined,
): string | null {
  const id = (groupId || '').trim();
  if (!id) return null;
  const compositeLayers = (layers || []).filter(
    (layer) => (layer.composite_group_id || '').trim() === id,
  );
  if (compositeLayers.length === 0) return id;
  const colorSource = compositeLayers.find(
    (layer) => layer.is_color_source === true && (layer.component_group_id || '').trim(),
  );
  const peeled = (colorSource?.component_group_id || '').trim();
  return peeled || id;
}

/** Aplica o peel a um mapa id→grupo, devolvendo o grupo efetivo (napa pura quando composto). */
export function peelStrapBaseGroup(
  group: StrapPeelGroup | null | undefined,
  layers: readonly StrapPeelLayer[] | null | undefined,
  groupsById: Map<string, StrapPeelGroup>,
): StrapPeelGroup | undefined {
  if (!group) return undefined;
  const peeledId = peelStrapBaseGroupId(group.id, layers);
  if (!peeledId || peeledId === group.id) return group;
  return groupsById.get(peeledId) || group;
}

export function suggestSkuAcabadoOrigemFromName(name: string | null | undefined): boolean {
  const normalized = (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('pt-BR');
  return normalized.includes('STRASS');
}

export type StrapOrigemPadrao = 'sempre_fabrica' | 'sempre_sku_acabado' | 'escolhe_no_pv';

export function normalizeStrapOrigemPadrao(value: string | null | undefined): StrapOrigemPadrao {
  if (value === 'sempre_sku_acabado' || value === 'escolhe_no_pv' || value === 'sempre_fabrica') {
    return value;
  }
  return 'escolhe_no_pv';
}

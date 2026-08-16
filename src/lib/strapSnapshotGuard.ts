export interface StrapSnapshotItemLike {
  reference_id?: string | null;
  reference_label?: string | null;
  strap_colors?: unknown[] | null;
}

export interface StrapSnapshotReferenceLike {
  id: string;
  code?: string | null;
  name?: string | null;
  has_straps?: boolean | null;
  strap_colors?: unknown[] | null;
  upper_material?: string | null;
}

/**
 * Detecta a lacuna que não aparece em `missingStrapSourcingLineIds`: uma ficha
 * declara tiras, mas o item perdeu todo o snapshot. Não tenta reconstruir cor,
 * medida ou variante; apenas devolve referências acionáveis para bloquear.
 */
export function listMissingTechnicalStrapSnapshots(
  items: StrapSnapshotItemLike[],
  references: StrapSnapshotReferenceLike[],
) {
  return items.flatMap((item, index) => {
    const reference = references.find((entry) => entry.id === item.reference_id);
    if (!reference) return [];
    const definitions = Array.isArray(reference.strap_colors) ? reference.strap_colors : [];
    const requiresStraps = reference.has_straps === true || definitions.length > 0;
    const hasCabedal = Boolean(String(reference.upper_material || '').trim());
    const snapshot = Array.isArray(item.strap_colors) ? item.strap_colors : [];
    if (!requiresStraps || hasCabedal || snapshot.length > 0) return [];
    return [{
      index,
      referenceId: reference.id,
      label: item.reference_label
        || [reference.code, reference.name].filter(Boolean).join(' ').trim()
        || `item ${index + 1}`,
    }];
  });
}


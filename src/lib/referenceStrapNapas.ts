/**
 * Napas da referência para as tiras multicolor (decisão do dono, grill de
 * 11/10/2026). Fonte única no servidor: `list_reference_strap_napas`, que aplica
 * `resolve_strap_base_group_id` à ficha sem variante e a cada variante ativa
 * (mig `20270101035700`). Aqui só ordena e interpreta — não recalcula napa.
 *
 * OB01: NAPA SOFT (napa-base da ficha) + GLOW METALIC (variante).
 */

export interface ReferenceStrapNapa {
  id: string;
  name: string;
  sortOrder: number;
  /** Napa que a ficha resolve SEM variante. */
  isSheetBase: boolean;
  /** Variantes ativas cuja napa resolvida é esta. */
  variantIds: string[];
}

const str = (value: unknown): string | null =>
  value == null || value === '' ? null : String(value);

/** Linhas do RPC → mapa por referência, na ordem do servidor. */
export function parseReferenceStrapNapas(rows: unknown): Map<string, ReferenceStrapNapa[]> {
  const byReference = new Map<string, ReferenceStrapNapa[]>();
  if (!Array.isArray(rows)) return byReference;
  for (const raw of rows) {
    const row = (raw || {}) as Record<string, unknown>;
    const referenceId = str(row.reference_id);
    const id = str(row.base_group_id);
    if (!referenceId || !id) continue;
    const list = byReference.get(referenceId) || [];
    list.push({
      id,
      name: String(row.base_group_name || ''),
      sortOrder: Number(row.sort_order) || 0,
      isSheetBase: row.is_sheet_base === true,
      variantIds: Array.isArray(row.variant_ids) ? row.variant_ids.map(String) : [],
    });
    byReference.set(referenceId, list);
  }
  for (const list of byReference.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  return byReference;
}

/**
 * Napa do material do item: a da variante escolhida; sem variante, a napa-base
 * da ficha. É a napa com que cada tira começa (Q4).
 */
export function itemDefaultNapaId(
  napas: readonly ReferenceStrapNapa[] | null | undefined,
  materialVariantId: string | null | undefined,
): string | null {
  if (!napas?.length) return null;
  const match = materialVariantId
    ? napas.find((napa) => napa.variantIds.includes(materialVariantId))
    : napas.find((napa) => napa.isSheetBase);
  return match?.id || null;
}

/** Ordem do seletor (Q3): napa do item primeiro, depois a ordem do servidor. */
export function orderNapasForItem(
  napas: readonly ReferenceStrapNapa[] | null | undefined,
  defaultNapaId: string | null | undefined,
): ReferenceStrapNapa[] {
  const list = [...(napas || [])];
  if (!defaultNapaId) return list;
  return list.sort((a, b) => Number(b.id === defaultNapaId) - Number(a.id === defaultNapaId));
}

/**
 * Troca do material do item (Q5): a tira que ainda está na napa do material
 * ANTIGO acompanha o novo material; a que foi trocada à mão para outra napa
 * fica. Sem napa gravada = acompanha.
 */
export function strapNapaFollowsItemMaterial(
  strapBaseGroupId: string | null | undefined,
  previousDefaultNapaId: string | null | undefined,
): boolean {
  return !strapBaseGroupId || strapBaseGroupId === previousDefaultNapaId;
}

export function keptStrapNapasMessage(kept: number): string | null {
  if (kept <= 0) return null;
  return kept === 1
    ? '1 tira manteve a napa escolhida.'
    : `${kept} tiras mantiveram a napa escolhida.`;
}

/**
 * Reimpressão parcial de rótulo externo por VOLUME impresso (n/N).
 *
 * O operador digita `20, 27` ou `50-55` — números do VOLUME da etiqueta, não
 * numeração do sapato nem folha do PDF. Volumes fora de 1…N são ignorados.
 * Campo vazio = aquele conjunto (PV+ref+cor) não entra no PDF.
 */

export interface ExternalVolumePartialGroup {
  groupKey: string;
  saleOrderNumber: string;
  referenceId: string;
  refCode: string;
  refName: string;
  colors: string[];
  orderNumbers: string[];
  /** Mesma chave usada em computeBoxItems: PV|ref|COR|variant */
  volumeSetKey: string;
  orders?: Array<{
    id?: string | null;
    color?: string | null;
    material_variant_id?: string | null;
  }>;
}

export interface ExternalVolumePartialRow {
  volumeSetKey: string;
  saleOrderNumber: string;
  refCode: string;
  refName: string;
  color: string;
  orderNumbers: string[];
  maxVolume: number;
  groupKeys: string[];
}

export type ExternalVolumePartialSelection = Record<string, string>;

/** Token de intervalo `50-55` (com ou sem espaços). */
const RANGE_TOKEN = /^(\d+)\s*-\s*(\d+)$/;
/** Token de volume único. */
const SINGLE_TOKEN = /^(\d+)$/;

/**
 * Converte o texto do operador em volumes válidos (1…maxVolume), únicos e
 * ordenados. Tokens inválidos e fora da faixa são descartados sem erro.
 */
export function parseRotuloVolumeSpec(text: string, maxVolume: number): number[] {
  const limit = Math.trunc(Number(maxVolume));
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const raw = String(text || '').trim();
  if (!raw) return [];

  const selected = new Set<number>();
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) continue;

    const range = token.match(RANGE_TOKEN);
    if (range) {
      let from = Math.trunc(Number(range[1]));
      let to = Math.trunc(Number(range[2]));
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      if (from > to) [from, to] = [to, from];
      for (let n = from; n <= to; n += 1) {
        if (n >= 1 && n <= limit) selected.add(n);
      }
      continue;
    }

    const single = token.match(SINGLE_TOKEN);
    if (!single) continue;
    const n = Math.trunc(Number(single[1]));
    if (n >= 1 && n <= limit) selected.add(n);
  }

  return [...selected].sort((a, b) => a - b);
}

export function volumeSetKeyForGroup(group: ExternalVolumePartialGroup): string {
  if (group.volumeSetKey) return group.volumeSetKey;
  const order = group.orders?.[0];
  const color = String(order?.color || group.colors[0] || '').toUpperCase().trim();
  const variant = order?.material_variant_id || '';
  return `${group.saleOrderNumber || ''}|${group.referenceId}|${color}|${variant}`;
}

/**
 * Inclui todos os grupos elegíveis que compartilham o mesmo conjunto de
 * volume (PV+ref+cor+variante) dos selecionados — necessário pra o N do
 * rótulo (20/62) refletir a carga inteira, não só a OP marcada.
 */
export function expandBoxGroupsForVolumeSets<T extends ExternalVolumePartialGroup>(
  selected: T[],
  allBoxEligible: T[],
): T[] {
  const keys = new Set(selected.map(volumeSetKeyForGroup));
  if (keys.size === 0) return [];
  return allBoxEligible.filter(group => keys.has(volumeSetKeyForGroup(group)));
}

export function buildExternalVolumePartialRows(
  selectedGroups: ExternalVolumePartialGroup[],
  maxVolumeBySet: Record<string, number>,
): ExternalVolumePartialRow[] {
  const bySet = new Map<string, ExternalVolumePartialRow>();

  for (const group of selectedGroups) {
    const volumeSetKey = volumeSetKeyForGroup(group);
    const maxVolume = Math.trunc(Number(maxVolumeBySet[volumeSetKey])) || 0;
    if (maxVolume <= 0) continue;

    const color = String(group.colors[0] || group.orders?.[0]?.color || '').trim() || 'Sem cor';
    const existing = bySet.get(volumeSetKey);
    if (!existing) {
      bySet.set(volumeSetKey, {
        volumeSetKey,
        saleOrderNumber: group.saleOrderNumber || '',
        refCode: group.refCode || '',
        refName: group.refName || '',
        color,
        orderNumbers: [...group.orderNumbers],
        maxVolume,
        groupKeys: [group.groupKey],
      });
      continue;
    }

    existing.groupKeys.push(group.groupKey);
    for (const orderNumber of group.orderNumbers) {
      if (!existing.orderNumbers.includes(orderNumber)) {
        existing.orderNumbers.push(orderNumber);
      }
    }
    existing.maxVolume = Math.max(existing.maxVolume, maxVolume);
  }

  return [...bySet.values()].sort((a, b) => {
    const pv = a.saleOrderNumber.localeCompare(b.saleOrderNumber, 'pt-BR', { numeric: true });
    if (pv !== 0) return pv;
    const ref = (a.refCode || a.refName).localeCompare(b.refCode || b.refName, 'pt-BR', { numeric: true });
    if (ref !== 0) return ref;
    return a.color.localeCompare(b.color, 'pt-BR');
  });
}

export function countVolumesInSelection(
  rows: ExternalVolumePartialRow[],
  selection: ExternalVolumePartialSelection,
): number {
  let total = 0;
  for (const row of rows) {
    total += parseRotuloVolumeSpec(selection[row.volumeSetKey] || '', row.maxVolume).length;
  }
  return total;
}

export function filterItemsByExternalVolumeSelection<T extends {
  volumeSetKey?: string | null;
  boxNumber: number;
}>(
  items: T[],
  rows: ExternalVolumePartialRow[],
  selection: ExternalVolumePartialSelection,
): T[] {
  const allowedBySet = new Map<string, Set<number>>();
  for (const row of rows) {
    const volumes = parseRotuloVolumeSpec(selection[row.volumeSetKey] || '', row.maxVolume);
    if (volumes.length === 0) continue;
    allowedBySet.set(row.volumeSetKey, new Set(volumes));
  }
  if (allowedBySet.size === 0) return [];

  return items.filter(item => {
    const key = item.volumeSetKey || '';
    const allowed = allowedBySet.get(key);
    if (!allowed) return false;
    return allowed.has(item.boxNumber);
  });
}

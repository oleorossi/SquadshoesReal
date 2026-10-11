/**
 * Tira "Comprar pronto" — só registra napa · cor + metros
 * (spec `specs/tira-comprar-pronto-so-registra.md`).
 *
 * Os metros espelham o SQL `private.strap_line_required_m` (D5), que o writer
 * grava no save: Σ (cm/par da numeração × pares da numeração) ÷ 100, com
 * pares da numeração = grade[n] × fichas (`sale_order_items.grade` é a curva
 * de UMA ficha; o gatilho de quantidade garante quantity = fichas × Σgrade).
 * A numeração escolhe o cm como `public.pick_consumption_for_size`; sem valor
 * próprio, vale o `consumption` escalar.
 */

/** Espelho de `public.pick_consumption_for_size` (grade conjugada "33/34"). */
export function pickConsumptionForSize(
  perSize: Record<string, unknown> | null | undefined,
  sizeKey: string,
): number | null {
  if (!perSize || typeof perSize !== 'object') return null;
  const key = (sizeKey || '').trim();
  if (!key || key.startsWith('_')) return null;
  const read = (k: string) => {
    const raw = perSize[k];
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    return toNumber(raw);
  };
  if (key in perSize) {
    const exact = read(key);
    if (exact !== null) return exact;
  }
  const parts = key.split('/').map((part) => part.trim()).filter(Boolean);
  const first = (key.split('/')[0] || '').trim();
  if (first && first !== key && first in perSize) {
    const value = read(first);
    if (value !== null) return value;
  }
  const conjugated = Object.keys(perSize)
    .filter((mapKey) => mapKey.includes('/')
      && mapKey.split('/').some((mapPart) => parts.includes(mapPart.trim())))
    .sort((a, b) => {
      const rank = (k: string) => (parts.includes((k.split('/')[0] || '').trim()) ? 0 : 1);
      return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
    });
  for (const candidate of conjugated) {
    const value = read(candidate);
    if (value !== null) return value;
  }
  if (key.includes('/')) {
    for (const part of parts) {
      if (part !== key && part in perSize) {
        const value = read(part);
        if (value !== null) return value;
      }
    }
  }
  return null;
}

export interface BuyReadyStrapConsumptionLike {
  consumption?: number | string | null;
  consumption_per_size?: Record<string, number | string | null> | null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function buyReadyStrapRequiredM(
  line: BuyReadyStrapConsumptionLike | null | undefined,
  grade: Record<string, unknown> | null | undefined,
  fichas: number | null | undefined,
): number {
  if (!line || !grade) return 0;
  const multiplier = toNumber(fichas) ?? 1;
  if (multiplier <= 0) return 0;
  const scalar = Math.max(toNumber(line.consumption) ?? 0, 0);
  const perSize = line.consumption_per_size || null;
  const hasPerSize = !!perSize && Object.keys(perSize).length > 0;
  let cm = 0;
  for (const [size, rawPairs] of Object.entries(grade)) {
    if (size.startsWith('_')) continue;
    const pairs = toNumber(rawPairs);
    if (!pairs || pairs <= 0) continue;
    const sizeCm = (hasPerSize ? pickConsumptionForSize(perSize, size) : null) ?? scalar;
    cm += sizeCm * pairs;
  }
  return Math.round(((cm * multiplier) / 100) * 10000) / 10000;
}

/** "TIRA OVERLOCK 5 mm · NAPA SOFT · ROSADO" — strass sem napa. */
export function buyReadyStrapDescription(parts: {
  strapName?: string | null;
  napaName?: string | null;
  colorName?: string | null;
}): string {
  return [parts.strapName, parts.napaName, parts.colorName]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' · ');
}

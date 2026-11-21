/**
 * Lançamento de produção por numeração.
 *
 * O total de pares continua sendo a quantidade do apontamento (relatório,
 * pagamento, progresso). A grade é o detalhe deste lançamento: o saldo de
 * cada número é a grade da OP menos o que já foi lançado COM numeração.
 *
 * Lançamentos antigos só têm o total. Esse miolo sem número ("legacy") não
 * inventa qual tamanho foi feito: a grade que ainda sobra é reduzida, pelo
 * mesmo método de maior resto do `scale_grade_to_total` do banco, até a soma
 * fechar o saldo de pares que ainda dá para lançar.
 */

export type SizeMap = Record<string, number>;

export interface SizeBalance {
  /** Números da grade da OP, do menor para o maior. */
  sizes: string[];
  /** Grade absoluta da etapa (Σ = quantity_total quando a grade existe). */
  target: SizeMap;
  /** Já lançado com numeração, líquido de estornos por número. */
  known: SizeMap;
  /** Teto deste lançamento, por número. Soma ≤ launchable. */
  pending: SizeMap;
  /** Pares já apontados no setor sem grade gravada. */
  legacyUnallocated: number;
  pairRemaining: number;
  launchable: number;
}

export interface SizeLaunchMeter {
  launched: number;
  falta: number;
  done: boolean;
  over: boolean;
}

function isSizeKey(key: string): boolean {
  return key.trim() !== '' && !key.startsWith('_');
}

export function sizeSort(a: string, b: string): number {
  const na = Number(a.match(/\d+/)?.[0] ?? Number.NaN);
  const nb = Number(b.match(/\d+/)?.[0] ?? Number.NaN);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, 'pt-BR');
}

/** Inteiros da grade, sem chaves internas (`_`) e sem zero. */
export function positiveSizes(grade: SizeMap | null | undefined): SizeMap {
  const out: SizeMap = {};
  if (!grade) return out;
  for (const [key, raw] of Object.entries(grade)) {
    if (!isSizeKey(key)) continue;
    const value = Math.trunc(Number(raw));
    if (Number.isFinite(value) && value > 0) out[key] = value;
  }
  return out;
}

export function sumSizes(grade: SizeMap | null | undefined): number {
  return Object.values(positiveSizes(grade)).reduce((sum, value) => sum + value, 0);
}

/**
 * Espelho de `public.scale_grade_to_total`: Hamilton, desempate por número.
 * Σ = round(total). Soma já igual ao total volta os inteiros positivos.
 */
export function scaleSizesToTotal(grade: SizeMap | null | undefined, total: number): SizeMap {
  const entries = Object.entries(positiveSizes(grade));
  const sum = entries.reduce((acc, [, value]) => acc + value, 0);
  const goal = Math.round(total);
  if (sum <= 0 || !(goal > 0)) return {};
  if (sum === goal) {
    return Object.fromEntries(entries);
  }
  const rows: Array<{ key: string; frac: number }> = [];
  const out: SizeMap = {};
  let scaled = 0;
  for (const [key, value] of entries) {
    const raw = (value * goal) / sum;
    const floor = Math.floor(raw);
    if (floor > 0) out[key] = floor;
    scaled += floor;
    rows.push({ key, frac: raw - floor });
  }
  let diff = goal - scaled;
  rows.sort((a, b) => (b.frac - a.frac) || a.key.localeCompare(b.key));
  for (let i = 0; diff > 0 && i < rows.length; i += 1, diff -= 1) {
    out[rows[i].key] = (out[rows[i].key] || 0) + 1;
  }
  return out;
}

export function pointingSizeBalance(input: {
  grade: SizeMap | null | undefined;
  quantityTotal: number;
  quantityProcessed: number;
  known: SizeMap | null | undefined;
  launchablePairs: number;
}): SizeBalance {
  const total = Math.max(0, Math.trunc(Number(input.quantityTotal) || 0));
  const processed = Math.max(0, Math.trunc(Number(input.quantityProcessed) || 0));
  const target = scaleSizesToTotal(input.grade, total);
  const known = positiveSizes(input.known);
  const knownSum = sumSizes(known);
  const legacyUnallocated = Math.max(0, processed - knownSum);
  const pairRemaining = Math.max(0, total - processed);
  const launchable = Math.max(0, Math.min(Math.trunc(Number(input.launchablePairs) || 0), pairRemaining));

  const raw: SizeMap = {};
  for (const [size, qty] of Object.entries(target)) {
    const left = qty - (known[size] || 0);
    if (left > 0) raw[size] = left;
  }
  const rawSum = sumSizes(raw);
  const pending = rawSum > launchable ? scaleSizesToTotal(raw, launchable) : raw;
  const sizes = [...new Set([...Object.keys(target), ...Object.keys(known)])].sort(sizeSort);

  return {
    sizes,
    target,
    known,
    pending,
    legacyUnallocated,
    pairRemaining,
    launchable,
  };
}

/** Contador da janela: digitado / falta, com a falta zerada = concluído. */
export function sizeLaunchMeter(typed: number, pending: number): SizeLaunchMeter {
  const cap = Math.max(0, Math.trunc(pending) || 0);
  const launched = Math.max(0, Math.trunc(typed) || 0);
  const over = launched > cap;
  const falta = Math.max(0, cap - launched);
  return { launched, falta, done: !over && cap > 0 && falta === 0, over };
}

export function clampSizeQuantity(typed: number, pending: number): number {
  const cap = Math.max(0, Math.trunc(pending) || 0);
  const value = Math.max(0, Math.trunc(Number(typed) || 0));
  return Math.min(value, cap);
}

/** Grade deste lançamento, só números > 0. No estorno os valores continuam positivos aqui. */
export function sizeBreakdownFromEntries(entries: SizeMap, caps: SizeMap): SizeMap {
  const out: SizeMap = {};
  for (const [size, cap] of Object.entries(positiveSizes(caps))) {
    const value = clampSizeQuantity(entries[size] || 0, cap);
    if (value > 0) out[size] = value;
  }
  return out;
}

export function negateSizeBreakdown(breakdown: SizeMap): SizeMap {
  const out: SizeMap = {};
  for (const [size, qty] of Object.entries(positiveSizes(breakdown))) {
    out[size] = -qty;
  }
  return out;
}

export function formatSizeBreakdown(breakdown: SizeMap | null | undefined): string {
  if (!breakdown) return '';
  return Object.entries(breakdown)
    .filter(([key, raw]) => {
      if (!key.trim() || key.startsWith('_')) return false;
      const value = Math.trunc(Number(raw));
      return Number.isFinite(value) && value !== 0;
    })
    .sort(([a], [b]) => sizeSort(a, b))
    .map(([size, qty]) => `${size}:${Math.trunc(Number(qty))}`)
    .join(' · ');
}

interface PointingSizeRow {
  stage_name: string;
  size_breakdown?: SizeMap | null;
}

/** Soma líquida dos lançamentos que gravaram numeração neste setor. */
export function knownSizesFromPointings(
  rows: readonly PointingSizeRow[],
  stageName: string,
  sameStage: (a: string, b: string) => boolean,
): SizeMap {
  const net: Record<string, number> = {};
  for (const row of rows) {
    if (!sameStage(row.stage_name, stageName) || !row.size_breakdown) continue;
    for (const [size, raw] of Object.entries(row.size_breakdown)) {
      if (!isSizeKey(size)) continue;
      const value = Math.trunc(Number(raw));
      if (!Number.isFinite(value) || value === 0) continue;
      net[size] = (net[size] || 0) + value;
    }
  }
  return positiveSizes(net);
}

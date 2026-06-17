// ════════════════════════════════════════════════════════════════════════
// Range Aviamento — faixas P/M/G PRÓPRIAS do setor de Aviamento (lógica pura).
//
// Segmento INDEPENDENTE das facas de Corte Cabedal. Uma "faixa" (P/M/G/...)
// agrupa várias numerações numa única coluna na ficha de operador de Aviamento:
// as quantidades são SOMADAS por faixa (ex.: 12 pares 34 + 12 do 35 + 12 do 36,
// com P={34,35,36} → "P: 36 pares") em vez de número-a-número. O motor continua
// calculando a quantidade por numeração no PV; aqui é só a agregação de exibição.
//
// Dois formatos convivem:
//
//  1) BOUNDARIES (faixa): `[{label, upTo}]` ordenado. Cada faixa cobre
//     contiguamente até `upTo` (inclusive); a ÚLTIMA com `upTo=null` pega o
//     "resto" (numerações acima do último corte). É o formato do PADRÃO GLOBAL
//     (system_settings.key='aviamento_pmg_default') — generaliza pra qualquer
//     range de numeração.
//
//  2) BUCKETS (explícito): `[{label, sizes[]}]`. É o que o motor de impressão lê
//     (technical_sheets.aviamento_size_ranges) — o OVERRIDE por referência.
//     Derivado das boundaries no momento da edição.
//
// Precedência por ficha (resolveSheetPmg):
//   - override com itens  → usa o override (a ref tem faixa própria).
//   - override = []        → SEM faixa (opt-out): numerações individuais.
//   - override null/ausente→ herda o PADRÃO GLOBAL (boundaries) expandido.
// ════════════════════════════════════════════════════════════════════════

/** Faixa explícita (formato do motor / override por ficha). */
export interface PmgBucket {
  label: string;
  sizes: string[];
}

/** Faixa do padrão global. `upTo=null` = "resto". */
export interface PmgBoundary {
  label: string;
  /** Última numeração (inclusive) coberta por esta faixa. null = pega o resto. */
  upTo: string | null;
}

const num = (s: string): number => parseInt(String(s), 10);
const isFiniteSize = (s: string): boolean => Number.isFinite(num(s));

/** Ordena numerações pelo valor numérico (ascendente). */
export const sortSizesNumeric = (sizes: string[]): string[] =>
  [...sizes].filter(isFiniteSize).sort((a, b) => num(a) - num(b));

/**
 * Ordena boundaries por `upTo` ascendente (null sempre por último = resto).
 * Defensivo: o padrão é cadastrado em ordem, mas não dependemos disso.
 */
const sortBoundaries = (boundaries: PmgBoundary[]): PmgBoundary[] =>
  [...boundaries].sort((a, b) => {
    if (a.upTo == null) return 1;
    if (b.upTo == null) return -1;
    return num(a.upTo) - num(b.upTo);
  });

/**
 * Qual faixa cobre uma numeração, dadas as boundaries. Contígua: a primeira
 * faixa cujo `upTo >= size`; se a numeração for maior que todos os cortes, cai
 * na faixa "resto" (upTo=null) ou, na ausência dela, na última faixa. Retorna o
 * label, ou null se não há boundaries.
 */
export function pmgLabelForSize(size: string, boundaries: PmgBoundary[]): string | null {
  if (!boundaries || boundaries.length === 0 || !isFiniteSize(size)) return null;
  const ordered = sortBoundaries(boundaries);
  const n = num(size);
  for (const b of ordered) {
    if (b.upTo == null) return b.label; // resto
    if (n <= num(b.upTo)) return b.label;
  }
  // Acima de todos os cortes e sem faixa "resto" → última faixa (maior).
  return ordered[ordered.length - 1]?.label ?? null;
}

/**
 * Expande boundaries → buckets explícitos, contra um conjunto de numerações.
 * Mantém a ordem das boundaries; descarta faixas que ficaram vazias.
 */
export function expandPmgByBoundaries(sizes: string[], boundaries: PmgBoundary[]): PmgBucket[] {
  if (!boundaries || boundaries.length === 0) return [];
  const ordered = sortBoundaries(boundaries);
  const byLabel = new Map<string, PmgBucket>();
  for (const b of ordered) byLabel.set(b.label, { label: b.label, sizes: [] });
  for (const size of sortSizesNumeric(sizes)) {
    const label = pmgLabelForSize(size, ordered);
    if (label && byLabel.has(label)) byLabel.get(label)!.sizes.push(size);
  }
  return ordered
    .map((b) => byLabel.get(b.label)!)
    .filter((bk) => bk.sizes.length > 0);
}

/**
 * Deriva boundaries a partir de buckets explícitos (pra semear a UI de faixa
 * quando a ficha já tem override, ou pra "salvar como padrão"). `upTo` = maior
 * numeração de cada faixa; a última vira "resto" (null).
 */
export function boundariesFromPmgBuckets(buckets: PmgBucket[]): PmgBoundary[] {
  const nonEmpty = (buckets || []).filter((b) => b.sizes && b.sizes.length > 0);
  // Ordena faixas pela MENOR numeração que cobrem (P antes de M antes de G).
  const ordered = [...nonEmpty].sort((a, b) => {
    const minA = Math.min(...a.sizes.map(num));
    const minB = Math.min(...b.sizes.map(num));
    return minA - minB;
  });
  return ordered.map((b, i) => ({
    label: b.label,
    upTo: i === ordered.length - 1 ? null : String(Math.max(...b.sizes.map(num))),
  }));
}

/**
 * Resolve as faixas EFETIVAS de uma ficha, aplicando a precedência:
 *   override(itens) → usa override; override([]) → null (opt-out, individual);
 *   override(null) → expande o padrão global (se houver) contra `sizes`.
 * Retorna os buckets pra usar/exibir, ou null quando é pra mostrar numeração
 * individual (sem faixa).
 */
export function resolveSheetPmg(
  override: PmgBucket[] | null | undefined,
  defaultBoundaries: PmgBoundary[] | null | undefined,
  sizes: string[],
): PmgBucket[] | null {
  if (Array.isArray(override)) {
    if (override.length > 0) return override;
    return null; // [] = opt-out explícito
  }
  if (defaultBoundaries && defaultBoundaries.length > 0) {
    const expanded = expandPmgByBoundaries(sizes, defaultBoundaries);
    return expanded.length > 0 ? expanded : null;
  }
  return null;
}

/** Mapa numeração → label de faixa, pronto pro motor (ou null se sem faixa). */
export function sizeToPmgMap(buckets: PmgBucket[] | null): Map<string, string> | null {
  if (!buckets || buckets.length === 0) return null;
  const m = new Map<string, string>();
  for (const b of buckets) for (const s of b.sizes) m.set(String(s), b.label);
  return m;
}

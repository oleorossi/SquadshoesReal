// ════════════════════════════════════════════════════════════════════════
// Facas de Corte Cabedal — modelo CANÔNICO (lógica pura, testável)
//
// Uma "faca" (P/M/G/...) agrupa várias numerações num único molde de corte do
// cabedal. Na ficha de operador do setor **Corte Cabedal**, as quantidades são
// SOMADAS por faca (ex.: 12 pares 34 + 12 do 35 + 12 do 36, com P={34,35,36} →
// "P: 36 pares") em vez de número-a-número.
//
// Dois formatos convivem (pedido user 2026-06-16 — "reutilizar entre refs,
// porém em algumas muda; selecionar o range que vai até cada faca"):
//
//  1) BOUNDARIES (faixa): `[{label, upTo, code?}]` ordenado. Cada faca cobre
//     contiguamente até `upTo` (inclusive); a ÚLTIMA com `upTo=null` pega o
//     "resto" (numerações acima do último corte). É o formato do **padrão
//     global** (system_settings) — generaliza pra qualquer range de numeração.
//
//  2) BUCKETS (explícito): `[{label, sizes[], code?}]`. É o que o motor de
//     impressão já lê (technical_sheets.knife_size_ranges) — o OVERRIDE por
//     referência. Derivado das boundaries no momento da edição.
//
// Precedência por ficha (resolveSheetFacas):
//   - override com itens  → usa o override (a ref tem faca própria).
//   - override = []        → SEM faca (opt-out): mostra numerações individuais.
//   - override null/ausente→ herda o PADRÃO GLOBAL (boundaries) expandido.
// ════════════════════════════════════════════════════════════════════════

/** Faca explícita (formato do motor / override por ficha). */
export interface KnifeBucket {
  label: string;
  sizes: string[];
  /** Código físico da faca (opcional). */
  code?: string;
}

/** Faixa de uma faca (formato do padrão global). `upTo=null` = "resto". */
export interface FacaBoundary {
  label: string;
  /** Última numeração (inclusive) coberta por esta faca. null = pega o resto. */
  upTo: string | null;
  code?: string;
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
const sortBoundaries = (boundaries: FacaBoundary[]): FacaBoundary[] =>
  [...boundaries].sort((a, b) => {
    if (a.upTo == null) return 1;
    if (b.upTo == null) return -1;
    return num(a.upTo) - num(b.upTo);
  });

/**
 * Qual faca cobre uma numeração, dadas as boundaries. Contígua: a primeira faca
 * cujo `upTo >= size`; se a numeração for maior que todos os cortes, cai na
 * faca "resto" (upTo=null) ou, na ausência dela, na última faca. Retorna o
 * label, ou null se não há boundaries.
 */
export function facaLabelForSize(size: string, boundaries: FacaBoundary[]): string | null {
  if (!boundaries || boundaries.length === 0 || !isFiniteSize(size)) return null;
  const ordered = sortBoundaries(boundaries);
  const n = num(size);
  for (const b of ordered) {
    if (b.upTo == null) return b.label; // resto
    if (n <= num(b.upTo)) return b.label;
  }
  // Acima de todos os cortes e sem faca "resto" → última faca (maior).
  return ordered[ordered.length - 1]?.label ?? null;
}

/**
 * Expande boundaries → buckets explícitos, contra um conjunto de numerações.
 * Mantém a ordem das boundaries; descarta facas que ficaram vazias.
 */
export function expandFacasByBoundaries(sizes: string[], boundaries: FacaBoundary[]): KnifeBucket[] {
  if (!boundaries || boundaries.length === 0) return [];
  const ordered = sortBoundaries(boundaries);
  const byLabel = new Map<string, KnifeBucket>();
  for (const b of ordered) byLabel.set(b.label, { label: b.label, sizes: [], code: b.code });
  for (const size of sortSizesNumeric(sizes)) {
    const label = facaLabelForSize(size, ordered);
    if (label && byLabel.has(label)) byLabel.get(label)!.sizes.push(size);
  }
  return ordered
    .map((b) => byLabel.get(b.label)!)
    .filter((bk) => bk.sizes.length > 0);
}

/**
 * Deriva boundaries a partir de buckets explícitos (pra semear a UI de faixa
 * quando a ficha já tem override, ou pra "salvar como padrão"). `upTo` = maior
 * numeração de cada faca; a última vira "resto" (null).
 */
export function boundariesFromBuckets(buckets: KnifeBucket[]): FacaBoundary[] {
  const nonEmpty = (buckets || []).filter((b) => b.sizes && b.sizes.length > 0);
  // Ordena facas pela MENOR numeração que cobrem (P antes de M antes de G).
  const ordered = [...nonEmpty].sort((a, b) => {
    const minA = Math.min(...a.sizes.map(num));
    const minB = Math.min(...b.sizes.map(num));
    return minA - minB;
  });
  return ordered.map((b, i) => ({
    label: b.label,
    upTo: i === ordered.length - 1 ? null : String(Math.max(...b.sizes.map(num))),
    code: b.code,
  }));
}

/**
 * Resolve as facas EFETIVAS de uma ficha, aplicando a precedência:
 *   override(itens) → usa override; override([]) → null (opt-out, individual);
 *   override(null) → expande o padrão global (se houver) contra `sizes`.
 * Retorna os buckets pra usar/exibir, ou null quando é pra mostrar numeração
 * individual (sem faca).
 */
export function resolveSheetFacas(
  override: KnifeBucket[] | null | undefined,
  defaultBoundaries: FacaBoundary[] | null | undefined,
  sizes: string[],
): KnifeBucket[] | null {
  if (Array.isArray(override)) {
    if (override.length > 0) return override;
    return null; // [] = opt-out explícito
  }
  if (defaultBoundaries && defaultBoundaries.length > 0) {
    const expanded = expandFacasByBoundaries(sizes, defaultBoundaries);
    return expanded.length > 0 ? expanded : null;
  }
  return null;
}

/** Mapa numeração → label de faca, pronto pro motor (ou null se sem faca). */
export function sizeToFacaMap(buckets: KnifeBucket[] | null): Map<string, string> | null {
  if (!buckets || buckets.length === 0) return null;
  const m = new Map<string, string>();
  for (const b of buckets) for (const s of b.sizes) m.set(String(s), b.label);
  return m;
}

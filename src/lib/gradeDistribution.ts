/**
 * Rateio de grade por numeração (método do maior resto / largest remainder).
 *
 * Toma um mapa de PESOS (ex.: `size_breakdown` = demanda por numeração) e o
 * redistribui em inteiros cuja soma é EXATAMENTE `target`, preservando a
 * proporção do input.
 *
 * Motivação (auditoria 2026-07-02): a OC de solado auto-gerada gravava
 * `grade = size_breakdown` (soma = demanda TOTAL do PV) mas `quantity =
 * suggested_purchase_qty` (falta líquida ou MOQ). Quando há estoque parcial ou
 * MOQ > falta, soma(grade) ≠ quantity e o recebimento inteiro trava em
 * `mergeReceivedGrade` ("a grade soma X mas a quantidade é Y"). Rateando a grade
 * pro total realmente comprado, o invariante soma(grade) == quantity é mantido
 * na criação — mesma matemática do `handlePullFromOrder` do SoleGradeEditorDialog.
 */
export function rateGradeToTotal(
  weights: Record<string, number> | null | undefined,
  target: number,
): Record<string, number> | null {
  const t = Math.round(Number(target) || 0);
  if (!weights || t <= 0) return null;

  const entries = Object.entries(weights)
    .filter(([k, v]) => !k.startsWith('_') && Number(v) > 0)
    .map(([k, v]) => [k, Number(v)] as [string, number]);

  const totalWeight = entries.reduce((s, [, v]) => s + v, 0);
  if (entries.length === 0 || totalWeight <= 0) return null;

  const parts = entries.map(([k, v]) => {
    const exact = (v / totalWeight) * t;
    const base = Math.floor(exact);
    return { k, base, frac: exact - base };
  });

  let remainder = t - parts.reduce((acc, p) => acc + p.base, 0);
  const ordered = [...parts].sort((a, b) => b.frac - a.frac);
  for (const p of ordered) {
    if (remainder <= 0) break;
    p.base += 1;
    remainder--;
  }

  const out: Record<string, number> = {};
  for (const p of parts) if (p.base > 0) out[p.k] = p.base;
  return Object.keys(out).length ? out : null;
}

/**
 * Lê uma quantidade da grade sem contar duas vezes numerações conjugadas.
 * A chave canônica (ex.: "33/34") sempre vence. O fallback para as chaves
 * individuais só atende cadastros legados que ainda não foram consolidados.
 */
export function getGradeQuantityForKey(
  grade: Record<string, unknown> | null | undefined,
  sizeKey: string,
): number {
  if (!grade || !sizeKey || sizeKey.startsWith('_')) return 0;
  if (Object.prototype.hasOwnProperty.call(grade, sizeKey)) {
    return Math.max(0, Number(grade[sizeKey]) || 0);
  }
  if (!sizeKey.includes('/')) return 0;
  return [...new Set(sizeKey.split('/'))]
    .reduce((sum, size) => sum + Math.max(0, Number(grade[size]) || 0), 0);
}

/** Soma a grade ignorando metadados e chaves individuais já cobertas por um
 * balde conjugado canônico. Útil durante a transição de cadastros legados. */
export function getGradeTotal(
  grade: Record<string, unknown> | null | undefined,
): number {
  if (!grade) return 0;
  const entries = Object.entries(grade).filter(([key]) => !key.startsWith('_'));
  const coveredIndividuals = new Set(
    entries.flatMap(([key]) => key.includes('/') ? key.split('/') : []),
  );
  return entries.reduce((total, [key, value]) => {
    if (!key.includes('/') && coveredIndividuals.has(key)) return total;
    return total + Math.max(0, Number(value) || 0);
  }, 0);
}

export interface GradeCoverage {
  coveredOnHandBySize: Record<string, number>;
  coveredIncomingBySize: Record<string, number>;
  shortageBySize: Record<string, number>;
  totalRequired: number;
  totalCoveredOnHand: number;
  totalCoveredIncoming: number;
  totalShortage: number;
}

/**
 * Compara demanda, estoque e compras em trânsito por numeração. Sobra no nº 40
 * não cobre falta no nº 36; esta é a diferença essencial para solados.
 */
export function calculateGradeCoverage(
  required: Record<string, number> | null | undefined,
  onHand: Record<string, unknown> | null | undefined,
  incoming?: Record<string, unknown> | null,
): GradeCoverage {
  const coveredOnHandBySize: Record<string, number> = {};
  const coveredIncomingBySize: Record<string, number> = {};
  const shortageBySize: Record<string, number> = {};

  let totalRequired = 0;
  let totalCoveredOnHand = 0;
  let totalCoveredIncoming = 0;
  let totalShortage = 0;

  for (const [sizeKey, rawRequired] of Object.entries(required || {})) {
    if (sizeKey.startsWith('_')) continue;
    const requiredQty = Math.max(0, Number(rawRequired) || 0);
    if (requiredQty <= 0) continue;

    const onHandQty = getGradeQuantityForKey(onHand, sizeKey);
    const coveredOnHand = Math.min(requiredQty, onHandQty);
    const afterStock = requiredQty - coveredOnHand;
    const incomingQty = getGradeQuantityForKey(incoming, sizeKey);
    const coveredIncoming = Math.min(afterStock, incomingQty);
    const shortage = afterStock - coveredIncoming;

    totalRequired += requiredQty;
    totalCoveredOnHand += coveredOnHand;
    totalCoveredIncoming += coveredIncoming;
    totalShortage += shortage;
    if (coveredOnHand > 0) coveredOnHandBySize[sizeKey] = coveredOnHand;
    if (coveredIncoming > 0) coveredIncomingBySize[sizeKey] = coveredIncoming;
    if (shortage > 0) shortageBySize[sizeKey] = shortage;
  }

  return {
    coveredOnHandBySize,
    coveredIncomingBySize,
    shortageBySize,
    totalRequired,
    totalCoveredOnHand,
    totalCoveredIncoming,
    totalShortage,
  };
}

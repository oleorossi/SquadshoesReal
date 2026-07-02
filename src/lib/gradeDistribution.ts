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

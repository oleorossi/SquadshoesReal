/**
 * Faixa De/Até de folhas físicas na prévia de impressão (cartão e fichas A4).
 * Índices 1-based inclusive. Total ≤ 0 → faixa degenerada {1,1}.
 */
export function clampPageRange(
  from: number,
  to: number,
  total: number,
): { from: number; to: number } {
  if (!Number.isFinite(total) || total <= 0) return { from: 1, to: 1 };
  const totalInt = Math.floor(total);
  const rawFrom = Number.isFinite(from) ? Math.floor(from) : 1;
  const rawTo = Number.isFinite(to) ? Math.floor(to) : totalInt;
  const clampedFrom = Math.min(Math.max(1, rawFrom), totalInt);
  const clampedTo = Math.min(Math.max(clampedFrom, rawTo), totalInt);
  return { from: clampedFrom, to: clampedTo };
}

/** Página global 1-based está dentro da faixa (inclusive)? */
export function isPageInRange(page1Based: number, from: number, to: number): boolean {
  return page1Based >= from && page1Based <= to;
}

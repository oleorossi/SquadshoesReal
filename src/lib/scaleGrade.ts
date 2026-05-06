/**
 * Scales a grade ({size: pairs}) by a non-integer multiplier and rounds the
 * results so that sum(scaled) === round(totalPairs). Uses the largest-remainder
 * (Hamilton) method: floor every value, then add 1 to the sizes with the
 * largest fractional remainders until the diff is exhausted.
 *
 * Naive `Math.round(qty * multiplier)` per size leaves the sum off by ±N
 * (where N = number of sizes with non-zero raw values). Worksheets and
 * reports that displayed a per-size grade alongside a total were inconsistent
 * with that total — operators counting cells noticed the gap.
 */
export function scaleGradeWithLargestRemainder(
  grade: Record<string, number> | null | undefined,
  multiplier: number,
  totalPairs: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!grade || multiplier <= 0) return out;
  const remainders: Array<{ key: string; frac: number }> = [];
  let scaledSum = 0;
  for (const [key, qty] of Object.entries(grade)) {
    const q = Number(qty) || 0;
    if (q <= 0) continue;
    const raw = q * multiplier;
    const floor = Math.floor(raw);
    if (floor > 0) out[key] = floor;
    scaledSum += floor;
    remainders.push({ key, frac: raw - floor });
  }
  let diff = Math.round(totalPairs) - scaledSum;
  remainders.sort((a, b) => b.frac - a.frac);
  for (let i = 0; diff > 0 && i < remainders.length; i++, diff--) {
    out[remainders[i].key] = (out[remainders[i].key] || 0) + 1;
  }
  return out;
}

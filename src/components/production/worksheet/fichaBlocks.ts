/**
 * Blocos de 20 fichas na palmilha.
 *
 * O corrugado continua de 12 pares (curva "Por Ficha"). A impressão agrupa
 * essas fichas de 20 em 20: cada bloco mostra a curva já multiplicada pelo
 * número de fichas do bloco. O último bloco menor é o "completar".
 */

export const FICHA_BLOCK_SIZE = 20;

export interface FichaBlock {
  index: number;
  fichas: number;
  pairs: number;
  completar: boolean;
  grade: Record<string, number>;
}

function positiveCurve(curve: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(curve || {})) {
    const value = Math.trunc(Number(raw) || 0);
    if (value > 0) out[key] = value;
  }
  return out;
}

export function splitFichasIntoBlocks(input: {
  fichas: number;
  curve: Record<string, number> | null | undefined;
  sizes?: readonly string[];
  blockSize?: number;
}): FichaBlock[] {
  const fichas = Math.max(0, Math.trunc(Number(input.fichas) || 0));
  const curve = positiveCurve(input.curve);
  const curveSum = Object.values(curve).reduce((sum, value) => sum + value, 0);
  if (fichas <= 0 || curveSum <= 0) return [];

  const sizes = (input.sizes && input.sizes.length > 0
    ? input.sizes.filter(size => (curve[size] || 0) > 0)
    : Object.keys(curve));
  const blockSize = Math.max(1, Math.trunc(input.blockSize || FICHA_BLOCK_SIZE));
  const blocks: FichaBlock[] = [];
  let left = fichas;
  let index = 1;
  while (left > 0) {
    const count = Math.min(blockSize, left);
    const grade: Record<string, number> = {};
    for (const size of sizes) grade[size] = (curve[size] || 0) * count;
    const pairs = Object.values(grade).reduce((sum, value) => sum + value, 0);
    blocks.push({
      index,
      fichas: count,
      pairs,
      completar: count < blockSize,
      grade,
    });
    left -= count;
    index += 1;
  }
  return blocks;
}

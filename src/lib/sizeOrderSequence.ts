/**
 * Expande a grade (pares por numeração) na ordem de número individual,
 * da menor para a maior, repetindo cada numeração pela quantidade de pares.
 * Ex.: { 34: 1, 35: 1, 36: 2 } → ['34', '35', '36', '36'].
 * Usado no cartão do Fardo e na ficha de Palmilha para o cortador/embalador
 * marcar o que já saiu, par a par.
 */
export function expandGradeToSizeOrder(
  sizes: readonly string[],
  grade: Record<string, number> | null | undefined,
): string[] {
  const out: string[] = [];
  for (const size of sizes) {
    const n = Math.max(0, Math.floor(Number(grade?.[size]) || 0));
    for (let i = 0; i < n; i += 1) out.push(String(size));
  }
  return out;
}

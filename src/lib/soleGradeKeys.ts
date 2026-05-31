/**
 * Helper de keys de grade de solado.
 *
 * Histórico:
 *   - 19/05/2026: criado pra suportar conjugações de numeração (33/34 = 1 par).
 *   - 31/05/2026: feature de conjugação REMOVIDA por decisão do user. Tabela
 *     sole_size_conjugations dropada; estoque conjugado migrado pra
 *     tamanhos individuais via split 50/50.
 *
 * API mantida pra não quebrar callers — retorna sempre `sizes.map(String)`
 * direto. Sem query no DB.
 */

/** Faixa numérica → keys individuais (sem conjugação). */
export function buildDisplayKeysWithConjugations(opts: {
  sizes: number[];
  /** @deprecated parâmetro ignorado — conjugação removida 31/05/2026. */
  conjugations?: unknown;
}): string[] {
  return opts.sizes.map(String);
}

/** Hook React — retorna lista de keys (1:1 com sizes). Sem query DB. */
export function useDisplaySizeKeys(opts: {
  sizes: number[];
  /** @deprecated parâmetro ignorado — conjugação removida 31/05/2026. */
  soleGroupId?: string | null;
}): string[] {
  return opts.sizes.map(String);
}

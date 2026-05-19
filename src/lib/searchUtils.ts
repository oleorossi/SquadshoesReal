/**
 * Normaliza string pra busca: remove espaços, acentos e case-folds.
 *
 * Permite que "SP 10", "sp10", "Sp-10" e "SP10" sejam todos equivalentes
 * — o user reportou (19/05/2026) que digitar "SP10" não achava referência
 * cadastrada como "SP 10" e vice-versa.
 *
 * Também remove caracteres não-alfanuméricos (-, /, ., etc) pra cobrir
 * variações tipo "PV-00111" vs "PV00111" / "PV 00111".
 */
export function normalizeForSearch(s: string | null | undefined): string {
  return (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9]/g, ''); // mantém só alfanumérico (remove espaços, hífens, etc)
}

/**
 * Retorna true se `query` está contida em `haystack` após normalização.
 * Use em filters: `array.filter(item => searchMatches(item.name, query))`.
 *
 * Query vazia/null → match true (não filtra).
 */
export function searchMatches(haystack: string | null | undefined, query: string | null | undefined): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  return normalizeForSearch(haystack).includes(q);
}

/**
 * Igual a searchMatches mas testa contra vários campos. Retorna true se
 * QUALQUER campo contém a query.
 */
export function searchMatchesAny(query: string | null | undefined, ...haystacks: Array<string | null | undefined>): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  return haystacks.some(h => normalizeForSearch(h).includes(q));
}

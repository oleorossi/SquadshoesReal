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

/**
 * Divide a query em termos de refinamento AND — separados por "/", espaço OU
 * vírgula. "stx / alcineu" → ["stx", "alcineu"]; "napa tamara" → ["napa",
 * "tamara"]; "op-1,op-2" → ["op-1", "op-2"]. Faz trim e descarta vazios.
 *
 * Espaço virou separador em 2026-07-11 (spec melhorias-busca-sistema) pra
 * alinhar com o comportamento server-side de searchNormOrFilter — antes
 * "napa tamara" era colado em "napatamara" e só achava a sequência exata.
 * Vírgula preservada porque telas antigas (WaveBuilder, Imprimir Fichas)
 * ensinavam "separe por vírgula" — sem ela, "op1,op2" colaria num termo só.
 *
 * ⚠ O split precisa acontecer ANTES de normalizar — normalizeForSearch remove
 * "/", espaço e vírgula (não-alfanuméricos), então normalizar primeiro juntaria
 * os termos.
 * ⚠ O "/" no INÍCIO (ex.: "/lng" = atalho de grupo econômico) é tratado à parte
 * por quem chama, ANTES de usar este helper.
 */
export function splitSearchTerms(query: string | null | undefined): string[] {
  return (query ?? '').split(/[/,\s]+/).map(t => t.trim()).filter(Boolean);
}

/**
 * Refinamento AND por espaço ou "/": cada termo precisa casar com ALGUM dos
 * campos. AND entre termos, OR entre campos. Ex.: "stx alcineu" (ou
 * "stx / alcineu") exige um campo contendo "stx" E um campo contendo "alcineu"
 * (referência + cliente, em qualquer ordem).
 *
 * Com 1 termo só, comporta-se EXATAMENTE como searchMatchesAny. Mesma semântica
 * do lado server (searchNormOrFilter). Query vazia → true (não filtra).
 */
export function searchMatchesAllTerms(query: string | null | undefined, ...haystacks: Array<string | null | undefined>): boolean {
  const terms = splitSearchTerms(query);
  if (terms.length === 0) return true;
  const normHaystacks = haystacks.map(normalizeForSearch);
  return terms.every(term => {
    const t = normalizeForSearch(term);
    return t === '' || normHaystacks.some(h => h.includes(t));
  });
}

/**
 * Remove a coluna gerada `search_norm` de um payload de INSERT/UPDATE.
 *
 * `search_norm` é GENERATED ALWAYS — o Postgres rejeita qualquer write que a
 * inclua. Payloads construídos por spread de uma row SELECTada (clone/edição)
 * carregam a coluna sem querer. Use este strip em toda camada de mutation que
 * recebe objeto opaco (`insert(form)`, `update(payload)`), pra qualquer tabela
 * com search_norm (ver migrations 20260613120000 e 20260911180000).
 */
export function stripSearchNorm<T>(payload: T): T {
  if (payload && typeof payload === 'object' && 'search_norm' in (payload as Record<string, unknown>)) {
    const { search_norm: _sn, ...rest } = payload as Record<string, unknown>;
    return rest as T;
  }
  return payload;
}

/**
 * Monta o fragmento de filtro `.or()` do PostgREST para casar contra uma coluna
 * `search_norm` gerada no banco (mesma transformação do normalizeForSearch:
 * lower + sem acento + só alfanumérico — ver migration
 * 20260613120000_accent-insensitive-search).
 *
 * Tokeniza por "/" E espaço, normaliza cada token e exige AND entre eles
 * (`and(col.ilike.%a%,col.ilike.%b%)`); 1 token → `col.ilike.%a%`. Assim
 * "napa tamara" e "tamara / napa" casam um registro que contém AMBAS as palavras,
 * e acento/caixa/espaço/pontuação são ignorados ("tamara" casa "TÂMARA", "sp10"
 * casa "SP 10"). Como normalizeForSearch só deixa [a-z0-9], os tokens não contêm
 * caractere especial do PostgREST (`,%()\\`) — seguro interpolar.
 *
 * Retorna '' quando a query normaliza pra vazio — o caller deve pular/tratar
 * (filtrar com `.filter(Boolean)` antes de `.or(parts.join(','))`).
 */
export function searchNormOrFilter(query: string | null | undefined, column = 'search_norm'): string {
  const tokens = (query ?? '')
    .split(/[/,\s]+/)
    .map(normalizeForSearch)
    .filter(Boolean);
  if (tokens.length === 0) return '';
  if (tokens.length === 1) return `${column}.ilike.%${tokens[0]}%`;
  return `and(${tokens.map(t => `${column}.ilike.%${t}%`).join(',')})`;
}

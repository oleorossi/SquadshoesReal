import { normalizeForSearch, searchMatchesAllTerms } from '@/lib/searchUtils';

/**
 * Busca por lista de códigos de OP/PV.
 *
 * Colar vários números (quebra de linha, vírgula, ponto-e-vírgula ou "/")
 * com ≥2 tokens vira modo OR por **número exato normalizado** (strip OP-/PV-,
 * espaços, pontuação). Um termo só ou texto livre continua no AND clássico
 * via `searchMatchesAllTerms`.
 */

const LIST_SPLIT = /[\n\r,;/]+/;

/** Normaliza um código de OP/PV pra comparação exata (só alfanumérico lower). */
export function normalizeOrderCode(raw: string | null | undefined): string {
  return normalizeForSearch(raw);
}

/**
 * Extrai códigos de uma query colada. Retorna [] se não parecer lista
 * (≥2 tokens após split por quebra/`,`/`;`/`/`).
 */
export function parseOrderCodeList(text: string | null | undefined): string[] {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  // Precisa de separador de lista — espaços sozinhos NÃO contam (são AND
  // de texto livre: "stx alcineu"). Só \n , ; / abrem modo lista.
  if (!/[\n\r,;/]/.test(raw)) return [];
  const codes = raw
    .split(LIST_SPLIT)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(normalizeOrderCode)
    .filter(Boolean);
  // Dedup preservando ordem
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of codes) {
    if (seen.has(c)) continue;
    seen.add(c);
    unique.push(c);
  }
  return unique.length >= 2 ? unique : [];
}

export function looksLikeOrderCodeList(text: string | null | undefined): boolean {
  return parseOrderCodeList(text).length >= 2;
}

/** True se algum haystack, normalizado, é exatamente igual ao código. */
export function orderCodeExactMatch(
  normalizedCode: string,
  ...haystacks: Array<string | null | undefined>
): boolean {
  if (!normalizedCode) return false;
  return haystacks.some((h) => normalizeOrderCode(h) === normalizedCode);
}

export interface OrderSearchFields {
  orderNumber?: string | null;
  saleOrderNumber?: string | null;
  clientName?: string | null;
  clientOrderNumber?: string | null;
  referenceName?: string | null;
  referenceCode?: string | null;
  color?: string | null;
}

/**
 * Filtra um item pela query: modo lista (OR exato em OP/PV) ou texto livre
 * (AND nos campos padronizados).
 */
export function matchesOrderSearch(
  query: string | null | undefined,
  fields: OrderSearchFields,
): boolean {
  const codes = parseOrderCodeList(query);
  if (codes.length >= 2) {
    return codes.some((code) =>
      orderCodeExactMatch(code, fields.orderNumber, fields.saleOrderNumber),
    );
  }
  return searchMatchesAllTerms(
    query,
    fields.orderNumber,
    fields.saleOrderNumber,
    fields.clientName,
    fields.clientOrderNumber,
    fields.referenceName,
    fields.referenceCode,
    fields.color,
  );
}

/**
 * Ids da lista completa (não só a filtrada) cujos OP#/PV# batem exatamente
 * com os códigos colados — pra “Selecionar os que bateram”.
 */
export function findIdsMatchingOrderCodes<T>(
  items: T[],
  codes: string[],
  getFields: (item: T) => { id: string } & Pick<OrderSearchFields, 'orderNumber' | 'saleOrderNumber'>,
): string[] {
  if (codes.length === 0) return [];
  const codeSet = new Set(codes);
  const ids: string[] = [];
  for (const item of items) {
    const f = getFields(item);
    const op = normalizeOrderCode(f.orderNumber);
    const pv = normalizeOrderCode(f.saleOrderNumber);
    if ((op && codeSet.has(op)) || (pv && codeSet.has(pv))) {
      ids.push(f.id);
    }
  }
  return ids;
}

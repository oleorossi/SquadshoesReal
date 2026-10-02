import { normalizeForSearch, searchMatches, searchMatchesAllTerms } from '@/lib/searchUtils';

/**
 * Busca de OP/PV com três modos:
 *
 * 1. **Lista colada** — separadores `\n , ; /`, ≥2 tokens, e **todos** os
 *    pedaços parecem código de OP/PV (padrão `OP`/`PV`/só dígitos **ou**
 *    existem em `knownCodes`) → OR exato no número.
 * 2. **Ref/cor posicional** — `;` ou `/` com ≥2 pedaços que NÃO passaram na
 *    heurística de lista → 1º = referência, 2º = cor (contains, mesmo item),
 *    demais = AND livre nos outros campos. Query começando com `/` NÃO entra
 *    aqui (atalho `/grupo` em Pedidos).
 * 3. **Texto livre** — AND clássico via `searchMatchesAllTerms` (espaço/`,`/`/`).
 */

const LIST_SPLIT = /[\n\r,;/]+/;
/** Separadores do modo posicional ref/cor (não inclui vírgula nem quebra). */
const REF_COLOR_SPLIT = /[;/]+/;

/** Normaliza um código de OP/PV pra comparação exata (só alfanumérico lower). */
export function normalizeOrderCode(raw: string | null | undefined): string {
  return normalizeForSearch(raw);
}

/**
 * Token “parece” código de OP/PV: prefixo OP/PV após normalizar, ou só dígitos.
 * Refs curtas (`g03`) e cores (`prata`) NÃO passam — caem no modo ref/cor.
 */
export function looksLikeOrderCodeToken(raw: string | null | undefined): boolean {
  const n = normalizeOrderCode(raw);
  if (!n) return false;
  if (n.startsWith('op') || n.startsWith('pv')) return true;
  if (/^\d+$/.test(n)) return true;
  return false;
}

function toKnownCodeSet(knownCodes?: Iterable<string> | null): Set<string> | null {
  if (!knownCodes) return null;
  const set = new Set<string>();
  for (const c of knownCodes) {
    const n = normalizeOrderCode(c);
    if (n) set.add(n);
  }
  return set.size > 0 ? set : null;
}

function tokenIsOrderCode(raw: string, known: Set<string> | null): boolean {
  const n = normalizeOrderCode(raw);
  if (!n) return false;
  if (looksLikeOrderCodeToken(raw)) return true;
  if (known?.has(n)) return true;
  return false;
}

function splitListRawParts(text: string): string[] {
  return text
    .split(LIST_SPLIT)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Extrai códigos de uma query colada. Retorna [] se não parecer lista
 * (≥2 tokens + heurística: todos parecem/existem como OP/PV).
 */
export function parseOrderCodeList(
  text: string | null | undefined,
  knownCodes?: Iterable<string> | null,
): string[] {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  // Precisa de separador de lista — espaços sozinhos NÃO contam (são AND
  // de texto livre: "stx alcineu"). Só \n , ; / abrem candidato a lista.
  if (!/[\n\r,;/]/.test(raw)) return [];
  const parts = splitListRawParts(raw);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of parts) {
    const n = normalizeOrderCode(p);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    unique.push(n);
  }
  if (unique.length < 2) return [];

  const known = toKnownCodeSet(knownCodes);
  const allCodes = parts.every((p) => tokenIsOrderCode(p, known));
  return allCodes ? unique : [];
}

export function looksLikeOrderCodeList(
  text: string | null | undefined,
  knownCodes?: Iterable<string> | null,
): boolean {
  return parseOrderCodeList(text, knownCodes).length >= 2;
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

export interface OrderSearchItemFields {
  referenceCode?: string | null;
  referenceName?: string | null;
  color?: string | null;
}

export interface MatchesOrderSearchOptions {
  /** Códigos OP/PV já carregados — 3ª perna da heurística de lista. */
  knownCodes?: Iterable<string> | null;
  /**
   * Itens do PV (várias linhas). No modo ref/cor, ref E cor precisam casar
   * no **mesmo** item. Sem `items`, usa os campos de ref/cor de `fields`.
   */
  items?: OrderSearchItemFields[] | null;
}

export type ClassifiedOrderSearch =
  | { mode: 'empty' }
  | { mode: 'list'; codes: string[] }
  | { mode: 'refColor'; ref: string; color: string; rest: string[] }
  | { mode: 'free'; query: string };

/**
 * Classifica a query nos três modos. `knownCodes` só afeta o modo lista.
 */
export function classifyOrderSearch(
  query: string | null | undefined,
  knownCodes?: Iterable<string> | null,
): ClassifiedOrderSearch {
  const raw = String(query ?? '').trim();
  if (!raw) return { mode: 'empty' };

  const codes = parseOrderCodeList(raw, knownCodes);
  if (codes.length >= 2) return { mode: 'list', codes };

  // Atalho "/grupo" (Pedidos): não interpretar como ref/cor.
  if (raw.startsWith('/')) return { mode: 'free', query: raw };

  // Posicional só com ; ou / (vírgula/quebra ficam pra lista ou AND livre).
  if (/[;/]/.test(raw)) {
    const parts = raw
      .split(REF_COLOR_SPLIT)
      .map((t) => t.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return {
        mode: 'refColor',
        ref: parts[0],
        color: parts[1],
        rest: parts.slice(2),
      };
    }
  }

  return { mode: 'free', query: raw };
}

function itemMatchesRef(item: OrderSearchItemFields, refQuery: string): boolean {
  return (
    searchMatches(item.referenceCode, refQuery) ||
    searchMatches(item.referenceName, refQuery)
  );
}

function itemMatchesColor(item: OrderSearchItemFields, colorQuery: string): boolean {
  return searchMatches(item.color, colorQuery);
}

function resolveItems(
  fields: OrderSearchFields,
  items?: OrderSearchItemFields[] | null,
): OrderSearchItemFields[] {
  if (items && items.length > 0) return items;
  return [
    {
      referenceCode: fields.referenceCode,
      referenceName: fields.referenceName,
      color: fields.color,
    },
  ];
}

function orderLevelHaystacks(fields: OrderSearchFields): Array<string | null | undefined> {
  return [
    fields.orderNumber,
    fields.saleOrderNumber,
    fields.clientName,
    fields.clientOrderNumber,
    fields.referenceName,
    fields.referenceCode,
    fields.color,
  ];
}

/**
 * Filtra um item pela query: lista (OR exato), ref/cor posicional, ou texto livre.
 */
export function matchesOrderSearch(
  query: string | null | undefined,
  fields: OrderSearchFields,
  options?: MatchesOrderSearchOptions,
): boolean {
  const classified = classifyOrderSearch(query, options?.knownCodes);
  if (classified.mode === 'empty') return true;

  if (classified.mode === 'list') {
    return classified.codes.some((code) =>
      orderCodeExactMatch(code, fields.orderNumber, fields.saleOrderNumber),
    );
  }

  if (classified.mode === 'refColor') {
    const lineItems = resolveItems(fields, options?.items);
    const sameItem = lineItems.some(
      (item) =>
        itemMatchesRef(item, classified.ref) &&
        itemMatchesColor(item, classified.color),
    );
    if (!sameItem) return false;
    if (classified.rest.length === 0) return true;

    const restHaystacks: Array<string | null | undefined> = [
      ...orderLevelHaystacks(fields),
      ...lineItems.flatMap((item) => [
        item.referenceCode,
        item.referenceName,
        item.color,
      ]),
    ];
    return searchMatchesAllTerms(classified.rest.join(' '), ...restHaystacks);
  }

  return searchMatchesAllTerms(
    classified.query,
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

/** Coleta OP#/PV# normalizáveis a partir de uma lista — pra heurística Q8. */
export function collectKnownOrderCodes<T>(
  items: T[],
  getFields: (item: T) => Pick<OrderSearchFields, 'orderNumber' | 'saleOrderNumber'>,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    const f = getFields(item);
    if (f.orderNumber) out.push(String(f.orderNumber));
    if (f.saleOrderNumber) out.push(String(f.saleOrderNumber));
  }
  return out;
}

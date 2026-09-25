/**
 * Helpers puros do fluxo "Duplicar para lojas".
 * Mantidos fora do React pra travar contrato com testes sem montar Dialog.
 */

export interface DupStoreCandidate {
  id: string;
  active?: boolean | null;
  economic_group_id?: string | null;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  cnpj?: string | null;
}

/**
 * Sem grupo e sem busca → lista vazia (obrigatório buscar ou filtrar grupo).
 * Com grupo → todas as lojas ativas do grupo (exceto origem / já copiadas).
 * Sem grupo + busca → lojas ativas que casam a busca (exceto origem / já copiadas).
 */
export function filterDupStoreCandidates(args: {
  clients: DupStoreCandidate[];
  groupId: string | null | undefined;
  search: string;
  sourceClientId: string | null | undefined;
  alreadyCopiedClientIds: Set<string> | Iterable<string>;
  matchesSearch: (query: string, ...haystacks: Array<string | null | undefined>) => boolean;
}): DupStoreCandidate[] {
  const {
    clients,
    groupId,
    search,
    sourceClientId,
    alreadyCopiedClientIds,
    matchesSearch,
  } = args;
  const already = alreadyCopiedClientIds instanceof Set
    ? alreadyCopiedClientIds
    : new Set(alreadyCopiedClientIds);
  const trimmed = (search || '').trim();
  const hasGroup = !!(groupId && groupId.length > 0);

  if (!hasGroup && !trimmed) return [];

  return clients.filter((c) => {
    if (!c.active) return false;
    if (sourceClientId && c.id === sourceClientId) return false;
    if (already.has(c.id)) return false;
    if (hasGroup && c.economic_group_id !== groupId) return false;
    if (trimmed && !matchesSearch(trimmed, c.razao_social, c.nome_fantasia, c.cnpj)) {
      return false;
    }
    return true;
  });
}

/** Filtra itens do PV origem pelos IDs selecionados (ordem do origem preservada). */
export function pickDuplicateItems<T extends { id: string }>(
  orderItems: T[],
  selectedItemIds: Iterable<string>,
): T[] {
  const wanted = selectedItemIds instanceof Set
    ? selectedItemIds
    : new Set(selectedItemIds);
  if (wanted.size === 0) return [];
  return orderItems.filter((item) => wanted.has(item.id));
}

export function resolveSourceEconomicGroupId(args: {
  sourceClientId: string | null | undefined;
  clients: Array<{ id: string; economic_group_id?: string | null }>;
}): string {
  if (!args.sourceClientId) return '';
  const client = args.clients.find((c) => c.id === args.sourceClientId);
  return client?.economic_group_id || '';
}

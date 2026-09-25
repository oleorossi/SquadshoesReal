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

/** Lote de trabalho na sessão (não persiste). */
export interface DupBatch {
  id: string;
  label: string;
  economicGroupId: string;
  clientIds: string[];
  /** Vazio = nenhum item marcado (lote novo). */
  itemIds: string[];
}

export interface DupBatchValidationError {
  batchId: string;
  label: string;
  reason: 'sem_lojas' | 'sem_itens';
  message: string;
}

export interface DupJob {
  clientId: string;
  itemIds: string[];
  batchId: string;
  batchLabel: string;
}

export function batchLabelForIndex(index: number): string {
  return `Lote ${index + 1}`;
}

export function createEmptyBatch(args: {
  index: number;
  id?: string;
  economicGroupId?: string;
}): DupBatch {
  return {
    id: args.id || crypto.randomUUID(),
    label: batchLabelForIndex(args.index),
    economicGroupId: args.economicGroupId || '',
    clientIds: [],
    itemIds: [],
  };
}

/** Lojas já atribuídas a outros lotes (exceto `exceptBatchId`). */
export function storesTakenByOtherBatches(
  batches: DupBatch[],
  exceptBatchId: string | null | undefined,
): Set<string> {
  const taken = new Set<string>();
  for (const b of batches) {
    if (exceptBatchId && b.id === exceptBatchId) continue;
    for (const id of b.clientIds) taken.add(id);
  }
  return taken;
}

/**
 * Sem grupo e sem busca → lista vazia (obrigatório buscar ou filtrar grupo).
 * Com grupo → todas as lojas ativas do grupo (exceto origem / já copiadas / excluidas).
 * Sem grupo + busca → lojas ativas que casam a busca (exceto origem / já copiadas / excluidas).
 */
export function filterDupStoreCandidates(args: {
  clients: DupStoreCandidate[];
  groupId: string | null | undefined;
  search: string;
  sourceClientId: string | null | undefined;
  alreadyCopiedClientIds: Set<string> | Iterable<string>;
  /** Lojas em outros lotes (ou outras exclusões); somem da lista. */
  excludeClientIds?: Set<string> | Iterable<string>;
  matchesSearch: (query: string, ...haystacks: Array<string | null | undefined>) => boolean;
}): DupStoreCandidate[] {
  const {
    clients,
    groupId,
    search,
    sourceClientId,
    alreadyCopiedClientIds,
    excludeClientIds,
    matchesSearch,
  } = args;
  const already = alreadyCopiedClientIds instanceof Set
    ? alreadyCopiedClientIds
    : new Set(alreadyCopiedClientIds);
  const excluded = !excludeClientIds
    ? new Set<string>()
    : excludeClientIds instanceof Set
      ? excludeClientIds
      : new Set(excludeClientIds);
  const trimmed = (search || '').trim();
  const hasGroup = !!(groupId && groupId.length > 0);

  if (!hasGroup && !trimmed) return [];

  return clients.filter((c) => {
    if (!c.active) return false;
    if (sourceClientId && c.id === sourceClientId) return false;
    if (already.has(c.id)) return false;
    if (excluded.has(c.id)) return false;
    if (hasGroup && c.economic_group_id !== groupId) return false;
    if (trimmed && !matchesSearch(trimmed, c.razao_social, c.nome_fantasia, c.cnpj)) {
      return false;
    }
    return true;
  });
}

/** Filtra itens do PV origem pelos IDs selecionados (ordem da lista preservada). */
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

/**
 * Agrupa a mesma referência uma após a outra (código/nome), depois cor.
 * Espelha a ordenação do detalhe do PV em SaleOrders.
 */
export function sortDuplicateItemsByReference<T extends {
  reference_id: string;
  color?: string | null;
}>(
  items: T[],
  refById: Record<string, { code?: string | null; name?: string | null } | undefined>,
): T[] {
  return [...items].sort((a, b) => {
    const ra = refById[a.reference_id];
    const rb = refById[b.reference_id];
    const aKey = `${ra?.code || ''} ${ra?.name || ''}`.trim() || a.reference_id;
    const bKey = `${rb?.code || ''} ${rb?.name || ''}`.trim() || b.reference_id;
    const refCmp = aKey.localeCompare(bKey, 'pt-BR', { numeric: true });
    if (refCmp !== 0) return refCmp;
    return String(a.color || '').localeCompare(String(b.color || ''), 'pt-BR');
  });
}

export function resolveSourceEconomicGroupId(args: {
  sourceClientId: string | null | undefined;
  clients: Array<{ id: string; economic_group_id?: string | null }>;
}): string {
  if (!args.sourceClientId) return '';
  const client = args.clients.find((c) => c.id === args.sourceClientId);
  return client?.economic_group_id || '';
}

/** Bloqueia Duplicar tudo se algum lote tiver 0 lojas ou 0 itens. */
export function validateDupBatches(batches: DupBatch[]): DupBatchValidationError[] {
  const errors: DupBatchValidationError[] = [];
  for (const b of batches) {
    if (b.clientIds.length === 0) {
      errors.push({
        batchId: b.id,
        label: b.label,
        reason: 'sem_lojas',
        message: `${b.label}: sem lojas`,
      });
    }
    if (b.itemIds.length === 0) {
      errors.push({
        batchId: b.id,
        label: b.label,
        reason: 'sem_itens',
        message: `${b.label}: sem itens`,
      });
    }
  }
  return errors;
}

/** Expande lotes em jobs 1 loja = 1 PV (itemIds do lote). */
export function expandBatchesToJobs(batches: DupBatch[]): DupJob[] {
  const jobs: DupJob[] = [];
  for (const b of batches) {
    for (const clientId of b.clientIds) {
      jobs.push({
        clientId,
        itemIds: [...b.itemIds],
        batchId: b.id,
        batchLabel: b.label,
      });
    }
  }
  return jobs;
}

/** Remove clientIds bem-sucedidos dos lotes (falha parcial — dialog fica aberto). */
export function removeClientsFromBatches(
  batches: DupBatch[],
  clientIds: Iterable<string>,
): DupBatch[] {
  const drop = clientIds instanceof Set ? clientIds : new Set(clientIds);
  if (drop.size === 0) return batches;
  return batches.map((b) => ({
    ...b,
    clientIds: b.clientIds.filter((id) => !drop.has(id)),
  }));
}

export function countBatchStores(batches: DupBatch[]): number {
  return batches.reduce((n, b) => n + b.clientIds.length, 0);
}

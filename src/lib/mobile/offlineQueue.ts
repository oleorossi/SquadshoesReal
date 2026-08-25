/**
 * Fila offline do app móvel de vendas.
 *
 * Todo registro é isolado por `ownerId`. O navegador pode ser compartilhado por
 * vários vendedores; por isso nem fila, nem rascunho, nem catálogo usam uma
 * chave global. Os stores v3 têm chave composta materializada
 * (`ownerId:logicalKey`). Dados legados sem dono ficam numa quarentena privada:
 * nunca são listados, atribuídos ou sincronizados automaticamente.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { SaleOrderFormData, SaleOrderItemFormData } from '@/hooks/useSaleOrders';

const DB_NAME = 'squad-mobile-queue';
const DB_VERSION = 4;
const PENDING_STORE = 'pending-orders-v3';
const DRAFT_STORE = 'drafts-v3';
const CATALOG_STORE = 'catalog-cache-v3';
const LEGACY_QUARANTINE_STORE = 'legacy-ownerless-quarantine-v4';
const LEGACY_OWNERLESS_STORES = ['pending-orders', 'drafts', 'catalog-cache'] as const;
const MOBILE_ORDER_CATALOG_KEY = 'mobile-new-order';

export type QueueFailureKind = 'transient' | 'permanent';

/**
 * O writer mobile recebe sempre o mesmo cabeçalho, tanto na primeira tentativa
 * online quanto no replay. Alterar o status depois de um timeout mudaria o hash
 * idempotente do `client_request_id` e transformaria um retry seguro em replay
 * divergente. A confirmação é outro comando, executado somente após o recibo da
 * criação.
 */
export const MOBILE_SALE_ORDER_DRAFT_STATUS = 'Rascunho' as const;

export type MobileSaleOrderData = Omit<SaleOrderFormData, 'delivery_deadline'> & {
  client_request_id: string;
  delivery_deadline: string | null;
  total?: number;
  modalidade_frete?: string | null;
  transport_company_id?: string | null;
  client_signature_data_url?: string | null;
  client_signature_at?: string | null;
};

export interface PendingOrderPayload {
  ownerId: string;
  order: MobileSaleOrderData;
  items: SaleOrderItemFormData[];
  client_id?: string | null;
  representative_id?: string | null;
}

export interface QueuedOrder {
  storage_key: string;
  ownerId: string;
  client_request_id: string;
  payload: PendingOrderPayload;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number | null;
  failureKind: QueueFailureKind | null;
  /** Snapshot rico do editor (nomes, imagens, origem de preço). Nunca é usado
   * pelo writer; existe somente para a correção local de uma falha permanente. */
  draftSnapshot?: unknown;
}

export interface DraftPayload<T = unknown> {
  storage_key: string;
  ownerId: string;
  client_request_id: string;
  data: T;
  updatedAt: number;
}

interface CatalogCachePayload<T = unknown> {
  storage_key: string;
  ownerId: string;
  key: string;
  data: T;
  updatedAt: number;
}

interface LegacyQuarantineRecord {
  id: string;
  sourceStore: typeof LEGACY_OWNERLESS_STORES[number];
  legacyKey: string;
  quarantinedAt: number;
  raw: unknown;
}

export interface LegacyQuarantineSummary {
  total: number;
  pendingOrders: number;
  drafts: number;
  catalogEntries: number;
}

export function canRepairPermanentQueuedOrder(
  queued: Pick<QueuedOrder, 'ownerId' | 'payload' | 'failureKind'>,
  ownerId: string,
): boolean {
  const owner = ownerId?.trim();
  return Boolean(
    owner
    && queued.ownerId === owner
    && queued.payload?.ownerId === owner
    && queued.failureKind === 'permanent',
  );
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function requireOwnerId(ownerId: string): string {
  const normalized = ownerId?.trim();
  if (!normalized) throw new Error('ownerId é obrigatório para acessar dados offline.');
  return normalized;
}

export function mobileOwnerStorageKey(ownerId: string, logicalKey: string): string {
  return `${requireOwnerId(ownerId)}:${logicalKey}`;
}

export function mobileCurrentDraftKey(ownerId: string): string {
  return `mobile-current-draft-id:${requireOwnerId(ownerId)}`;
}

export function legacyQuarantineRecordId(sourceStore: string, legacyKey: unknown): string {
  return `${sourceStore}:${String(legacyKey)}`;
}

const notifyPendingOrdersChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('squad:pending-orders-changed'));
  }
};

const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains(PENDING_STORE)) {
          const store = db.createObjectStore(PENDING_STORE, { keyPath: 'storage_key' });
          store.createIndex('ownerId', 'ownerId');
        }
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          const store = db.createObjectStore(DRAFT_STORE, { keyPath: 'storage_key' });
          store.createIndex('ownerId', 'ownerId');
        }
        if (!db.objectStoreNames.contains(CATALOG_STORE)) {
          const store = db.createObjectStore(CATALOG_STORE, { keyPath: 'storage_key' });
          store.createIndex('ownerId', 'ownerId');
        }
        if (!db.objectStoreNames.contains(LEGACY_QUARANTINE_STORE)) {
          const store = db.createObjectStore(LEGACY_QUARANTINE_STORE, { keyPath: 'id' });
          store.createIndex('sourceStore', 'sourceStore');
        }

        // A migração acontece na própria versionchange transaction: ou todos os
        // registros ownerless entram na quarentena e as origens são limpas, ou
        // nada muda. O raw nunca sai pelas APIs públicas abaixo.
        const quarantine = transaction.objectStore(LEGACY_QUARANTINE_STORE);
        const quarantinedAt = Date.now();
        for (const sourceStore of LEGACY_OWNERLESS_STORES) {
          if (!db.objectStoreNames.contains(sourceStore)) continue;
          const source = transaction.objectStore(sourceStore);
          const valuesRequest = source.getAll();
          const keysRequest = source.getAllKeys();
          void Promise.all([valuesRequest, keysRequest]).then(([values, keys]) => {
            values.forEach((raw, index) => {
              const legacyKey = keys[index];
              quarantine.put({
                id: legacyQuarantineRecordId(sourceStore, legacyKey),
                sourceStore,
                legacyKey: String(legacyKey),
                quarantinedAt,
                raw,
              } satisfies LegacyQuarantineRecord);
            });
            source.clear();
          });
        }
      },
    });
  }
  return dbPromise;
};

// ── Pending Orders ──────────────────────────────────────────────────────────

export const enqueueOrder = async <TDraft = unknown>(
  ownerId: string,
  payload: PendingOrderPayload,
  draftSnapshot?: TDraft,
): Promise<void> => {
  const owner = requireOwnerId(ownerId);
  if (payload.ownerId !== owner) throw new Error('O pedido offline pertence a outro usuário.');
  if (payload.order.status !== MOBILE_SALE_ORDER_DRAFT_STATUS) {
    throw new Error('A fila mobile aceita somente pedidos em Rascunho.');
  }
  const db = await getDb();
  const queued: QueuedOrder = {
    storage_key: mobileOwnerStorageKey(owner, payload.order.client_request_id),
    ownerId: owner,
    client_request_id: payload.order.client_request_id,
    payload,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    failureKind: null,
    draftSnapshot,
  };
  const tx = db.transaction([PENDING_STORE, DRAFT_STORE], 'readwrite');
  await tx.objectStore(PENDING_STORE).put(queued);
  if (draftSnapshot !== undefined) {
    await tx.objectStore(DRAFT_STORE).put({
      storage_key: mobileOwnerStorageKey(owner, payload.order.client_request_id),
      ownerId: owner,
      client_request_id: payload.order.client_request_id,
      data: draftSnapshot,
      updatedAt: Date.now(),
    } satisfies DraftPayload<TDraft>);
  }
  await tx.done;
  notifyPendingOrdersChanged();
};

export const listPendingOrders = async (ownerId: string): Promise<QueuedOrder[]> => {
  const owner = requireOwnerId(ownerId);
  const db = await getDb();
  const all = await db.getAllFromIndex(PENDING_STORE, 'ownerId', owner) as QueuedOrder[];
  return all
    .filter((entry) => entry.ownerId === owner && entry.payload?.ownerId === owner)
    .sort((a, b) => a.createdAt - b.createdAt);
};

export const removeFromQueue = async (ownerId: string, clientRequestId: string): Promise<void> => {
  const owner = requireOwnerId(ownerId);
  const key = mobileOwnerStorageKey(owner, clientRequestId);
  const db = await getDb();
  const tx = db.transaction([PENDING_STORE, DRAFT_STORE], 'readwrite');
  await Promise.all([
    tx.objectStore(PENDING_STORE).delete(key),
    tx.objectStore(DRAFT_STORE).delete(key),
  ]);
  await tx.done;
  notifyPendingOrdersChanged();
};

/** CREATE confirmado pelo servidor: fila e snapshot editável deixam de ser
 * necessários e somem no mesmo commit local. */
export const completeQueuedOrderCreate = async (
  ownerId: string,
  clientRequestId: string,
): Promise<void> => {
  const owner = requireOwnerId(ownerId);
  const key = mobileOwnerStorageKey(owner, clientRequestId);
  const db = await getDb();
  const tx = db.transaction([PENDING_STORE, DRAFT_STORE], 'readwrite');
  await Promise.all([
    tx.objectStore(PENDING_STORE).delete(key),
    tx.objectStore(DRAFT_STORE).delete(key),
  ]);
  await tx.done;
  notifyPendingOrdersChanged();
};

function fallbackEditableDraft(queued: QueuedOrder): Record<string, unknown> {
  const order = queued.payload.order;
  return {
    client: queued.payload.client_id || order.client_id
      ? {
        id: queued.payload.client_id || order.client_id,
        razao_social: order.client_name,
        cnpj: order.client_cnpj || null,
      }
      : null,
    items: queued.payload.items.map((item) => ({
      ...item,
      reference_name: item.reference_id || 'Referência',
    })),
    billingDate: order.delivery_deadline || '',
  };
}

/**
 * Converte uma falha PERMANENTE em uma nova intenção editável. A fila antiga,
 * o draft antigo e o draft com UUID novo pertencem à mesma transaction; crash
 * nenhum pode deixar duas intenções ativas ou apagar o único snapshot.
 */
export const repairPermanentQueuedOrder = async (
  ownerId: string,
  oldClientRequestId: string,
  newClientRequestId: string,
): Promise<{ clientRequestId: string }> => {
  const owner = requireOwnerId(ownerId);
  const oldId = oldClientRequestId?.trim();
  const newId = newClientRequestId?.trim();
  if (!oldId || !newId || oldId === newId) {
    throw new Error('A correção exige um novo client_request_id.');
  }
  const oldKey = mobileOwnerStorageKey(owner, oldId);
  const newKey = mobileOwnerStorageKey(owner, newId);
  const db = await getDb();
  const tx = db.transaction([PENDING_STORE, DRAFT_STORE], 'readwrite');
  try {
    const pendingStore = tx.objectStore(PENDING_STORE);
    const draftStore = tx.objectStore(DRAFT_STORE);
    const queued = await pendingStore.get(oldKey) as QueuedOrder | undefined;
    if (!queued || queued.ownerId !== owner || queued.payload?.ownerId !== owner) {
      throw new Error('Pedido pendente não pertence ao usuário atual.');
    }
    if (!canRepairPermanentQueuedOrder(queued, owner)) {
      throw new Error('Somente uma falha permanente pode ser aberta para correção.');
    }
    if (await draftStore.get(newKey)) {
      throw new Error('Já existe um rascunho com o novo identificador.');
    }
    const oldDraft = await draftStore.get(oldKey) as DraftPayload | undefined;
    const snapshot = queued.draftSnapshot ?? oldDraft?.data ?? fallbackEditableDraft(queued);
    await draftStore.put({
      storage_key: newKey,
      ownerId: owner,
      client_request_id: newId,
      data: snapshot,
      updatedAt: Date.now(),
    } satisfies DraftPayload);
    await pendingStore.delete(oldKey);
    await draftStore.delete(oldKey);
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* transaction já pode ter encerrado */ }
    throw error;
  }
  notifyPendingOrdersChanged();
  return { clientRequestId: newId };
};

export const markAttemptFailed = async (
  ownerId: string,
  clientRequestId: string,
  error: string,
  failureKind: QueueFailureKind,
): Promise<void> => {
  const owner = requireOwnerId(ownerId);
  const db = await getDb();
  const key = mobileOwnerStorageKey(owner, clientRequestId);
  const existing = await db.get(PENDING_STORE, key) as QueuedOrder | undefined;
  if (!existing || existing.ownerId !== owner || existing.payload?.ownerId !== owner) return;
  await db.put(PENDING_STORE, {
    ...existing,
    attempts: existing.attempts + 1,
    lastError: error.slice(0, 500),
    lastAttemptAt: Date.now(),
    failureKind,
  });
  notifyPendingOrdersChanged();
};

export const countPendingOrders = async (ownerId: string): Promise<number> =>
  (await listPendingOrders(ownerId)).length;

// ── Quarentena ownerless v1/v2 ─────────────────────────────────────────────

export const getLegacyQuarantineSummary = async (): Promise<LegacyQuarantineSummary> => {
  const db = await getDb();
  // Conta pelo índice, sem materializar `raw` na camada da aplicação/UI.
  const [total, pendingOrders, drafts, catalogEntries] = await Promise.all([
    db.count(LEGACY_QUARANTINE_STORE),
    db.countFromIndex(LEGACY_QUARANTINE_STORE, 'sourceStore', 'pending-orders'),
    db.countFromIndex(LEGACY_QUARANTINE_STORE, 'sourceStore', 'drafts'),
    db.countFromIndex(LEGACY_QUARANTINE_STORE, 'sourceStore', 'catalog-cache'),
  ]);
  return {
    total,
    pendingOrders,
    drafts,
    catalogEntries,
  };
};

export const clearLegacyQuarantine = async (): Promise<void> => {
  const db = await getDb();
  await db.clear(LEGACY_QUARANTINE_STORE);
  notifyPendingOrdersChanged();
};

// ── Drafts ─────────────────────────────────────────────────────────────────

export const saveDraft = async <T>(ownerId: string, clientRequestId: string, data: T): Promise<void> => {
  const owner = requireOwnerId(ownerId);
  const db = await getDb();
  const draft: DraftPayload<T> = {
    storage_key: mobileOwnerStorageKey(owner, clientRequestId),
    ownerId: owner,
    client_request_id: clientRequestId,
    data,
    updatedAt: Date.now(),
  };
  await db.put(DRAFT_STORE, draft);
};

export const loadDraft = async <T>(ownerId: string, clientRequestId: string): Promise<T | null> => {
  const owner = requireOwnerId(ownerId);
  const db = await getDb();
  const draft = await db.get(
    DRAFT_STORE,
    mobileOwnerStorageKey(owner, clientRequestId),
  ) as DraftPayload<T> | undefined;
  if (!draft || draft.ownerId !== owner) return null;
  return draft.data;
};

export const listDrafts = async (ownerId: string): Promise<DraftPayload[]> => {
  const owner = requireOwnerId(ownerId);
  const db = await getDb();
  const drafts = await db.getAllFromIndex(DRAFT_STORE, 'ownerId', owner) as DraftPayload[];
  return drafts.filter((entry) => entry.ownerId === owner);
};

export const deleteDraft = async (ownerId: string, clientRequestId: string): Promise<void> => {
  const owner = requireOwnerId(ownerId);
  const db = await getDb();
  await db.delete(DRAFT_STORE, mobileOwnerStorageKey(owner, clientRequestId));
};

// ── Catálogo do novo PV ────────────────────────────────────────────────────

export const saveMobileOrderCatalog = async <T>(ownerId: string, data: T): Promise<void> => {
  const owner = requireOwnerId(ownerId);
  const db = await getDb();
  const cached: CatalogCachePayload<T> = {
    storage_key: mobileOwnerStorageKey(owner, MOBILE_ORDER_CATALOG_KEY),
    ownerId: owner,
    key: MOBILE_ORDER_CATALOG_KEY,
    data,
    updatedAt: Date.now(),
  };
  await db.put(CATALOG_STORE, cached);
};

export const loadMobileOrderCatalog = async <T>(ownerId: string): Promise<T | null> => {
  const owner = requireOwnerId(ownerId);
  const db = await getDb();
  const cached = await db.get(
    CATALOG_STORE,
    mobileOwnerStorageKey(owner, MOBILE_ORDER_CATALOG_KEY),
  ) as CatalogCachePayload<T> | undefined;
  if (!cached || cached.ownerId !== owner) return null;
  return cached.data;
};

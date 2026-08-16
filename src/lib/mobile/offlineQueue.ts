/**
 * Offline mutation queue (IndexedDB) pro app mobile de vendas.
 *
 * Cenário: vendedor está em loja sem internet, cria PV, app salva na queue;
 * quando rede volta, processa em ordem FIFO. Cada pedido tem `client_request_id`
 * UUID — servidor dedup via UNIQUE index (mig 20260629260000).
 *
 * Schema:
 *   db: squad-mobile-queue
 *   store: pending-orders
 *     key: client_request_id (uuid)
 *     value: { request, createdAt, attempts, lastError }
 *
 * Outros stores reservados pra expansão futura:
 *   - drafts: rascunhos de PVs em edição (não enviados)
 *   - catalog-cache: referências, variantes de material e cores estruturais
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { SaleOrderFormData, SaleOrderItemFormData } from '@/hooks/useSaleOrders';

const DB_NAME = 'squad-mobile-queue';
const DB_VERSION = 2;
const MOBILE_ORDER_CATALOG_KEY = 'mobile-new-order';

export interface PendingOrderPayload {
  order: SaleOrderFormData & { client_request_id: string };
  items: SaleOrderItemFormData[];
  client_id?: string | null;
  representative_id?: string | null;
}

export interface QueuedOrder {
  client_request_id: string;
  payload: PendingOrderPayload;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number | null;
}

interface DraftPayload {
  client_request_id: string;
  data: any;
  updatedAt: number;
}

interface CatalogCachePayload<T = unknown> {
  key: string;
  data: T;
  updatedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

/** Atualiza badges da UI móvel sem precisar consultar o IndexedDB em polling. */
const notifyPendingOrdersChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('squad:pending-orders-changed'));
  }
};

const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('pending-orders')) {
          const store = db.createObjectStore('pending-orders', { keyPath: 'client_request_id' });
          store.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'client_request_id' });
        }
        if (!db.objectStoreNames.contains('catalog-cache')) {
          db.createObjectStore('catalog-cache', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
};

// ── Pending Orders ──────────────────────────────────────────────────────────

export const enqueueOrder = async (payload: PendingOrderPayload): Promise<void> => {
  const db = await getDb();
  const queued: QueuedOrder = {
    client_request_id: payload.order.client_request_id,
    payload,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  };
  await db.put('pending-orders', queued);
  notifyPendingOrdersChanged();
};

export const listPendingOrders = async (): Promise<QueuedOrder[]> => {
  const db = await getDb();
  const all = await db.getAllFromIndex('pending-orders', 'createdAt');
  return all;
};

export const removeFromQueue = async (client_request_id: string): Promise<void> => {
  const db = await getDb();
  await db.delete('pending-orders', client_request_id);
  notifyPendingOrdersChanged();
};

export const markAttemptFailed = async (
  client_request_id: string,
  error: string,
): Promise<void> => {
  const db = await getDb();
  const existing = (await db.get('pending-orders', client_request_id)) as QueuedOrder | undefined;
  if (!existing) return;
  await db.put('pending-orders', {
    ...existing,
    attempts: existing.attempts + 1,
    lastError: error.slice(0, 500),
    lastAttemptAt: Date.now(),
  });
  notifyPendingOrdersChanged();
};

export const countPendingOrders = async (): Promise<number> => {
  const db = await getDb();
  return db.count('pending-orders');
};

// ── Drafts ─────────────────────────────────────────────────────────────────

export const saveDraft = async (client_request_id: string, data: any): Promise<void> => {
  const db = await getDb();
  const draft: DraftPayload = { client_request_id, data, updatedAt: Date.now() };
  await db.put('drafts', draft);
};

export const loadDraft = async (client_request_id: string): Promise<any | null> => {
  const db = await getDb();
  const d = (await db.get('drafts', client_request_id)) as DraftPayload | undefined;
  return d?.data ?? null;
};

export const listDrafts = async (): Promise<DraftPayload[]> => {
  const db = await getDb();
  return (await db.getAll('drafts')) as DraftPayload[];
};

export const deleteDraft = async (client_request_id: string): Promise<void> => {
  const db = await getDb();
  await db.delete('drafts', client_request_id);
};

// ── Catálogo do novo PV ────────────────────────────────────────────────────

/** Mantém a identidade material→grupo→cor disponível mesmo sem rede. */
export const saveMobileOrderCatalog = async <T>(data: T): Promise<void> => {
  const db = await getDb();
  const cached: CatalogCachePayload<T> = {
    key: MOBILE_ORDER_CATALOG_KEY,
    data,
    updatedAt: Date.now(),
  };
  await db.put('catalog-cache', cached);
};

export const loadMobileOrderCatalog = async <T>(): Promise<T | null> => {
  const db = await getDb();
  const cached = await db.get('catalog-cache', MOBILE_ORDER_CATALOG_KEY) as CatalogCachePayload<T> | undefined;
  return cached?.data ?? null;
};

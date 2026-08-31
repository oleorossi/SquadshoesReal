import type { Query, QueryClient } from '@tanstack/react-query';
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'squad-query-cache';
const STORE = 'cache';
const RECORD_KEY = 'dehydrated';
/** Bump pra descartar cache persistido depois de um breaking change de shape. */
export const QUERY_CACHE_BUSTER = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRY_BYTES = 1_500_000;
const MAX_TOTAL_BYTES = 6_000_000;

type PersistedEntry = {
  queryKey: unknown[];
  data: unknown;
  dataUpdatedAt: number;
};

type PersistedBlob = {
  buster: number;
  savedAt: number;
  entries: PersistedEntry[];
};

const SKIP_KEY_PREFIXES = ['global-search-'];

export function shouldPersistQueryKey(queryKey: unknown): boolean {
  const head = Array.isArray(queryKey) ? queryKey[0] : queryKey;
  if (typeof head !== 'string') return false;
  return !SKIP_KEY_PREFIXES.some((p) => head.startsWith(p));
}

export function dehydrateSuccessfulQueries(
  queries: Array<Pick<Query, 'queryKey' | 'state'>>,
  now = Date.now(),
): PersistedEntry[] {
  const entries: PersistedEntry[] = [];
  let total = 0;
  for (const q of queries) {
    if (q.state.status !== 'success') continue;
    if (q.state.data === undefined) continue;
    if (!shouldPersistQueryKey(q.queryKey)) continue;
    if (now - q.state.dataUpdatedAt > MAX_AGE_MS) continue;
    const entry: PersistedEntry = {
      queryKey: q.queryKey as unknown[],
      data: q.state.data,
      dataUpdatedAt: q.state.dataUpdatedAt,
    };
    let size = 0;
    try {
      size = JSON.stringify(entry).length;
    } catch {
      continue;
    }
    if (size > MAX_ENTRY_BYTES) continue;
    if (total + size > MAX_TOTAL_BYTES) break;
    entries.push(entry);
    total += size;
  }
  return entries;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
function getDb() {
  if (typeof indexedDB === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

let boundClient: QueryClient | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

async function writeBlob(blob: PersistedBlob) {
  const db = getDb();
  if (!db) return;
  await (await db).put(STORE, blob, RECORD_KEY);
}

async function readBlob(): Promise<PersistedBlob | null> {
  const db = getDb();
  if (!db) return null;
  const blob = await (await db).get(STORE, RECORD_KEY);
  if (!blob || typeof blob !== 'object') return null;
  return blob as PersistedBlob;
}

export async function clearQueryPersistence() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  boundClient?.clear();
  try {
    const db = getDb();
    if (db) await (await db).delete(STORE, RECORD_KEY);
  } catch {
    /* quota / private mode */
  }
}

function scheduleSave(qc: QueryClient) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const entries = dehydrateSuccessfulQueries(qc.getQueryCache().getAll());
    void writeBlob({
      buster: QUERY_CACHE_BUSTER,
      savedAt: Date.now(),
      entries,
    }).catch(() => {});
  }, 1200);
}

export function installQueryPersistence(qc: QueryClient) {
  boundClient = qc;
  unsubscribe?.();
  void (async () => {
    try {
      const blob = await readBlob();
      if (!blob || blob.buster !== QUERY_CACHE_BUSTER) return;
      if (Date.now() - blob.savedAt > MAX_AGE_MS) return;
      const now = Date.now();
      for (const entry of blob.entries) {
        if (now - entry.dataUpdatedAt > MAX_AGE_MS) continue;
        if (!shouldPersistQueryKey(entry.queryKey)) continue;
        const existing = qc.getQueryState(entry.queryKey);
        if (existing?.dataUpdatedAt && existing.dataUpdatedAt >= entry.dataUpdatedAt) continue;
        qc.setQueryData(entry.queryKey, entry.data, {
          updatedAt: entry.dataUpdatedAt,
        });
      }
    } catch {
      /* ignore corrupt cache */
    }
  })();
  unsubscribe = qc.getQueryCache().subscribe(() => scheduleSave(qc));
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeIndexedDb = vi.hoisted(() => {
  type StoredRecord = {
    storage_key?: IDBValidKey;
    id?: IDBValidKey;
    ownerId?: string;
    sourceStore?: string;
    [key: string]: unknown;
  };
  const storeNames = [
    'pending-orders-v3',
    'drafts-v3',
    'catalog-cache-v3',
    'legacy-ownerless-quarantine-v4',
  ];
  const stores = new Map<string, Map<IDBValidKey, StoredRecord>>(
    storeNames.map((name) => [name, new Map()]),
  );

  const keyFor = (value: StoredRecord): IDBValidKey => {
    const key = value.storage_key ?? value.id;
    if (key === undefined) throw new Error('registro sem chave');
    return key;
  };
  const apiFor = (data: Map<IDBValidKey, StoredRecord>) => ({
    get: async (key: IDBValidKey) => data.get(key),
    getAll: async () => [...data.values()],
    getAllKeys: async () => [...data.keys()],
    put: async (value: StoredRecord) => { data.set(keyFor(value), value); },
    delete: async (key: IDBValidKey) => { data.delete(key); },
    clear: async () => { data.clear(); },
    createIndex: vi.fn(),
  });

  const db = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore: (name: string) => {
      const data = new Map<IDBValidKey, StoredRecord>();
      stores.set(name, data);
      return apiFor(data);
    },
    transaction: (names: string | string[]) => {
      const scopedNames = Array.isArray(names) ? names : [names];
      const working = new Map(
        scopedNames.map((name) => [name, new Map(stores.get(name) || [])]),
      );
      let aborted = false;
      return {
        objectStore: (name: string) => apiFor(working.get(name)!),
        abort: () => { aborted = true; },
        done: {
          then: (resolve: (value?: unknown) => void, reject: (reason?: unknown) => void) => {
            if (aborted) {
              reject(new Error('transaction_aborted'));
              return;
            }
            for (const name of scopedNames) stores.set(name, new Map(working.get(name)!));
            resolve(undefined);
          },
        },
      };
    },
    get: async (store: string, key: IDBValidKey) => stores.get(store)?.get(key),
    put: async (store: string, value: StoredRecord) => { stores.get(store)!.set(keyFor(value), value); },
    delete: async (store: string, key: IDBValidKey) => { stores.get(store)!.delete(key); },
    clear: async (store: string) => { stores.get(store)!.clear(); },
    getAll: async (store: string) => [...stores.get(store)!.values()],
    count: async (store: string) => stores.get(store)!.size,
    countFromIndex: async (store: string, _index: string, sourceStore: string) =>
      [...stores.get(store)!.values()].filter((value) => value.sourceStore === sourceStore).length,
    getAllFromIndex: async (store: string, _index: string, ownerId: string) =>
      [...stores.get(store)!.values()].filter((value) => value.ownerId === ownerId),
  };

  return {
    openDB: vi.fn(async () => db),
    reset: () => { for (const store of stores.values()) store.clear(); },
    seed: (store: string, values: StoredRecord[]) => {
      for (const value of values) stores.get(store)!.set(keyFor(value), value);
    },
  };
});

vi.mock('idb', () => ({ openDB: fakeIndexedDb.openDB }));

import {
  canRepairPermanentQueuedOrder,
  clearLegacyQuarantine,
  enqueueOrder,
  getLegacyQuarantineSummary,
  listPendingOrders,
  loadDraft,
  markAttemptFailed,
  repairPermanentQueuedOrder,
  saveDraft,
  type PendingOrderPayload,
} from '../offlineQueue';

function payload(ownerId: string, requestId: string): PendingOrderPayload {
  return {
    ownerId,
    order: {
      client_request_id: requestId,
      client_id: `client-${ownerId}`,
      client_name: `Cliente ${ownerId}`,
      client_cnpj: '',
      client_contact: '',
      client_order_number: '',
      representative: '',
      payment_condition: '30/60',
      delivery_deadline: null,
      delivery_week: '',
      delivery_month: '',
      notes: '',
      status: 'Rascunho',
      nfe: '',
      remessa: '',
      is_factoring: false,
      factoring_config_id: null,
      modalidade_frete: null,
      transport_company_id: null,
      packaging_mode: 'colmeia',
    },
    items: [],
    client_id: `client-${ownerId}`,
  };
}

describe('fila offline owner-scoped e correção atômica', () => {
  beforeEach(() => {
    fakeIndexedDb.reset();
    vi.clearAllMocks();
  });

  it('não lista nem permite corrigir a intenção de outro owner', async () => {
    await enqueueOrder('owner-a', payload('owner-a', 'request-a'), { client: { id: 'client-a' } });
    await enqueueOrder('owner-b', payload('owner-b', 'request-b'), { client: { id: 'client-b' } });

    const ownerA = await listPendingOrders('owner-a');
    const ownerB = await listPendingOrders('owner-b');
    expect(ownerA.map((entry) => entry.client_request_id)).toEqual(['request-a']);
    expect(ownerB.map((entry) => entry.client_request_id)).toEqual(['request-b']);
    expect(canRepairPermanentQueuedOrder(ownerA[0], 'owner-b')).toBe(false);
    await expect(repairPermanentQueuedOrder('owner-b', 'request-a', 'request-new'))
      .rejects.toThrow('não pertence');
    expect(await listPendingOrders('owner-a')).toHaveLength(1);
  });

  it('troca a falha permanente por um draft com UUID novo no mesmo commit', async () => {
    const snapshot = {
      client: { id: 'client-owner-a', razao_social: 'Cliente A' },
      items: [{ reference_id: 'ref-1', reference_name: 'BT01', color: 'PRETO' }],
      billingDate: '2026-09-07',
    };
    await enqueueOrder('owner-a', payload('owner-a', 'request-old'), snapshot);
    await markAttemptFailed('owner-a', 'request-old', 'Condição comercial inválida', 'permanent');

    await expect(repairPermanentQueuedOrder('owner-a', 'request-old', 'request-new'))
      .resolves.toEqual({ clientRequestId: 'request-new' });

    expect(await listPendingOrders('owner-a')).toEqual([]);
    expect(await loadDraft('owner-a', 'request-old')).toBeNull();
    expect(await loadDraft('owner-a', 'request-new')).toEqual(snapshot);
  });

  it('faz rollback integral se o draft novo já existir e recusa falha transitória', async () => {
    const original = { client: { id: 'client-a' }, items: [{ reference_name: 'Original' }] };
    await enqueueOrder('owner-a', payload('owner-a', 'request-old'), original);
    await markAttemptFailed('owner-a', 'request-old', 'Falha de rede', 'transient');

    await expect(repairPermanentQueuedOrder('owner-a', 'request-old', 'request-new'))
      .rejects.toThrow('Somente uma falha permanente');
    expect(await listPendingOrders('owner-a')).toHaveLength(1);
    expect(await loadDraft('owner-a', 'request-old')).toEqual(original);

    await markAttemptFailed('owner-a', 'request-old', 'Cliente bloqueado', 'permanent');
    await saveDraft('owner-a', 'request-new', { sentinel: 'não sobrescrever' });
    await expect(repairPermanentQueuedOrder('owner-a', 'request-old', 'request-new'))
      .rejects.toThrow('Já existe um rascunho');
    expect(await listPendingOrders('owner-a')).toHaveLength(1);
    expect(await loadDraft('owner-a', 'request-old')).toEqual(original);
    expect(await loadDraft('owner-a', 'request-new')).toEqual({ sentinel: 'não sobrescrever' });
  });

  it('expõe somente contagens da quarentena ownerless e permite apagá-la', async () => {
    fakeIndexedDb.seed('legacy-ownerless-quarantine-v4', [{
      id: 'pending-orders:legacy-1',
      sourceStore: 'pending-orders',
      raw: { client_name: 'SEGREDO DE OUTRO DONO' },
    }, {
      id: 'drafts:legacy-2',
      sourceStore: 'drafts',
      raw: { notes: 'NÃO EXPOR' },
    }, {
      id: 'catalog-cache:legacy-3',
      sourceStore: 'catalog-cache',
      raw: { products: ['privado'] },
    }]);

    const summary = await getLegacyQuarantineSummary();
    expect(summary).toEqual({ total: 3, pendingOrders: 1, drafts: 1, catalogEntries: 1 });
    expect(summary).not.toHaveProperty('raw');
    expect(await listPendingOrders('owner-a')).toEqual([]);

    await clearLegacyQuarantine();
    expect(await getLegacyQuarantineSummary()).toEqual({
      total: 0,
      pendingOrders: 0,
      drafts: 0,
      catalogEntries: 0,
    });
  });
});

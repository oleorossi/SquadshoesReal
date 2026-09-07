import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PendingOrderPayload } from '../offlineQueue';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

const DATABASE_NAME = 'squad-mobile-queue';
const LINE_ID = '11111111-1111-4111-8111-111111111111';
const TYPE_ID = '22222222-2222-4222-8222-222222222222';
const MEASURE_ID = '33333333-3333-4333-8333-333333333333';
const GROUP_ID = '44444444-4444-4444-8444-444444444444';
const COLOR_ID = '55555555-5555-4555-8555-555555555555';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Banco ${name} bloqueado durante o teste.`));
  });
}

function manifest(hash: string) {
  return {
    version: 2 as const,
    generated_at: '2026-09-05T12:00:00.000Z',
    manifest_hash: hash,
    references: [{
      reference_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      material_variant_id: null,
      lines: [{
        technical_strap_line_id: LINE_ID,
        position: 1,
        label: 'Tira 1',
        identity_basis: 'reference_base' as const,
        identity_group_id: null,
        strap_type_id: TYPE_ID,
        measure_id: MEASURE_ID,
        color_mode: 'select_on_order' as const,
        material_mode: 'follow_reference' as const,
        material_group_id: null,
        allowed_material_group_ids: [],
        internal_production_enabled: true,
        group_id: null,
        group_name: null,
        consumption: 28,
        consumption_per_size: null,
        base_group_id: GROUP_ID,
        base_group_name: 'NAPA SOFT',
        material_options: [{
          base_group_id: GROUP_ID,
          base_group_name: 'NAPA SOFT',
          allowed_colors: [{ id: COLOR_ID, name: 'CHAMPAGNE' }],
        }],
        allowed_colors: [{ id: COLOR_ID, name: 'CHAMPAGNE' }],
      }],
    }],
  };
}

describe('manifesto offline de tiras no IndexedDB simulado', () => {
  beforeAll(async () => {
    await deleteDatabase(DATABASE_NAME);
  });

  it('persiste entre reloads, isola owners e rejeita schema de cache incompatível', async () => {
    const firstLoad = await import('../strapOfflineManifest');
    const firstQueue = await import('../offlineQueue');

    const noisyServerManifest = {
      ...manifest('hash-owner-a'),
      purchase_price: 999,
      references: manifest('hash-owner-a').references.map((reference) => ({
        ...reference,
        lines: reference.lines.map((line) => ({
          ...line,
          finished_available_m: 321,
          internal_unit_cost: 7.5,
        })),
      })),
    };
    await firstLoad.saveMobileStrapOfflineManifest('owner-a', noisyServerManifest);
    await firstLoad.saveMobileStrapOfflineManifest('owner-b', manifest('hash-owner-b'));
    await firstQueue.saveMobileCatalogEntry(
      'owner-old',
      firstLoad.MOBILE_STRAP_OFFLINE_CACHE_KEY,
      { cache_schema_version: 999, manifest: manifest('schema-antigo') },
    );
    const queuedPayload: PendingOrderPayload = {
      ownerId: 'owner-a',
      order: {
        client_request_id: 'request-immutable',
        client_id: 'client-a',
        client_name: 'Cliente A',
        client_cnpj: '',
        client_contact: '',
        client_order_number: '',
        representative: '',
        payment_condition: '30/60',
        delivery_deadline: null,
        delivery_week: '',
        delivery_month: '',
        notes: '',
        status: 'Rascunho' as const,
        nfe: '',
        remessa: '',
        is_factoring: false,
        factoring_config_id: null,
        modalidade_frete: null,
        transport_company_id: null,
        packaging_mode: 'colmeia',
      },
      items: [{
        reference_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        color: 'OFF WHITE',
        quantity: 1,
        grade: { '37': 1 },
        unit_price: 100,
        observation: '',
        strap_colors: [{
          id: LINE_ID,
          technical_strap_line_id: LINE_ID,
          label: 'Tira 1',
          color_mode: 'select_on_order',
          color: 'CHAMPAGNE',
          color_id: COLOR_ID,
          material_mode: 'select_on_order',
          allowed_material_group_ids: [GROUP_ID],
          base_group_id: GROUP_ID,
          base_group_name: 'NAPA SOFT',
        }],
      }],
    };
    await firstQueue.enqueueOrder('owner-a', queuedPayload, { editor: 'snapshot' });
    queuedPayload.items[0].strap_colors[0].color = 'DOURADO EDITADO DEPOIS';
    queuedPayload.items[0].strap_colors[0].base_group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    expect((await firstLoad.loadMobileStrapOfflineManifest('owner-a'))?.manifest_hash)
      .toBe('hash-owner-a');
    expect((await firstLoad.loadMobileStrapOfflineManifest('owner-b'))?.manifest_hash)
      .toBe('hash-owner-b');
    expect(await firstLoad.loadMobileStrapOfflineManifest('owner-old')).toBeNull();

    // Equivale a fechar/reabrir a página: os módulos (e o dbPromise) nascem de
    // novo, mas o registro permanece no IndexedDB em vez do React Query.
    vi.resetModules();
    const afterReload = await import('../strapOfflineManifest');
    const queueAfterReload = await import('../offlineQueue');
    const restored = await afterReload.loadMobileStrapOfflineManifest('owner-a');

    expect(restored).toEqual(manifest('hash-owner-a'));
    expect(JSON.stringify(restored)).not.toMatch(/price|cost|stock|quantity/i);
    expect(afterReload.findMobileStrapManifestReference(
      restored,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      null,
    )?.lines[0].allowed_colors).toEqual([{ id: COLOR_ID, name: 'CHAMPAGNE' }]);

    const beforeRetry = (await queueAfterReload.listPendingOrders('owner-a'))[0];
    expect(beforeRetry.payload.items[0].strap_colors?.[0]).toMatchObject({
      color: 'CHAMPAGNE',
      color_id: COLOR_ID,
      base_group_id: GROUP_ID,
      base_group_name: 'NAPA SOFT',
    });
    await queueAfterReload.markAttemptFailed(
      'owner-a',
      'request-immutable',
      'rede indisponível',
      'transient',
    );
    const afterRetry = (await queueAfterReload.listPendingOrders('owner-a'))[0];
    expect(afterRetry.payload).toEqual(beforeRetry.payload);
    expect(afterRetry.payload.order.client_request_id).toBe('request-immutable');
  });
});

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  ownerId: 'owner-offline',
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: mocks.ownerId }, loading: false }),
}));
vi.mock('@/hooks/useAccessControl', () => ({
  useCan: () => ({ canCreate: true, loading: false }),
}));
vi.mock('@/lib/mobile/networkStatus', () => ({ useOnlineStatus: () => false }));
vi.mock('@/lib/mobile/syncEngine', () => ({ triggerSync: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import MobileNewOrder from '../MobileNewOrder';
import {
  loadDraft,
  mobileCurrentDraftKey,
  saveDraft,
  saveMobileOrderCatalog,
} from '@/lib/mobile/offlineQueue';
import { saveMobileStrapOfflineManifest } from '@/lib/mobile/strapOfflineManifest';

const REFERENCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINE_ID = '11111111-1111-4111-8111-111111111111';
const TYPE_ID = '22222222-2222-4222-8222-222222222222';
const MEASURE_ID = '33333333-3333-4333-8333-333333333333';
const GROUP_ID = '44444444-4444-4444-8444-444444444444';
const BLACK_ID = '55555555-5555-4555-8555-555555555555';
const GOLD_ID = '66666666-6666-4666-8666-666666666666';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Banco ${name} bloqueado durante o teste.`));
  });
}

function renderOfflineOrder() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MobileNewOrder />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe('novo PV mobile em cold-start offline', () => {
  beforeAll(async () => {
    HTMLElement.prototype.hasPointerCapture ??= () => false;
    HTMLElement.prototype.setPointerCapture ??= () => {};
    HTMLElement.prototype.releasePointerCapture ??= () => {};
    HTMLElement.prototype.scrollIntoView ??= () => {};
    await deleteDatabase('squad-mobile-queue');
    localStorage.clear();
    mocks.rpc.mockRejectedValue(new Error('RPC não deveria executar offline'));
    mocks.from.mockImplementation(() => {
      throw new Error('Consulta Supabase não deveria executar no cold-start offline');
    });

    const technicalLine = {
      technical_strap_line_id: LINE_ID,
      id: LINE_ID,
      label: 'Tira 1',
      identity_basis: 'reference_base' as const,
      identity_group_id: null,
      strap_type_id: TYPE_ID,
      measure_id: MEASURE_ID,
      color_mode: 'select_on_order' as const,
      internal_production_enabled: true,
      group_id: null,
      group_name: null,
      consumption: 28,
      consumption_per_size: null,
    };
    await saveMobileOrderCatalog('owner-offline', {
      references: [{
        id: REFERENCE_ID,
        name: 'I91 TESTE OFFLINE',
        sale_price: 100,
        status_ficha: 'publicada',
        sizes: '34-40',
        has_straps: true,
        strap_colors: [technicalLine],
      }],
      referenceColorVariants: [{
        reference_id: REFERENCE_ID,
        color: 'OFF WHITE',
        image_url: null,
      }],
      materialVariants: [],
      products: [],
      productGroups: [],
    });
    await saveMobileStrapOfflineManifest('owner-offline', {
      version: 1,
      generated_at: '2026-09-05T12:00:00.000Z',
      manifest_hash: 'manifest-render-test',
      references: [{
        reference_id: REFERENCE_ID,
        material_variant_id: null,
        lines: [{
          ...technicalLine,
          position: 1,
          base_group_id: GROUP_ID,
          allowed_colors: [
            { id: BLACK_ID, name: 'PRETO' },
            { id: GOLD_ID, name: 'DOURADO' },
          ],
        }],
      }],
    });
    await saveDraft('owner-offline', 'draft-offline', {
      client: { id: 'client-test', razao_social: 'CLIENTE TESTE' },
      items: [{
        reference_id: REFERENCE_ID,
        reference_name: 'I91 TESTE OFFLINE',
        color: 'OFF WHITE',
        grade: { '37': 1 },
        unit_price: 100,
        unit_price_source: 'manual',
        strap_colors: [{
          ...technicalLine,
          color: 'PRETO',
          color_id: BLACK_ID,
        }],
        strap_sourcing: {},
      }],
      billingDate: '2026-09-07',
    });
    localStorage.setItem(mobileCurrentDraftKey('owner-offline'), 'draft-offline');

    await saveMobileOrderCatalog('owner-without-manifest', {
      references: [{
        id: REFERENCE_ID,
        name: 'I91 SEM CACHE DE TIRAS',
        sale_price: 100,
        status_ficha: 'publicada',
        sizes: '34-40',
        has_straps: true,
        strap_colors: [technicalLine],
      }],
      referenceColorVariants: [],
      materialVariants: [],
      products: [],
      productGroups: [],
    });
    await saveDraft('owner-without-manifest', 'draft-no-manifest', {
      client: { id: 'client-test-2', razao_social: 'CLIENTE SEM CACHE' },
      items: [{
        reference_id: REFERENCE_ID,
        reference_name: 'I91 SEM CACHE DE TIRAS',
        color: 'OFF WHITE',
        grade: { '37': 1 },
        unit_price: 100,
        unit_price_source: 'manual',
        strap_colors: [{
          ...technicalLine,
          color: 'PRETO',
          color_id: BLACK_ID,
        }],
        strap_sourcing: {},
      }],
      billingDate: '2026-09-07',
    });
    localStorage.setItem(
      mobileCurrentDraftKey('owner-without-manifest'),
      'draft-no-manifest',
    );
  });

  it('renderiza as cores do IndexedDB com React Query vazio e mantém após reload', async () => {
    mocks.ownerId = 'owner-offline';
    const user = userEvent.setup();
    const first = renderOfflineOrder();

    expect(await screen.findByText(/cores disponíveis carregadas do catálogo deste usuário/i))
      .toBeInTheDocument();
    const firstSelector = screen.getByRole('combobox', { name: 'Cor de Tira 1' });
    expect(firstSelector).toBeEnabled();
    await user.click(firstSelector);
    expect(await screen.findByRole('option', { name: 'PRETO' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'DOURADO' }));
    expect(firstSelector).toHaveTextContent('DOURADO');
    await waitFor(async () => {
      const saved = await loadDraft<{ items: Array<{ strap_colors?: Array<{ color?: string }> }> }>(
        'owner-offline',
        'draft-offline',
      );
      expect(saved?.items[0].strap_colors?.[0].color).toBe('DOURADO');
    }, { timeout: 1_500 });
    expect(mocks.rpc).not.toHaveBeenCalled();

    first.unmount();
    first.queryClient.clear();
    const second = renderOfflineOrder();

    await waitFor(() => {
      const selector = screen.getByRole('combobox', { name: 'Cor de Tira 1' });
      expect(selector).toBeEnabled();
      expect(selector).toHaveTextContent('DOURADO');
    });
    expect(screen.getByText(/cores disponíveis carregadas do catálogo deste usuário/i))
      .toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
    second.queryClient.clear();
  });

  it('mostra bloqueio claro e desabilita revisão quando o owner não tem manifesto', async () => {
    mocks.ownerId = 'owner-without-manifest';
    const view = renderOfflineOrder();

    expect(await screen.findByText('Catálogo offline de tiras indisponível'))
      .toBeInTheDocument();
    expect(screen.getByText(/Conecte-se para baixar as cores válidas/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar →' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Cor de Tira 1' })).toBeDisabled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    view.queryClient.clear();
  });
});

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  online: true,
  ownerId: 'mobile-color-create-owner',
  created: false,
  context: null as unknown,
  rpc: vi.fn(),
  from: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.ownerId }, loading: false }) }));
vi.mock('@/hooks/useAccessControl', () => ({
  useCan: () => ({ canCreate: true, loading: false, roles: ['admin'] }),
  useAccessControl: () => ({ canSeeFinancialValues: true }),
}));
vi.mock('@/lib/mobile/networkStatus', () => ({ useOnlineStatus: () => mocks.online }));
vi.mock('@/lib/mobile/syncEngine', () => ({ triggerSync: vi.fn() }));
vi.mock('@/hooks/useStrapStockLines', () => ({
  useStrapStockLines: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: mocks.warning } }));
vi.mock('@/lib/mobile/clientContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile/clientContext')>(),
  fetchClientSalesContext: async () => ({ lookup: { byRef: new Map(), byRefColor: new Map() }, defaults: { payment_condition: '30 dias' } }),
  fetchClientHistory: async () => null,
}));
// A RPC de criação e o diálogo real são verificados pelo teste próprio do
// componente. Aqui verificamos a fronteira retorno canônico → manifesto → PV.
vi.mock('@/components/sale-orders/SaleOrderStrapColorCreateDialog', () => ({
  SaleOrderStrapColorCreateDialog: (props: {
    context: unknown;
    onCreated: (created: unknown) => Promise<void>;
    onOpenChange: (open: boolean) => void;
  }) => {
    mocks.context = props.context;
    return <button type="button" onClick={async () => {
      mocks.created = true;
      await props.onCreated({
        technicalStrapLineId: LINE_ID, typeId: TYPE_ID, measureId: MEASURE_ID,
        baseGroupId: GROUP_ID, productId: PRODUCT_ID, colorId: GOLD_ID, colorName: 'DOURADO',
      });
      props.onOpenChange(false);
    }}>Concluir cadastro canônico</button>;
  },
}));

import MobileNewOrder from '../MobileNewOrder';
import { loadDraft, mobileCurrentDraftKey, saveDraft, saveMobileOrderCatalog } from '@/lib/mobile/offlineQueue';
import { loadMobileStrapOfflineManifest, saveMobileStrapOfflineManifest, type MobileStrapOfflineManifest } from '@/lib/mobile/strapOfflineManifest';

const REFERENCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINE_ID = '11111111-1111-4111-8111-111111111111';
const TYPE_ID = '22222222-2222-4222-8222-222222222222';
const MEASURE_ID = '33333333-3333-4333-8333-333333333333';
const GROUP_ID = '44444444-4444-4444-8444-444444444444';
const BLACK_ID = '55555555-5555-4555-8555-555555555555';
const GOLD_ID = '66666666-6666-4666-8666-666666666666';
const PRODUCT_ID = '77777777-7777-4777-8777-777777777777';
const line = {
  technical_strap_line_id: LINE_ID, id: LINE_ID, position: 1, label: 'Tira 1',
  identity_basis: 'reference_base' as const, identity_group_id: null,
  strap_type_id: TYPE_ID, measure_id: MEASURE_ID, color_mode: 'select_on_order' as const,
  material_mode: 'follow_reference', material_group_id: null, allowed_material_group_ids: [],
  group_name: 'OVERLOCK 5MM', consumption: 28, consumption_per_size: { '37': 30 },
  base_group_id: GROUP_ID, base_group_name: 'NAPA SOFT',
};
const reference = {
  id: REFERENCE_ID, name: 'I91 CADASTRO COR', sale_price: 100,
  status_ficha: 'publicada', sizes: '34-40', has_straps: true, strap_colors: [line],
};
const manifest = (includeGold: boolean): MobileStrapOfflineManifest => ({
  version: 2, generated_at: '2026-09-05T12:00:00Z', manifest_hash: includeGold ? 'fresh-gold' : 'initial-black',
  references: [{ reference_id: REFERENCE_ID, material_variant_id: null, lines: [{
    ...line, allowed_colors: [
      { id: BLACK_ID, name: 'PRETO' },
      ...(includeGold ? [{ id: GOLD_ID, name: 'DOURADO' }] : []),
    ],
  }] }],
});

function renderOrder() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={queryClient}><MobileNewOrder /></QueryClientProvider>);
  return { ...view, queryClient };
}

beforeEach(async () => {
  mocks.online = true;
  mocks.created = false;
  mocks.context = null;
  mocks.warning.mockReset();
  mocks.rpc.mockReset().mockImplementation(async (name) => {
    if (name !== 'get_mobile_strap_offline_manifest') throw new Error(`RPC inesperada: ${name}`);
    return { data: manifest(mocks.created), error: null };
  });
  mocks.from.mockReset().mockImplementation((table: string) => {
    const result = { data: table === 'technical_sheets' ? [reference] : [], error: null };
    const builder = { ...result, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) } as Record<string, unknown>;
    for (const name of ['select', 'eq', 'order', 'limit', 'in']) builder[name] = () => builder;
    return builder;
  });
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
  await saveMobileOrderCatalog(mocks.ownerId, {
    references: [reference], referenceColorVariants: [], materialVariants: [], products: [], productGroups: [],
  });
  await saveDraft(mocks.ownerId, 'mobile-color-draft', {
    client: { id: 'client-test', razao_social: 'CLIENTE TESTE' },
    items: [{ reference_id: REFERENCE_ID, reference_name: reference.name, color: 'OFF WHITE',
      grade: { '37': 1 }, unit_price: 100, unit_price_source: 'manual',
      strap_colors: [{ ...line, color_id: BLACK_ID, color: 'PRETO' }], strap_sourcing: {},
    }], billingDate: '2026-09-07',
  });
  localStorage.setItem(mobileCurrentDraftKey(mocks.ownerId), 'mobile-color-draft');
});

describe('cadastro de cor integrado ao PV mobile', () => {
  it('um carregamento antigo que termina depois do cadastro não apaga a cor recém-selecionada', async () => {
    await saveMobileStrapOfflineManifest(mocks.ownerId, manifest(false));
    let finishOlderRequest: (value: unknown) => void;
    mocks.rpc.mockImplementationOnce(() => new Promise((resolve) => { finishOlderRequest = resolve; }));
    const user = userEvent.setup();
    const view = renderOrder();
    const register = await screen.findByRole('button', { name: 'Não encontrou a cor? Cadastrar neste material' });
    await waitFor(() => expect(register).toBeEnabled());
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    await user.click(register);
    await user.click(screen.getByRole('button', { name: 'Concluir cadastro canônico' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Cor de Tira 1' })).toHaveTextContent('DOURADO'));
    await act(async () => { finishOlderRequest({ data: manifest(false), error: null }); });
    expect(screen.getByRole('combobox', { name: 'Cor de Tira 1' })).toHaveTextContent('DOURADO');
    expect((await loadMobileStrapOfflineManifest(mocks.ownerId))?.manifest_hash).toBe('fresh-gold');
    view.unmount();
    view.queryClient.clear();
  });

  it('um cadastro concluído depois da remoção do item não recria nem altera o pedido', async () => {
    const user = userEvent.setup();
    const view = renderOrder();
    const register = await screen.findByRole('button', { name: 'Não encontrou a cor? Cadastrar neste material' });
    await waitFor(() => expect(register).toBeEnabled());
    await user.click(register);
    await user.click(screen.getByRole('button', { name: 'Remover I91 CADASTRO COR' }));
    await user.click(screen.getByRole('button', { name: 'Concluir cadastro canônico' }));
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('selecione a cor novamente')));
    expect(screen.queryByRole('combobox', { name: 'Cor de Tira 1' })).not.toBeInTheDocument();
    await waitFor(async () => {
      const saved = await loadDraft<{ items: unknown[] }>(mocks.ownerId, 'mobile-color-draft');
      expect(saved?.items).toEqual([]);
    }, { timeout: 1500 });
    view.unmount();
    view.queryClient.clear();
  });

  it('passa tipo/medida existentes, atualiza manifesto antes de selecionar e mantém a cor offline após reload', async () => {
    const user = userEvent.setup();
    const view = renderOrder();
    const register = await screen.findByRole('button', { name: 'Não encontrou a cor? Cadastrar neste material' });
    await waitFor(() => expect(register).toBeEnabled());
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('get_mobile_strap_offline_manifest', { p_reference_ids: null }));
    await user.click(register);
    expect(mocks.context).toMatchObject({
      referenceId: REFERENCE_ID, materialVariantId: null,
      technicalStrapLineId: LINE_ID, typeId: TYPE_ID, measureId: MEASURE_ID,
      baseGroupId: GROUP_ID, baseGroupName: 'NAPA SOFT', typeName: 'OVERLOCK 5MM',
    });
    await user.click(screen.getByRole('button', { name: 'Concluir cadastro canônico' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Cor de Tira 1' })).toHaveTextContent('DOURADO'));
    expect((await loadMobileStrapOfflineManifest(mocks.ownerId))?.manifest_hash).toBe('fresh-gold');
    await waitFor(async () => {
      const saved = await loadDraft<{ items: Array<{ strap_colors: unknown[]; strap_sourcing: unknown }> }>(mocks.ownerId, 'mobile-color-draft');
      expect(saved?.items[0].strap_colors[0]).toMatchObject({
        technical_strap_line_id: LINE_ID, strap_type_id: TYPE_ID, measure_id: MEASURE_ID,
        color_id: GOLD_ID, color: 'DOURADO', consumption: 28, consumption_per_size: { '37': 30 },
      });
      expect(saved?.items[0].strap_sourcing).toEqual({});
    }, { timeout: 1500 });
    expect(mocks.warning).not.toHaveBeenCalled();
    view.unmount();
    view.queryClient.clear();
    mocks.online = false;
    mocks.rpc.mockClear();
    mocks.from.mockClear();
    const reopened = renderOrder();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Cor de Tira 1' })).toHaveTextContent('DOURADO'));
    expect(screen.getByText('Para cadastrar uma nova cor, conecte-se à internet.')).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    reopened.unmount();
    reopened.queryClient.clear();
  });
});

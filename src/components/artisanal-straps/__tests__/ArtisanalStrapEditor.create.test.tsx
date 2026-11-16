import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArtisanalStrapCapabilities,
  ArtisanalStrapCatalog,
} from '@/hooks/useArtisanalStraps';
import { ArtisanalStrapEditor } from '../ArtisanalStrapEditor';

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useArtisanalStraps', () => ({
  useSaveArtisanalStrapBundle: () => ({
    isPending: false,
    mutateAsync,
  }),
  useStrapBaseGroupCandidates: () => ({
    data: [],
    isLoading: false,
  }),
}));

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  mutateAsync.mockReset();
});

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ data: [] }),
}));

vi.mock('@/hooks/useContractors', () => ({
  useContractors: () => ({ data: [] }),
}));

vi.mock('@/lib/saveArtisanalStrapMeasureHubFields', () => ({
  saveArtisanalStrapMeasureHubFields: vi.fn(),
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

const capabilities: ArtisanalStrapCapabilities = {
  manage_strap_catalog: true,
  administer_strap_operations: true,
  approve_strap_recipe: true,
  execute_strap_batch: true,
  resolve_strap_migration: true,
  can_see_financial_values: true,
};

const emptyCatalog: ArtisanalStrapCatalog = {
  types: [],
  measures: [],
  colors: [],
  aliases: [],
  width_profiles: [],
  official_products: [],
  variants: [],
  recipes: [],
  legacy_recipes: [],
  products: [],
  groups: [],
  capabilities,
};

describe('ArtisanalStrapEditor — novo cadastro', () => {
  it('abre sem medida e sem receita sugerida sem acessar uma receita inexistente', () => {
    renderWithQueryClient(
      <ArtisanalStrapEditor
        open
        onOpenChange={vi.fn()}
        catalog={emptyCatalog}
        capabilities={capabilities}
        mode="create"
        origin="hub"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Cadastrar tira' })).toBeInTheDocument();
  });
});

const TYPE_ID = '11111111-1111-4111-8111-111111111111';
const MEASURE_ID = '22222222-2222-4222-8222-222222222222';
const GROUP_ID = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const COLOR_ID = '55555555-5555-4555-8555-555555555555';

/** Grupo acabado real (TIRA STRASS 6MM): a "cor" do produto é um descritivo
 * comercial que não bate com nenhuma cor canônica nem alias aprovado. */
const buyReadyCatalog: ArtisanalStrapCatalog = {
  ...emptyCatalog,
  types: [{ id: TYPE_ID, name: 'TIRA STRASS', active: true }],
  measures: [{
    id: MEASURE_ID,
    strap_type_id: TYPE_ID,
    display_name: '6 mm',
    finished_width_mm: 6,
    active: true,
  }],
  colors: [{ id: COLOR_ID, name: 'PRETO', active: true }],
  groups: [{ id: GROUP_ID, name: 'TIRA STRASS 6MM' }],
  products: [{
    id: PRODUCT_ID,
    name: 'Tira Strass 6mm Cristal com fundo branco',
    sku: 'TSTR-01',
    group_id: GROUP_ID,
    color: 'CRISTAL COM FUNDO BRANCO',
    unit: 'm',
    active: true,
  }],
};

/**
 * Cor canônica da tira comprada pronta: DERIVADA só quando o produto acabado
 * já resolve para uma cor canônica. Sem produto (ou sem mapeamento) o campo
 * libera — name/SKU também — para o Hub criar o SKU junto com a variante
 * (atalho de Grupos). Com produto mapeável, o campo continua bloqueado.
 */
describe('ArtisanalStrapEditor — tira comprada pronta com cor derivada', () => {
  const renderBuyReady = (extra: Record<string, unknown> = {}) => renderWithQueryClient(
    <ArtisanalStrapEditor
      open
      onOpenChange={vi.fn()}
      catalog={buyReadyCatalog}
      capabilities={capabilities}
      mode="create"
      origin="hub"
      identityBasis="finished_product_group"
      measureId={MEASURE_ID}
      baseGroupId={GROUP_ID}
      {...extra}
    />,
  );

  it('sem produto, libera a cor e orienta criar o acabado', () => {
    renderBuyReady();
    expect(screen.queryByText('Derivada do produto comprado pronto')).not.toBeInTheDocument();
    expect(screen.getByText(/Sem produto selecionado: escolha a cor aqui/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/TIRA CHATA/i)).not.toBeDisabled();
    expect(screen.getByPlaceholderText(/TCH-/i)).not.toBeDisabled();
  });

  it('sem produto nem cor, pede a cor canônica (campo liberado) — não trava em produto', async () => {
    const user = userEvent.setup();
    renderBuyReady();

    await user.click(screen.getByRole('button', { name: /Salvar tudo/i }));

    expect(await screen.findByText(/Selecione a cor canônica — ela será gravada no produto acabado novo/i))
      .toBeInTheDocument();
    expect(screen.queryByText('Selecione a cor canônica.')).not.toBeInTheDocument();
  });

  it('com produto cuja cor não é canônica, libera a escolha e nomeia o texto do estoque', async () => {
    const user = userEvent.setup();
    renderBuyReady({ finishedProductId: PRODUCT_ID });

    expect(screen.getByText('Cor do produto sem identidade canônica')).toBeInTheDocument();
    expect(screen.queryByText('Derivada do produto comprado pronto')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Salvar tudo/i }));

    expect(await screen.findAllByText(/CRISTAL COM FUNDO BRANCO/)).not.toHaveLength(0);
    expect(screen.queryByText('Selecione a cor canônica.')).not.toBeInTheDocument();
  });
});

const matchingProductCatalog: ArtisanalStrapCatalog = {
  ...buyReadyCatalog,
  products: [{
    ...buyReadyCatalog.products[0],
    color: 'PRETO',
    purchase_price: 0.1,
    purchase_unit: 'm',
    conversion_rate: 1,
    min_order_quantity: 1,
    purchase_multiple: 1,
  }],
  variants: [{
    id: '66666666-6666-4666-8666-666666666666',
    measure_id: MEASURE_ID,
    base_group_id: GROUP_ID,
    identity_basis: 'finished_product_group',
    internal_production_enabled: false,
    color_id: '77777777-7777-4777-8777-777777777777',
    finished_product_id: PRODUCT_ID,
    min_stock_m: 50,
    min_stock_replenishment_mode: 'buy_ready',
    purchase_enabled: true,
    status: 'active',
  }],
};

describe('ArtisanalStrapEditor — produto com cor canônica mapeada', () => {
  it('bloqueia o campo de cor como derivada do produto', () => {
    renderWithQueryClient(
      <ArtisanalStrapEditor
        open
        onOpenChange={vi.fn()}
        catalog={matchingProductCatalog}
        capabilities={capabilities}
        mode="create"
        origin="hub"
        identityBasis="finished_product_group"
        measureId={MEASURE_ID}
        baseGroupId={GROUP_ID}
        finishedProductId={PRODUCT_ID}
      />,
    );
    // Com colorId preenchido o SelectValue mostra o nome (PRETO), não o
    // placeholder — a trava aparece no texto de ajuda + select disabled.
    expect(screen.getByText(/vem do produto escolhido em/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sem produto selecionado: escolha a cor aqui/i)).not.toBeInTheDocument();
    const colorTrigger = screen.getAllByRole('combobox').find((node) =>
      /PRETO/i.test(node.textContent || ''));
    expect(colorTrigger).toBeTruthy();
    expect(colorTrigger).toBeDisabled();
  });
});

const FINISHED_STRAP_GROUP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NAPA_GROUP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const gruposUrlCatalog: ArtisanalStrapCatalog = {
  ...emptyCatalog,
  types: [{ id: TYPE_ID, name: 'TIRA CHATA', active: true }],
  measures: [{
    id: MEASURE_ID,
    strap_type_id: TYPE_ID,
    display_name: '20 mm',
    finished_width_mm: 20,
    active: true,
  }],
  colors: [{ id: COLOR_ID, name: 'OFF WHITE', active: true }],
  groups: [
    { id: FINISHED_STRAP_GROUP_ID, name: 'TIRA CHATA 20MM', is_artisanal_strap: true },
    { id: NAPA_GROUP_ID, name: 'NAPA SOFT', is_artisanal_strap: false },
  ],
  products: [{
    id: PRODUCT_ID,
    name: 'TIRA CHATA - 20 mm - OFF WHITE',
    sku: 'TCH-20-OW',
    group_id: FINISHED_STRAP_GROUP_ID,
    color: 'OFF WHITE',
    unit: 'm',
    active: true,
    purchase_price: 1.5,
    purchase_unit: 'm',
    conversion_rate: 1,
    min_order_quantity: 1,
    purchase_multiple: 1,
  }],
};

describe('ArtisanalStrapEditor — URL de Grupos com tira acabada como baseGroupId', () => {
  it('promove is_artisanal_strap a Comprar pronto e libera cor para cadastro novo', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({ variant_id: 'new-variant', measure_id: MEASURE_ID });

    renderWithQueryClient(
      <ArtisanalStrapEditor
        open
        onOpenChange={vi.fn()}
        catalog={gruposUrlCatalog}
        capabilities={capabilities}
        mode="review"
        origin="grupos"
        measureId={MEASURE_ID}
        baseGroupId={FINISHED_STRAP_GROUP_ID}
      />,
    );

    expect(screen.getByText('Grupo do produto comprado pronto *')).toBeInTheDocument();
    expect(screen.queryByText('Material-base que será debitado *')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhum produto ativo desta napa-base/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Sem produto selecionado: escolha a cor aqui/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Salvar e ativar/i }));

    expect(await screen.findByText(/Selecione a cor canônica — ela será gravada no produto acabado novo/i))
      .toBeInTheDocument();
    expect(screen.queryByText('Selecione a cor canônica.')).not.toBeInTheDocument();
  });

  it('com produto acabado da URL, salva e ativa', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({ variant_id: 'new-variant', measure_id: MEASURE_ID });

    renderWithQueryClient(
      <ArtisanalStrapEditor
        open
        onOpenChange={vi.fn()}
        catalog={gruposUrlCatalog}
        capabilities={capabilities}
        mode="review"
        origin="grupos"
        identityBasis="finished_product_group"
        measureId={MEASURE_ID}
        baseGroupId={FINISHED_STRAP_GROUP_ID}
        finishedProductId={PRODUCT_ID}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Salvar e ativar/i }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const { payload } = mutateAsync.mock.calls[0][0];
    expect(payload.variant.identity_basis).toBe('finished_product_group');
    expect(payload.variant.base_group_id).toBe(FINISHED_STRAP_GROUP_ID);
    expect(payload.variant.color_id).toBe(COLOR_ID);
    expect(payload.variant.status).toBe('active');
  });

  it('grupo sem produtos libera name/SKU e pede cor — não exige produto existente', async () => {
    const user = userEvent.setup();
    const emptyGroupCatalog: ArtisanalStrapCatalog = {
      ...gruposUrlCatalog,
      products: [],
    };

    renderWithQueryClient(
      <ArtisanalStrapEditor
        open
        onOpenChange={vi.fn()}
        catalog={emptyGroupCatalog}
        capabilities={capabilities}
        mode="review"
        origin="grupos"
        identityBasis="finished_product_group"
        measureId={MEASURE_ID}
        baseGroupId={FINISHED_STRAP_GROUP_ID}
      />,
    );

    expect(screen.getByText(/O Hub cria o SKU acabado junto com a variante/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/TIRA CHATA/i)).not.toBeDisabled();
    expect(screen.getByPlaceholderText(/TCH-/i)).not.toBeDisabled();
    expect(screen.queryByText(/vem do produto escolhido em/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Salvar e ativar/i }));

    expect(await screen.findByText(/Selecione a cor canônica — ela será gravada no produto acabado novo/i))
      .toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

describe('ArtisanalStrapEditor — estoque mínimo removido (compra só por demanda de PV)', () => {
  const renderMatchingBuyReady = () => renderWithQueryClient(
    <ArtisanalStrapEditor
      open
      onOpenChange={vi.fn()}
      catalog={matchingProductCatalog}
      capabilities={capabilities}
      mode="create"
      origin="pv"
      identityBasis="finished_product_group"
      measureId={MEASURE_ID}
      baseGroupId={GROUP_ID}
      colorId={COLOR_ID}
      finishedProductId={PRODUCT_ID}
      activateOnCreate
    />,
  );

  it('não mostra campo nem confirmação de estoque mínimo — só o MOQ do fornecedor', () => {
    renderMatchingBuyReady();
    expect(screen.getByText('Quantidade mínima (MOQ) *')).toBeInTheDocument();
    expect(screen.queryByText(/Estoque mínimo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/piso de reposição/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sugestão das variantes irmãs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Origem da reposição/i)).not.toBeInTheDocument();
  });

  it('salva direto, com piso 0 e modo derivado buy_ready para tira comprada pronta', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({ variant_id: 'new-variant', measure_id: MEASURE_ID });
    renderMatchingBuyReady();

    await user.click(screen.getByRole('button', { name: /Salvar tudo/i }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const { payload } = mutateAsync.mock.calls[0][0];
    expect(payload.variant.min_stock_m).toBe(0);
    expect(payload.variant.min_stock_replenishment_mode).toBe('buy_ready');
  });
});

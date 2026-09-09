import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaleOrderStrapColorCreateDialog, { type SaleOrderStrapColorCreateContext } from '../SaleOrderStrapColorCreateDialog';
import QuickColorVariantDialog from '@/components/groups/QuickColorVariantDialog';
import type { ProductGroup } from '@/hooks/useGroups';
import type { Product } from '@/types/inventory';

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

const mocks = vi.hoisted(() => ({
  permission: { loading: false, canCreate: true, roles: ['admin'] },
  financial: true,
  from: vi.fn(),
  create: vi.fn(),
  rpc: vi.fn(),
  refetch: vi.fn(),
  catalog: {} as Record<string, unknown>,
  group: {} as Record<string, unknown>,
  products: [] as Product[],
}));
vi.mock('@/hooks/useAccessControl', () => ({
  useCan: () => mocks.permission,
  useAccessControl: () => ({ canSeeFinancialValues: mocks.financial }),
}));
vi.mock('@/hooks/useArtisanalStraps', () => ({
  useArtisanalStrapCatalog: () => ({ data: mocks.catalog, refetch: mocks.refetch }),
}));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ data: [] }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock('@/lib/quickGroupVariant', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/quickGroupVariant')>(),
  createQuickGroupVariant: mocks.create,
}));

const BASE = '11111111-1111-4111-8111-111111111111';
const TYPE = '22222222-2222-4222-8222-222222222222';
const MEASURE = '33333333-3333-4333-8333-333333333333';
const LINE = '44444444-4444-4444-8444-444444444444';
const TEMPLATE = '55555555-5555-4555-8555-555555555555';
const PRODUCT = '66666666-6666-4666-8666-666666666666';
const BLACK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BLUE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const template = { id: TEMPLATE, group_id: BASE, name: 'NAPA SOFT PRETO', color: 'PRETO',
  sku: 'TEST-PRETO', active: true, unit: 'm', unit_price: 10 } as Product;
const group = { id: BASE, name: 'NAPA SOFT', shared_specs: true, sector: 'Cabedal',
  dimensions_width: 1370, dimensions_length: 1000, dimensions_unit: 'mm' } as ProductGroup;
const context: SaleOrderStrapColorCreateContext = { technicalStrapLineId: LINE, label: 'TIRA 1',
  referenceId: '77777777-7777-4777-8777-777777777777', materialVariantId: null,
  typeId: TYPE, typeName: 'Tipo definido na ficha', measureId: MEASURE,
  measureName: 'Medida definida na ficha', baseGroupId: BASE, baseGroupName: 'NAPA SOFT' };
const result = { success: true, replayed: false, product_id: PRODUCT, template_product_id: TEMPLATE,
  color: 'AZUL', sku: 'TEST-AZUL', component_sheet_source: 'template' };
const catalog = { types: [{ id: TYPE, name: 'OVERLOCK' }],
  measures: [{ id: MEASURE, strap_type_id: TYPE, display_name: '5 MM' }],
  colors: [{ id: BLACK, name: 'PRETO', active: true }, { id: BLUE, name: 'AZUL', active: true }],
  aliases: [], official_products: [], products: [template] };
const refreshedCatalog = { ...catalog, products: [template, { id: PRODUCT, group_id: BASE, color: 'AZUL', active: true }] };

function mount(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

async function chooseTemplate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('combobox', { name: 'Item-modelo do material' }));
  await user.click(screen.getByRole('option', { name: 'NAPA SOFT PRETO · TEST-PRETO' }));
  await user.click(screen.getByRole('button', { name: 'Continuar com este item' }));
  await screen.findByLabelText(/Nome da nova cor/);
}

async function confirmPrice(user: ReturnType<typeof userEvent.setup>) {
  const price = screen.getByLabelText(/Valor unitário/);
  await user.clear(price);
  await user.type(price, '10,00');
  await user.click(screen.getByRole('checkbox', { name: /Confirmo que o valor unitário/ }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission = { loading: false, canCreate: true, roles: ['admin'] };
  mocks.financial = true;
  mocks.catalog = catalog;
  mocks.group = group;
  mocks.products = [template];
  mocks.create.mockResolvedValue(result);
  mocks.rpc.mockResolvedValue({ data: result, error: null });
  mocks.refetch.mockResolvedValue({ data: refreshedCatalog, error: null });
  mocks.from.mockImplementation(table => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: table === 'product_groups' ? mocks.group : null, error: null }),
    order: async () => ({ data: mocks.products, error: null }),
  }) }) }));
});

describe('SaleOrderStrapColorCreateDialog', () => {
  it('exige item-modelo explícito, fixa saldo zero e seleciona UUID da cor do produto criado', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    mount(<SaleOrderStrapColorCreateDialog open onOpenChange={onOpenChange} context={context} initialColor="AZUL" onCreated={onCreated} />);
    await screen.findByRole('combobox', { name: 'Item-modelo do material' });
    expect(screen.getByRole('button', { name: 'Continuar com este item' })).toBeDisabled();
    expect(screen.getByText('TIRA 1 · OVERLOCK · 5 MM')).toBeInTheDocument();
    await chooseTemplate(user);
    expect(screen.getByLabelText(/Nome da nova cor/)).toHaveValue('AZUL');
    expect(screen.queryByLabelText(/Quantidade inicial/)).not.toBeInTheDocument();
    expect(screen.getByText('0 m — sem entrada de estoque')).toBeInTheDocument();
    await confirmPrice(user);
    await user.click(screen.getByRole('button', { name: 'Criar variação' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ technicalStrapLineId: LINE,
      typeId: TYPE, measureId: MEASURE, baseGroupId: BASE, productId: PRODUCT, colorId: BLUE, colorName: 'AZUL' }));
    expect(mocks.rpc).toHaveBeenCalledWith('create_sale_order_strap_material_color', expect.objectContaining({
      p_reference_id: context.referenceId, p_material_variant_id: null,
      p_technical_strap_line_id: LINE, p_expected_type_id: TYPE, p_expected_measure_id: MEASURE,
      p_base_group_id: BASE, p_template_product_id: TEMPLATE, p_color: 'AZUL', p_unit_price: 10,
    }));
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_quantity');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(['request_failed', 'missing_product', 'wrong_group'])('recarrega sem repetir cadastro quando atualização falha: %s', async failure => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    mocks.refetch.mockResolvedValueOnce(failure === 'request_failed' ? { data: undefined, error: new Error('offline') }
      : { data: failure === 'missing_product' ? catalog : { ...refreshedCatalog,
        products: [{ id: PRODUCT, group_id: TYPE, color: 'AZUL', active: true }] }, error: null });
    mount(<SaleOrderStrapColorCreateDialog open onOpenChange={onOpenChange} context={context} initialColor="AZUL" onCreated={onCreated} />);
    await chooseTemplate(user);
    await confirmPrice(user);
    await user.click(screen.getByRole('button', { name: 'Criar variação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A cor já foi criada.');
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Nome da nova cor/)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Recarregar e continuar' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('mantém a chave idempotente e todo contexto ao repetir uma resposta incerta da RPC', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Resposta indisponível. Tente novamente.' } });
    mount(<SaleOrderStrapColorCreateDialog open onOpenChange={vi.fn()} context={context} initialColor="AZUL" onCreated={onCreated} />);
    await chooseTemplate(user);
    await confirmPrice(user);
    await user.click(screen.getByRole('button', { name: 'Criar variação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Resposta indisponível.');
    await user.click(screen.getByRole('button', { name: 'Criar variação' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0][1].p_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['loading', 'permission', 'role', 'financial', 'invalid_context'])('bloqueia antes de consultar valores: %s', reason => {
    if (reason === 'loading') mocks.permission.loading = true;
    if (reason === 'permission') mocks.permission.canCreate = false;
    if (reason === 'role') mocks.permission.roles = ['vendas'];
    if (reason === 'financial') mocks.financial = false;
    mount(<SaleOrderStrapColorCreateDialog open onOpenChange={vi.fn()}
      context={reason === 'invalid_context' ? { ...context, typeId: '' } : context} onCreated={vi.fn()} />);
    expect(screen.getByText('Cadastro de cor indisponível')).toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
  });

  it('repete somente atualização quando o retorno ao pedido falha, mesmo após nova sugestão de cor', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn().mockRejectedValueOnce(new Error('Falha ao atualizar o pedido.')).mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const dialog = (initialColor: string) => <QueryClientProvider client={client}>
      <SaleOrderStrapColorCreateDialog open onOpenChange={onOpenChange} context={context} initialColor={initialColor} onCreated={onCreated} />
    </QueryClientProvider>;
    const view = render(dialog('AZUL'));
    await chooseTemplate(user);
    await confirmPrice(user);
    await user.click(screen.getByRole('button', { name: 'Criar variação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A cor já foi criada.');
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    view.rerender(dialog('VERDE'));
    expect(screen.getByLabelText(/Nome da nova cor/)).toHaveValue('AZUL');
    expect(screen.getByLabelText(/Nome da nova cor/)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Recarregar e continuar' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCreated).toHaveBeenCalledTimes(2);
    expect(onCreated.mock.calls[1][0]).toEqual(onCreated.mock.calls[0][0]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
  });

  it('não oferece cadastro genérico para grupo de tira comprada pronta', async () => {
    mocks.group = { ...group, is_artisanal_strap: true };
    mount(<SaleOrderStrapColorCreateDialog open onOpenChange={vi.fn()} context={context} onCreated={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Hub de Tiras');
    expect(screen.getByRole('button', { name: 'Continuar com este item' })).toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('permite NAPA SOFT PRETO e OURO sem incluir NAPA ONÇA sem cor do mesmo grupo', async () => {
    const user = userEvent.setup();
    const gold = { ...template, id: '88888888-8888-4888-8888-888888888888', name: 'NAPA SOFT OURO', color: 'OURO', sku: 'TEST-OURO' };
    const leopard = { ...template, id: '99999999-9999-4999-8999-999999999999', name: 'NAPA ONÇA', color: '' };
    mocks.products = [template, gold, leopard];
    mocks.catalog = { ...catalog, products: mocks.products,
      colors: [...catalog.colors, { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'OURO', active: true }] };
    mount(<SaleOrderStrapColorCreateDialog open onOpenChange={vi.fn()} context={context} onCreated={vi.fn()} />);
    await user.click(await screen.findByRole('combobox', { name: 'Item-modelo do material' }));
    expect(screen.getByRole('option', { name: 'NAPA SOFT PRETO · TEST-PRETO' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'NAPA SOFT OURO · TEST-OURO' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /NAPA ONÇA/ })).not.toBeInTheDocument();
  });

  it.each(['wrong_material', 'empty_color', 'wrong_unit', 'unapproved_alias', 'finished_product'])('não oferece item-modelo incompatível: %s', reason => {
    const invalid = { ...template, id: PRODUCT,
      ...(reason === 'wrong_material' ? { name: 'NAPA ONÇA PRETO' } : {}),
      ...(reason === 'empty_color' ? { name: 'NAPA SOFT', color: '' } : {}),
      ...(reason === 'wrong_unit' ? { unit: 'dm²' } : {}),
      ...(reason === 'unapproved_alias' ? { name: 'NAPA SOFT PRETÃO', color: 'PRETÃO' } : {}),
    };
    mocks.products = [template, invalid];
    mocks.catalog = { ...catalog, products: mocks.products,
      aliases: reason === 'unapproved_alias' ? [{ alias: 'PRETÃO', canonical_color_id: BLACK, status: 'pending' }] : [],
      variants: reason === 'finished_product' ? [{ finished_product_id: PRODUCT }] : [],
    };
    mount(<SaleOrderStrapColorCreateDialog open onOpenChange={vi.fn()} context={context} onCreated={vi.fn()} />);
    return screen.findByRole('combobox', { name: 'Item-modelo do material' }).then(async combobox => {
      await userEvent.setup().click(combobox);
      expect(screen.getAllByRole('option')).toHaveLength(1);
      expect(screen.getByRole('option')).toHaveTextContent('NAPA SOFT PRETO · TEST-PRETO');
    });
  });

  it('preserva o material composto como uma única linha, sem oferecer componentes separados', async () => {
    const user = userEvent.setup();
    const composite = { ...template, name: 'NAPA SOFT + MASSABOX - PRETO', sku: 'TEST-COMPOSTO' };
    mocks.group = { ...group, name: 'NAPA SOFT + MASSABOX' };
    mocks.products = [composite, { ...template, id: PRODUCT }];
    mocks.catalog = { ...catalog, products: mocks.products };
    mount(<SaleOrderStrapColorCreateDialog open onOpenChange={vi.fn()}
      context={{ ...context, baseGroupName: 'NAPA SOFT + MASSABOX' }} onCreated={vi.fn()} />);
    await user.click(await screen.findByRole('combobox', { name: 'Item-modelo do material' }));
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('NAPA SOFT + MASSABOX - PRETO · TEST-COMPOSTO');
  });
});

describe('QuickColorVariantDialog — compatibilidade', () => {
  it('mantém saldo editável no cadastro de grupos e aguarda callback assíncrono antes de fechar', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    let finish: () => void;
    const onCreated = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    mount(<QuickColorVariantDialog open onOpenChange={onOpenChange} group={group} template={template}
      products={[template]} onCreated={onCreated} />);
    await user.type(screen.getByLabelText(/Nome da nova cor/), 'AZUL');
    fireEvent.change(screen.getByLabelText(/Quantidade inicial/), { target: { value: '7' } });
    await confirmPrice(user);
    await user.click(screen.getByRole('button', { name: 'Criar variação' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ quantity: 7 }));
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

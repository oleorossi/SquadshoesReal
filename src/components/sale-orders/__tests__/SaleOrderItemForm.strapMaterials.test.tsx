import { useState, type ComponentProps } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SaleOrderItemForm from '../SaleOrderItemForm';
import type { SaleOrderItemFormData } from '@/hooks/useSaleOrders';
import type SaleOrderStrapColorCreateDialog from '../SaleOrderStrapColorCreateDialog';
import type { ReferenceMaterialVariant } from '@/hooks/useReferenceMaterialVariants';

type ColorDialogProps = ComponentProps<typeof SaleOrderStrapColorCreateDialog>;

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

const state = vi.hoisted(() => ({
  catalog: {} as Record<string, unknown>, loading: false, canCreate: false,
  strapLines: [] as Array<Record<string, unknown>>,
  colorDialog: null as ColorDialogProps | null,
}));
vi.mock('@/hooks/useAccessControl', () => ({ useAccessControl: () => ({
  canSeeFinancialValues: state.canCreate, can: () => state.canCreate,
  roles: state.canCreate ? ['admin'] : [], loading: false, permsLoading: false,
}) }));
vi.mock('@/components/sale-orders/SaleOrderStrapColorCreateDialog', () => ({
  default: (props: ColorDialogProps) => { state.colorDialog = props; return <div role="dialog">Cadastro contextual de cor</div>; },
}));
vi.mock('@/hooks/useArtisanalStraps', () => ({
  useArtisanalStrapCatalog: () => ({ data: state.loading ? undefined : state.catalog, isLoading: state.loading }),
  useArtisanalStrapCatalogDiagnostics: () => ({ data: undefined }),
}));
vi.mock('@/hooks/useStrapStockLines', () => ({ useStrapStockLines: () => ({ data: state.strapLines, isLoading: false }) }));
vi.mock('@/hooks/useInternalStrapReadiness', () => ({ useInternalStrapReadiness: () => ({ data: undefined }) }));
vi.mock('@/hooks/useProducts', () => ({ useAddProduct: () => ({ mutateAsync: vi.fn() }), ProductSchema: { parse: vi.fn() } }));
vi.mock('@/hooks/useComponentSheets', () => ({ useAddComponentSheet: () => ({ mutateAsync: vi.fn() }) }));
vi.mock('@/components/sale-orders/ItemSectorOutsourcingSection', () => ({ ItemSectorOutsourcingSection: () => null }));
vi.mock('@/components/sale-orders/StrapCatalogResolutionDrawer', () => ({ default: () => null }));
vi.mock('@/components/artisanal-straps/ArtisanalStrapEditor', () => ({ ArtisanalStrapEditor: () => null }));
vi.mock('@/components/inventory/ProductFormDialog', () => ({ ProductFormDialog: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => { throw new Error('O teste não permite consulta remota; prepare o cache React Query.'); },
} }));

const REF = '00000000-0000-4000-8000-000000000001';
const LINE_A = '00000000-0000-4000-8000-000000000002';
const LINE_B = '00000000-0000-4000-8000-000000000003';
const SOFT = '11111111-1111-4111-8111-111111111111';
const COMPOSITE = '22222222-2222-4222-8222-222222222222';
const NOT_ALLOWED = '33333333-3333-4333-8333-333333333333';
const TYPE = '44444444-4444-4444-8444-444444444444';
const MEASURE = '55555555-5555-4555-8555-555555555555';
const BLACK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GOLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRODUCTS = [
  { id: 'p-soft-black', group_id: SOFT, name: 'NAPA SOFT PRETO', color: 'PRETO', active: true, unit: 'm' },
  { id: 'p-soft-gold', group_id: SOFT, name: 'NAPA SOFT OURO', color: 'OURO', active: true, unit: 'm' },
  { id: 'p-composite-black', group_id: COMPOSITE, name: 'NAPA SOFT + MASSABOX PRETO', color: 'PRETO', active: true },
];
const GROUPS = [
  { id: SOFT, name: 'NAPA SOFT' }, { id: COMPOSITE, name: 'NAPA SOFT + MASSABOX' },
  { id: NOT_ALLOWED, name: 'MATERIAL NÃO AUTORIZADO' },
];
const technicalLines: NonNullable<SaleOrderItemFormData['strap_colors']> = [LINE_A, LINE_B].map((id, index) => ({
  id, technical_strap_line_id: id, label: `TIRA ${index + 1}`, strap_type_id: TYPE, measure_id: MEASURE,
  identity_basis: 'reference_base', identity_group_id: null, color_mode: 'select_on_order',
  material_mode: 'select_on_order', material_group_id: null, allowed_material_group_ids: [SOFT, COMPOSITE],
  consumption: 42, consumption_per_size: { '34': 42 }, color: '', color_id: null,
}));
const references = [{ id: REF, code: 'I91', name: 'Modelo I91', has_straps: true, sizes: '34-35', strap_colors: technicalLines }];

function initialItem(color = BLACK): SaleOrderItemFormData {
  return {
    id: 'saved-item', reference_id: REF, color: 'PRETO', grade: { '34': 10 }, fichas: 1, quantity: 10, unit_price: 10,
    strap_colors: technicalLines.map((line, index) => ({
      ...line, base_group_id: SOFT, base_group_name: 'NAPA SOFT',
      color: index === 0 && color === GOLD ? 'OURO' : 'PRETO', color_id: index === 0 ? color : BLACK,
    })),
    strap_sourcing: {
      [LINE_A]: { source_mode: 'internal', color_id: color, strap_variant_id: TYPE, recipe_id: MEASURE },
      [LINE_B]: { source_mode: 'internal', color_id: BLACK, strap_variant_id: TYPE, recipe_id: MEASURE },
    },
  };
}

function mount(initial: SaleOrderItemFormData, status = 'Rascunho', lines = technicalLines, options: {
  products?: typeof PRODUCTS;
  groups?: typeof GROUPS;
  variantsByRef?: ComponentProps<typeof SaleOrderItemForm>['variantsByRef'];
} = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['sheet_specs_for_colors', REF], { upper_material: 'NAPA SOFT', upper_material_group_id: SOFT, has_straps: true });
  qc.setQueryData(['products_for_colors'], options.products || PRODUCTS);
  qc.setQueryData(['product_groups_colors'], options.groups || GROUPS);
  let latest = initial;
  let replaceItem: (next: SaleOrderItemFormData) => void;
  const updates = vi.fn();
  const colorIssues = vi.fn();
  const referenceData = references.map(reference => ({ ...reference, strap_colors: lines }));
  function Harness() {
    const [item, setItem] = useState(initial);
    replaceItem = setItem;
    latest = item;
    return <SaleOrderItemForm
      item={item} index={0} references={referenceData} canRemove={false} isAdmin={false}
      saleOrderStatus={status} onRemove={vi.fn()}
      variantsByRef={options.variantsByRef} onColorIssueChange={colorIssues}
      onUpdate={(_index, field, value) => {
        updates(field, value);
        setItem(current => ({ ...current, [field]: value }));
      }}
    />;
  }
  const view = render(<QueryClientProvider client={qc}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Harness /></MemoryRouter></QueryClientProvider>);
  return { ...view, current: () => latest, replace: (next: SaleOrderItemFormData) => replaceItem(next), updates, colorIssues, qc };
}

beforeEach(() => {
  state.loading = false;
  state.canCreate = false;
  state.strapLines = [];
  state.colorDialog = null;
  state.catalog = {
    types: [{ id: TYPE, active: true, name: 'Tira' }],
    measures: [{ id: MEASURE, strap_type_id: TYPE, active: true }],
    colors: [{ id: BLACK, name: 'PRETO', active: true }, { id: GOLD, name: 'OURO', active: true }],
    groups: GROUPS, products: PRODUCTS,
    official_products: PRODUCTS.map(product => ({
      base_group_id: product.group_id, color_id: product.color === 'PRETO' ? BLACK : GOLD,
      official_product_id: product.id, status: 'active',
    })),
    aliases: [], recipes: [], width_profiles: [], variants: [], legacy_recipes: [], capabilities: {},
  };
});

afterEach(() => { vi.restoreAllMocks(); });

describe('SaleOrderItemForm — material por posição', () => {
  it('busca e seleciona cor de produto cadastrado sem exigir vínculo oficial anterior', async () => {
    state.catalog.official_products = [];
    const user = userEvent.setup();
    const view = mount(initialItem());
    await user.click(screen.getByRole('combobox', { name: 'Cor de TIRA 1' }));
    await user.type(screen.getByRole('textbox', { name: 'Buscar cor…' }), 'ouro');
    expect(screen.queryByRole('option', { name: 'PRETO' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'OURO' }));
    expect(view.current().strap_colors[0]).toMatchObject({
      id: LINE_A, color_id: GOLD, color: 'OURO', strap_type_id: TYPE, measure_id: MEASURE,
      consumption: 42, consumption_per_size: { '34': 42 },
    });
    expect(view.current().strap_colors[1].color_id).toBe(BLACK);
    expect(view.current().strap_sourcing).not.toHaveProperty(LINE_A);
    expect(view.current().strap_sourcing).toHaveProperty(LINE_B);
  });

  it('abre cadastro com tipo e material da ficha e aplica retorno somente na posição correta', async () => {
    state.canCreate = true;
    const user = userEvent.setup();
    const view = mount(initialItem());
    await user.click(screen.getByRole('button', { name: 'Cadastrar cor de TIRA 1' }));
    expect(state.colorDialog.context).toMatchObject({
      technicalStrapLineId: LINE_A, typeId: TYPE, measureId: MEASURE, baseGroupId: SOFT,
    });
    await act(async () => state.colorDialog.onCreated({
      ...state.colorDialog.context, productId: 'p-soft-gold', colorId: GOLD, colorName: 'OURO',
    }));
    expect(view.current().strap_colors[0]).toMatchObject({
      color_id: GOLD, strap_type_id: TYPE, measure_id: MEASURE, consumption: 42,
    });
    expect(view.current().strap_colors[1].color_id).toBe(BLACK);
    expect(view.current().strap_sourcing).not.toHaveProperty(LINE_A);
    expect(view.current().strap_sourcing).toHaveProperty(LINE_B);
  });

  it('não aplica retorno tardio do cadastro quando o material da posição mudou', async () => {
    state.canCreate = true;
    const user = userEvent.setup();
    const view = mount(initialItem());
    await user.click(screen.getByRole('button', { name: 'Cadastrar cor de TIRA 1' }));
    const pending = state.colorDialog;
    await user.click(screen.getByRole('combobox', { name: 'Material de TIRA 1' }));
    await user.click(screen.getByRole('option', { name: 'NAPA SOFT + MASSABOX' }));
    expect(() => pending.onCreated({
      ...pending.context, productId: 'p-soft-gold', colorId: GOLD, colorName: 'OURO',
    })).toThrow('contexto do item mudou');
    expect(view.current().strap_colors[0]).toMatchObject({ base_group_id: COMPOSITE, color_id: BLACK });
  });

  it('mantém a seleção e bloqueia apenas o cadastro sem autorização de estoque', () => {
    mount(initialItem());
    expect(screen.getByRole('button', { name: 'Cadastrar cor de TIRA 1' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Cor de TIRA 1' })).toBeEnabled();
  });

  it('não aplica cadastro a outro item novo da mesma referência nem após desmontagem', async () => {
    state.canCreate = true;
    const user = userEvent.setup();
    const initial = { ...initialItem(), id: undefined };
    const view = mount(initial);
    await user.click(screen.getByRole('button', { name: 'Cadastrar cor de TIRA 1' }));
    const pending = state.colorDialog;
    const created = { ...pending.context, productId: 'p-soft-gold', colorId: GOLD, colorName: 'OURO' };
    await act(async () => view.replace({ ...initial, grade: { '34': 20 } }));
    expect(() => pending.onCreated(created)).toThrow('contexto do item mudou');
    expect(view.current().strap_colors[0].color_id).toBe(BLACK);
    view.unmount();
    expect(() => pending.onCreated(created)).toThrow('contexto do item mudou');
  });

  it('escolhe somente grupo permitido por UUID e preserva cor compatível e demais posições', async () => {
    const user = userEvent.setup();
    const view = mount(initialItem());
    await user.click(screen.getByRole('combobox', { name: 'Material de TIRA 1' }));
    expect(screen.queryByRole('option', { name: 'MATERIAL NÃO AUTORIZADO' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'NAPA SOFT + MASSABOX' }));
    await waitFor(() => expect(view.current().strap_colors[0].base_group_id).toBe(COMPOSITE));
    expect(view.current().strap_colors[0]).toMatchObject({
      color_id: BLACK, color: 'PRETO', base_group_name: 'NAPA SOFT + MASSABOX', consumption: 42,
    });
    expect(view.current().strap_sourcing).not.toHaveProperty(LINE_A);
    expect(view.current().strap_sourcing).toHaveProperty(LINE_B);
    expect(view.current().strap_colors[1]).toMatchObject({ base_group_id: SOFT, color_id: BLACK });
    await act(async () => { view.qc.setQueryData(['product_groups_colors'], [...GROUPS]); });
    expect(view.current().strap_colors[0].base_group_id).toBe(COMPOSITE);
  });

  it('limpa cor incompatível apenas da posição cujo material mudou', async () => {
    const warnings = vi.spyOn(console, 'warn');
    const user = userEvent.setup();
    const view = mount(initialItem(GOLD));
    await user.click(screen.getByRole('combobox', { name: 'Material de TIRA 1' }));
    await user.click(screen.getByRole('option', { name: 'NAPA SOFT + MASSABOX' }));
    await waitFor(() => expect(view.current().strap_colors[0].base_group_id).toBe(COMPOSITE));
    expect(view.current().strap_colors[0]).toMatchObject({ color_id: null, color: '' });
    expect(screen.getByRole('combobox', { name: 'Cor de TIRA 1' })).toHaveTextContent('Selecione a cor canônica');
    expect(screen.getByRole('combobox', { name: 'Cor de TIRA 1' })).not.toHaveTextContent('OURO');
    expect(view.current().strap_colors[1]).toMatchObject({ color_id: BLACK, base_group_id: SOFT });
    expect(view.current().strap_sourcing).not.toHaveProperty(LINE_A);
    expect(view.current().strap_sourcing).toHaveProperty(LINE_B);
    expect(warnings.mock.calls.flat().join(' ')).not.toContain('controlled to uncontrolled');
  });

  it('não oferece edição de material nem reidrata snapshot comprometido', () => {
    const initial = initialItem(GOLD);
    initial.strap_colors[0].base_group_name = 'NOME HISTÓRICO';
    const view = mount(initial, 'Em Produção');
    expect(screen.queryByRole('combobox', { name: 'Material de TIRA 1' })).not.toBeInTheDocument();
    expect(screen.getByText('Material: NOME HISTÓRICO')).toBeInTheDocument();
    expect(view.updates.mock.calls.filter(([field]) => field === 'strap_colors' || field === 'strap_sourcing')).toEqual([]);
    expect(view.current()).toEqual(initial);
  });

  it.each([true, false])('aguarda catálogo ausente (carregando=%s) sem apagar cor', loading => {
    state.loading = loading;
    state.catalog = undefined;
    const view = mount(initialItem());
    expect(screen.getByRole('combobox', { name: 'Material de TIRA 1' })).toBeDisabled();
    expect(view.current().strap_colors[0].color_id).toBe(BLACK);
  });

  it('renderiza lista de materiais malformada sem crash nem alternativa implícita', async () => {
    const user = userEvent.setup();
    const lines = technicalLines.map(line => ({
      ...line, allowed_material_group_ids: { [SOFT]: true } as unknown as string[],
    }));
    const initial = initialItem();
    initial.strap_colors = initial.strap_colors.map(line => ({
      ...line, allowed_material_group_ids: { [SOFT]: true } as unknown as string[],
    }));
    const view = mount(initial, 'Rascunho', lines);
    await user.click(screen.getByRole('combobox', { name: 'Material de TIRA 1' }));
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(view.current().strap_colors[0].base_group_id).toBeNull();
    expect(view.current().strap_colors[0].allowed_material_group_ids).toEqual({ [SOFT]: true });
  });
});

describe('SaleOrderItemForm — I703 com Overlock e Strass 6 mm', () => {
  const GLOW = '66666666-6666-4666-8666-666666666666';
  const STRASS = 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d';
  const STRASS_TYPE = '381eb21d-2170-45f7-ab7c-3601a8857ea9';
  const STRASS_MEASURE = '00f07325-347b-4e65-90e6-fed33f70eacc';
  const COPPER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const CRYSTAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const PINK = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const OFF_WHITE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const BLACK_BASE = 'abababab-abab-4bab-8bab-abababababab';
  const STRASS_COLORS = [
    { id: CRYSTAL, name: 'CRISTAL COM FUNDO BRANCO', active: true },
    { id: PINK, name: 'ROSADO COM FUNDO ROSADO', active: true },
    { id: OFF_WHITE, name: 'OFF WHITE', active: true },
    { id: BLACK_BASE, name: 'PRETO COM FUNDO PRETO', active: true },
  ];
  const products = [
    ...PRODUCTS,
    { id: 'glow-copper', group_id: GLOW, name: 'GLOW METALIC + MASSABOX COBRE', color: 'COBRE', active: true, unit: 'm' },
    { id: 'glow-gold', group_id: GLOW, name: 'GLOW METALIC + MASSABOX OURO', color: 'OURO', active: true, unit: 'm' },
    ...STRASS_COLORS.map(color => ({
      id: `strass-${color.id}`, group_id: STRASS, name: `TIRA STRASS 6MM ${color.name}`,
      color: color.name, active: true, unit: 'm',
    })),
    { id: 'strass-inactive', group_id: STRASS, name: 'TIRA STRASS 6MM OURO', color: 'OURO', active: false, unit: 'm' },
  ];
  const groups = [...GROUPS, { id: GLOW, name: 'GLOW METALIC + MASSABOX' }, { id: STRASS, name: 'TIRA STRASS 6MM' }];
  const lines: Array<NonNullable<SaleOrderItemFormData['strap_colors']>[number] & {
    internal_production_enabled: boolean;
  }> = [
    {
      ...technicalLines[0], color_mode: 'follow_main', material_mode: 'follow_reference',
      allowed_material_group_ids: [], internal_production_enabled: true,
      consumption: 44, consumption_per_size: { '34': 44 },
    },
    {
      ...technicalLines[1], strap_type_id: STRASS_TYPE, measure_id: STRASS_MEASURE,
      identity_basis: 'finished_product_group', identity_group_id: STRASS,
      color_mode: 'select_on_order', material_mode: 'follow_reference',
      allowed_material_group_ids: [], internal_production_enabled: false,
      consumption: 50, consumption_per_size: { '34': 50 },
    },
  ];

  function setup(legacy = false) {
    state.catalog = {
      ...state.catalog,
      products, groups,
      types: [{ id: TYPE, name: 'TIRA OVERLOCK', active: true }, { id: STRASS_TYPE, name: 'TIRA STRASS', active: true }],
      measures: [
        { id: MEASURE, strap_type_id: TYPE, display_name: '5 mm', active: true },
        { id: STRASS_MEASURE, strap_type_id: STRASS_TYPE, display_name: '6 mm', active: true },
      ],
      colors: [{ id: COPPER, name: 'COBRE', active: true }, { id: GOLD, name: 'OURO', active: true }, ...STRASS_COLORS],
      official_products: [],
      // OFF WHITE e PRETO também devem aparecer: são SKUs cadastrados,
      // mesmo que a compra pronta ainda precise completar sua variante.
      variants: STRASS_COLORS.slice(0, 2).map(color => ({
        id: `variant-${color.id}`, finished_product_id: `strass-${color.id}`,
        base_group_id: STRASS, identity_basis: 'finished_product_group',
        color_id: color.id, measure_id: STRASS_MEASURE, status: 'active',
      })),
    };
    const initial: SaleOrderItemFormData = {
      ...initialItem(), material_variant_id: GLOW, color: 'COBRE',
      strap_colors: lines.map((line, ordinal) => ({
        ...line,
        ...(ordinal === 0 || legacy ? {
          identity_basis: 'reference_base', identity_group_id: null,
          color_mode: 'follow_main', internal_production_enabled: true,
          base_group_id: GLOW, base_group_name: 'GLOW METALIC + MASSABOX',
        } : {}),
        color: 'COBRE', color_id: COPPER,
      })),
      strap_sourcing: {
        [LINE_A]: { source_mode: 'internal', color_id: COPPER, strap_variant_id: TYPE, recipe_id: MEASURE },
        [LINE_B]: { source_mode: 'internal', color_id: COPPER, strap_variant_id: STRASS_TYPE, recipe_id: STRASS_MEASURE },
      },
    };
    const variant = {
      id: GLOW, reference_id: REF, material_name: 'GLOW METALIC + MASSABOX', active: true,
      main_material_group_id: GLOW, upper_material_group_id: GLOW,
    } as ReferenceMaterialVariant;
    const options = { products, groups, variantsByRef: new Map([[REF, [variant]]]) };
    return { initial, options };
  }

  it('reconcilia a política da TIRA 2 por UUID e oferece somente os quatro produtos Strass ativos', async () => {
    const { initial, options } = setup(true);
    const user = userEvent.setup();
    const view = mount(initial, 'Rascunho', lines, options);
    await waitFor(() => expect(view.current().strap_colors[1]).toMatchObject({
      identity_basis: 'finished_product_group', identity_group_id: STRASS,
      color_mode: 'select_on_order', color: '', color_id: null,
      consumption: 50, consumption_per_size: { '34': 50 },
    }));
    expect(view.current().strap_colors[0]).toMatchObject({ color: 'COBRE', color_id: COPPER, base_group_id: GLOW, consumption: 44, consumption_per_size: { '34': 44 } });
    expect(view.current().strap_sourcing).toHaveProperty(LINE_A);
    expect(view.current().strap_sourcing).not.toHaveProperty(LINE_B);
    expect(screen.queryByRole('combobox', { name: 'Cor de TIRA 1' })).not.toBeInTheDocument();
    expect(screen.getByText('Tipo da ficha: TIRA STRASS · 6 mm')).toBeInTheDocument();
    expect(screen.getAllByText('Material: GLOW METALIC + MASSABOX')).toHaveLength(1);
    await user.click(screen.getByRole('combobox', { name: 'Cor de TIRA 2' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(STRASS_COLORS.map(color => color.name).sort());
    await user.click(screen.getByRole('option', { name: 'ROSADO COM FUNDO ROSADO' }));
    expect(view.current().strap_colors[1]).toMatchObject({ color_id: PINK, color: 'ROSADO COM FUNDO ROSADO', consumption: 50 });

    await act(async () => view.replace({ ...view.current(), color: 'OURO' }));
    await waitFor(() => expect(view.current().strap_colors[0].color_id).toBe(GOLD));
    expect(view.current().strap_colors[1]).toMatchObject({ color_id: PINK, color: 'ROSADO COM FUNDO ROSADO' });
  });

  it('limpa a cor de cabedal inválida em snapshot já classificado como Strass e exige selecionar sua cor', async () => {
    const { initial, options } = setup();
    const view = mount(initial, 'Rascunho', lines, options);
    await waitFor(() => expect(view.current().strap_colors[1]).toMatchObject({ color: '', color_id: null }));
    expect(view.current().strap_sourcing).not.toHaveProperty(LINE_B);
    expect(view.current().strap_sourcing).toHaveProperty(LINE_A);
    expect(view.colorIssues).toHaveBeenLastCalledWith(0, expect.objectContaining({ materials: expect.arrayContaining(['TIRA 2']) }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Cor de TIRA 2' }));
    expect(screen.queryByRole('option', { name: /COBRE/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'OFF WHITE' }));
    await waitFor(() => expect(view.colorIssues).toHaveBeenLastCalledWith(0, null));
  });

  it('aguarda o catálogo sem apagar uma escolha independente já salva', () => {
    const { initial, options } = setup();
    initial.strap_colors[1] = { ...initial.strap_colors[1], color: 'OFF WHITE', color_id: OFF_WHITE };
    state.loading = true;
    const view = mount(initial, 'Rascunho', lines, options);
    expect(view.current().strap_colors[1]).toMatchObject({ color: 'OFF WHITE', color_id: OFF_WHITE });
    expect(screen.getByRole('combobox', { name: 'Cor de TIRA 2' })).toBeDisabled();
  });

  it('preserva o snapshot e a origem de um pedido já comprometido', () => {
    const { initial, options } = setup(true);
    const view = mount(initial, 'Em Produção', lines, options);
    expect(view.current()).toEqual(initial);
    expect(view.updates.mock.calls.filter(([field]) => field === 'strap_colors' || field === 'strap_sourcing')).toEqual([]);
    expect(screen.queryByRole('combobox', { name: 'Cor de TIRA 2' })).not.toBeInTheDocument();
  });

  it('não anuncia produção automática quando falta o cadastro exato do material interno', () => {
    const { initial, options } = setup();
    state.strapLines = [{
      key: LINE_A,
      technicalStrapLineId: LINE_A,
      baseGroupId: GLOW,
      sourceMode: 'internal',
      internalBlockReason: 'Nenhum material/cor elegível para a receita interna.',
      blockReason: 'Nenhum material/cor elegível para a receita interna.',
    }];

    mount(initial, 'Rascunho', lines, options);

    expect(screen.getByText('Produção interna · cadastro pendente')).toBeInTheDocument();
    expect(screen.queryByText('Produção interna automática')).not.toBeInTheDocument();
  });

  it('usa um rótulo genérico quando a pendência interna não é de cadastro', () => {
    const { initial, options } = setup();
    state.strapLines = [{
      key: LINE_A,
      technicalStrapLineId: LINE_A,
      baseGroupId: GLOW,
      sourceMode: 'internal',
      internalBlockReason: null,
      blockReason: 'Cronograma global ainda não definido.',
    }];

    mount(initial, 'Rascunho', lines, options);

    expect(screen.getByText('Produção interna · pendência')).toBeInTheDocument();
    expect(screen.queryByText('Produção interna · cadastro pendente')).not.toBeInTheDocument();
  });
});

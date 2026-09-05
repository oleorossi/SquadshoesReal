import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SaleOrderItemForm from '../SaleOrderItemForm';
import type { SaleOrderItemFormData } from '@/hooks/useSaleOrders';

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

const state = vi.hoisted(() => ({ catalog: {} as Record<string, unknown>, loading: false }));
vi.mock('@/hooks/useAccessControl', () => ({ useAccessControl: () => ({ canSeeFinancialValues: false }) }));
vi.mock('@/hooks/useArtisanalStraps', () => ({
  useArtisanalStrapCatalog: () => ({ data: state.loading ? undefined : state.catalog, isLoading: state.loading }),
  useArtisanalStrapCatalogDiagnostics: () => ({ data: undefined }),
}));
vi.mock('@/hooks/useStrapStockLines', () => ({ useStrapStockLines: () => ({ data: [], isLoading: false }) }));
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
  { id: 'p-soft-black', group_id: SOFT, name: 'NAPA SOFT PRETO', color: 'PRETO', active: true },
  { id: 'p-soft-gold', group_id: SOFT, name: 'NAPA SOFT OURO', color: 'OURO', active: true },
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

function mount(initial: SaleOrderItemFormData, status = 'Rascunho', lines = technicalLines) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['sheet_specs_for_colors', REF], { upper_material: 'NAPA SOFT', upper_material_group_id: SOFT, has_straps: true });
  qc.setQueryData(['products_for_colors'], PRODUCTS);
  qc.setQueryData(['product_groups_colors'], GROUPS);
  let latest = initial;
  const updates = vi.fn();
  const referenceData = references.map(reference => ({ ...reference, strap_colors: lines }));
  function Harness() {
    const [item, setItem] = useState(initial);
    latest = item;
    return <SaleOrderItemForm
      item={item} index={0} references={referenceData} canRemove={false} isAdmin={false}
      saleOrderStatus={status} onRemove={vi.fn()}
      onUpdate={(_index, field, value) => {
        updates(field, value);
        setItem(current => ({ ...current, [field]: value }));
      }}
    />;
  }
  const view = render(<QueryClientProvider client={qc}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Harness /></MemoryRouter></QueryClientProvider>);
  return { ...view, current: () => latest, updates, qc };
}

beforeEach(() => {
  state.loading = false;
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

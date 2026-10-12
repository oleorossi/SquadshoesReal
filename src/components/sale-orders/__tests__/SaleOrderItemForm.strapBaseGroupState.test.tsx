import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SaleOrderItemForm from '@/components/sale-orders/SaleOrderItemForm';
import type { SaleOrderItemFormData } from '@/hooks/useSaleOrders';

/**
 * Contrato do dono (12/10/2026): "sem preview" NUNCA pode virar "a ficha não
 * identifica o material-base".
 *
 * Caso real: PV novo de S300 (variante GLOW METALIC, cor CHAMPAGNE). As 4 tiras
 * são `reference_base` + `follow_reference`, e o RPC
 * `preview_sale_order_strap_demand_draft` devolve `base_group_id = GLOW METALIC`
 * nas quatro. Mesmo assim a tela acusava a ficha de incompleta — porque a napa
 * dessa política só chega pelo preview, e a ausência de resposta era lida como
 * ausência de cadastro.
 *
 * ⚠ Teste de COMPORTAMENTO, não de texto no arquivo: monta o formulário e lê a
 * tela. Contrato que só confere se uma string existe no fonte já deixou rota
 * morta passar verde neste projeto (ver "a rota da 1ª cor" no CLAUDE.md).
 */

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

const state = vi.hoisted(() => ({
  catalog: {} as Record<string, unknown>,
  strapLines: [] as Array<Record<string, unknown>>,
  strapLinesFetched: false,
}));

vi.mock('@/hooks/useAccessControl', () => ({ useAccessControl: () => ({
  canSeeFinancialValues: false, can: () => false, roles: [], loading: false, permsLoading: false,
}) }));
vi.mock('@/components/sale-orders/SaleOrderStrapColorCreateDialog', () => ({ default: () => null }));
vi.mock('@/hooks/useArtisanalStraps', () => ({
  useArtisanalStrapCatalog: () => ({ data: state.catalog, isLoading: false }),
  useArtisanalStrapCatalogDiagnostics: () => ({ data: undefined }),
}));
vi.mock('@/hooks/useStrapStockLines', () => ({
  useStrapStockLines: () => ({
    data: state.strapLines,
    isLoading: false,
    isError: false,
    isFetched: state.strapLinesFetched,
  }),
}));
vi.mock('@/hooks/useInternalStrapReadiness', () => ({
  READY_FALLBACK: {
    requiresReferenceBase: false, ready: true, baseGroupId: null,
    baseGroupName: null, colorId: null, colorName: null, issues: [],
  },
  useInternalStrapReadiness: () => ({ data: undefined }),
}));
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
const LINE = '00000000-0000-4000-8000-000000000002';
const NAPA_SOFT = '11111111-1111-4111-8111-111111111111';
const GLOW = '99999999-9999-4999-8999-999999999999';
const TYPE = '44444444-4444-4444-8444-444444444444';
const MEASURE = '55555555-5555-4555-8555-555555555555';
const CHAMPAGNE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const BLAME = 'A ficha não identifica o material-base desta posição. Revise o cadastro técnico.';
const PREVIEW_MISSING = 'O estoque não respondeu por esta tira.';
const PENDING = 'Resolvendo material-base…';

/** Tira da S300: segue a referência, cor do cabedal. */
const technicalLines: NonNullable<SaleOrderItemFormData['strap_colors']> = [{
  id: LINE, technical_strap_line_id: LINE, label: 'TIRA 1',
  strap_type_id: TYPE, measure_id: MEASURE,
  identity_basis: 'reference_base', identity_group_id: null,
  color_mode: 'follow_main', material_mode: 'follow_reference',
  material_group_id: null, allowed_material_group_ids: [],
  consumption: 46, consumption_per_size: { '34': 46 },
  color: 'CHAMPAGNE', color_id: CHAMPAGNE, group_id: NAPA_SOFT, group_name: 'TIRA OVERLOCK 5MM',
}];

function item(): SaleOrderItemFormData {
  return {
    reference_id: REF, color: 'CHAMPAGNE', grade: { '34': 12 }, fichas: 35,
    quantity: 420, unit_price: 19.7,
    strap_colors: technicalLines.map((line) => ({ ...line })),
    strap_sourcing: {},
  };
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['sheet_specs_for_colors', REF], {
    upper_material: 'NAPA SOFT', upper_material_group_id: NAPA_SOFT, has_straps: true,
  });
  qc.setQueryData(['products_for_colors'], [
    { id: 'p-glow', group_id: GLOW, name: 'GLOW METALIC CHAMPAGNE', color: 'CHAMPAGNE', active: true, unit: 'm' },
  ]);
  qc.setQueryData(['product_groups_colors'], [
    { id: NAPA_SOFT, name: 'NAPA SOFT' }, { id: GLOW, name: 'GLOW METALIC' },
  ]);
  const references = [{
    id: REF, code: 'S300', name: 'S300', has_straps: true, sizes: '34-40',
    strap_colors: technicalLines,
  }];
  function Harness() {
    const [current, setCurrent] = useState(item());
    return <SaleOrderItemForm
      item={current} index={0} references={references} canRemove={false} isAdmin={false}
      saleOrderStatus="Rascunho" onRemove={vi.fn()}
      onUpdate={(_index, field, value) => setCurrent((prev) => ({ ...prev, [field]: value }))}
    />;
  }
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.strapLines = [];
  state.strapLinesFetched = false;
  state.catalog = {
    types: [{ id: TYPE, active: true, name: 'TIRA OVERLOCK' }],
    measures: [{ id: MEASURE, strap_type_id: TYPE, active: true, display_name: '5 mm' }],
    colors: [{ id: CHAMPAGNE, name: 'CHAMPAGNE', active: true }],
    groups: [], products: [], official_products: [], aliases: [], recipes: [],
    width_profiles: [], variants: [], legacy_recipes: [], capabilities: {},
  };
});

afterEach(() => { vi.restoreAllMocks(); });

describe('SaleOrderItemForm — napa-base da tira que segue a referência', () => {
  it('preview ainda não respondeu: não acusa a ficha', () => {
    state.strapLinesFetched = false;
    mount();
    expect(screen.queryByText(BLAME)).not.toBeInTheDocument();
    expect(screen.queryByText(/Contexto estrutural incompleto/)).not.toBeInTheDocument();
    expect(screen.queryByText('Corrigir no estoque')).not.toBeInTheDocument();
    expect(screen.getByText(PENDING)).toBeInTheDocument();
  });

  it('preview trouxe a napa: tela limpa', () => {
    state.strapLinesFetched = true;
    state.strapLines = [{ key: LINE, technicalStrapLineId: LINE, baseGroupId: GLOW, baseGroupName: 'GLOW METALIC' }];
    mount();
    expect(screen.queryByText(BLAME)).not.toBeInTheDocument();
    expect(screen.queryByText(PREVIEW_MISSING)).not.toBeInTheDocument();
    expect(screen.queryByText(PENDING)).not.toBeInTheDocument();
    expect(screen.queryByText(/Contexto estrutural incompleto/)).not.toBeInTheDocument();
  });

  it('preview respondeu sem linha para a tira: âmbar, sem culpar a ficha nem mandar ao estoque', () => {
    state.strapLinesFetched = true;
    state.strapLines = [];
    mount();
    expect(screen.queryByText(BLAME)).not.toBeInTheDocument();
    expect(screen.queryByText(/Contexto estrutural incompleto/)).not.toBeInTheDocument();
    expect(screen.queryByText('Corrigir no estoque')).not.toBeInTheDocument();
    expect(screen.getByText(PREVIEW_MISSING)).toBeInTheDocument();
    expect(screen.getByText(/O estoque não respondeu por 1 tira/)).toBeInTheDocument();
  });

  it('preview respondeu com napa nula: o alarme verdadeiro continua', () => {
    state.strapLinesFetched = true;
    state.strapLines = [{ key: LINE, technicalStrapLineId: LINE, baseGroupId: null, baseGroupName: null }];
    mount();
    expect(screen.getByText(BLAME)).toBeInTheDocument();
    expect(screen.getByText(/Contexto estrutural incompleto em 1 tira/)).toBeInTheDocument();
    expect(screen.queryByText(PREVIEW_MISSING)).not.toBeInTheDocument();
  });
});

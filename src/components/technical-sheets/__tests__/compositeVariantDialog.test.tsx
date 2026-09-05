import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MaterialVariantsTab } from '@/components/technical-sheets/MaterialVariantsTab';
import type { ReferenceMaterialVariant } from '@/hooks/useReferenceMaterialVariants';
import type { CompositeMaterialLayer } from '@/lib/compositeMaterialVariant';

interface TestProduct {
  id: string;
  name: string;
  group_id: string;
  color: string;
  active: boolean;
}

const mocks = vi.hoisted(() => ({
  variants: [] as Partial<ReferenceMaterialVariant>[],
  products: [] as TestProduct[],
  add: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue({}),
  duplicate: vi.fn().mockResolvedValue({}),
  error: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/hooks/useReferenceMaterialVariants', () => ({
  useReferenceMaterialVariants: () => ({ data: mocks.variants, isLoading: false }),
  useAddReferenceMaterialVariant: () => ({ mutateAsync: mocks.add, isPending: false }),
  useUpdateReferenceMaterialVariant: () => ({ mutateAsync: mocks.update, isPending: false }),
  useDuplicateReferenceMaterialVariant: () => ({ mutateAsync: mocks.duplicate, isPending: false }),
  useDeleteReferenceMaterialVariant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReorderReferenceMaterialVariants: () => ({ mutateAsync: vi.fn(), isPending: false }),
  findMaterialVariantSkuCollision: vi.fn().mockResolvedValue(null),
  MATERIAL_VARIANT_SKU_MAX_LENGTH: 80,
}));
vi.mock('@/hooks/useProducts', () => ({ useProducts: () => ({ data: mocks.products, isLoading: false, isError: false }) }));
vi.mock('@/hooks/useGroups', () => ({ useGroups: () => ({ data: groups, isLoading: false, isError: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from, rpc: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: vi.fn(), warning: vi.fn() } }));

const groups = [
  { id: 'napa', name: 'NAPA SOFT', sector: 'Cabedal' },
  { id: 'glow', name: 'GLOW METALLIC', sector: 'Componente' },
  { id: 'massabox', name: 'MASSA BOX', sector: 'Componente' },
  { id: 'base', name: 'NAPA SOFT + MASSA BOX', sector: 'Cabedal' },
  { id: 'target', name: 'GLOW METALLIC + MASSA BOX', sector: 'Cabedal' },
];
const baseLayers = [
  { composite_group_id: 'base', component_group_id: 'napa', is_color_source: true, display_order: 0 },
  { composite_group_id: 'base', component_group_id: 'massabox', component_label: 'MASSA BOX', is_color_source: false, display_order: 1 },
];
const targetLayers = [
  { composite_group_id: 'target', component_group_id: 'glow', is_color_source: true, display_order: 0 },
  { composite_group_id: 'target', component_group_id: 'massabox', is_color_source: false, display_order: 1 },
];

const variant = {
  id: 'variant-1', reference_id: 'sheet', material_name: 'GLOW METALLIC', sku: 'SP124-GLOW',
  active: true, display_order: 0, main_material_group_id: 'glow',
  upper_material_group_id: 'target', upper_material_product_id: null,
  lining_material_group_id: 'glow', lining_material_product_id: null,
};

function renderTab({ catalog = [...baseLayers, ...targetLayers], loading = false, liningFollows = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(['sheet_variant_cascade', 'sheet'], {
    upper_material: 'NAPA SOFT + MASSA BOX', upper_material_group_id: 'base', upper_material_product_id: null,
    lining_material: 'NAPA SOFT', lining_material_product_id: null,
    has_straps: false, primary_sole_id: null,
    variant_drives_upper: false, variant_drives_lining: liningFollows, variant_drives_fachete: false,
  });
  client.setQueryData(['product_group_layers', 'base'], baseLayers);
  client.setQueryData(['product_group_layers', 'target'], targetLayers);
  if (!loading) client.setQueryData(['product_group_layers', 'variant_catalog'], catalog);
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'product_group_layers') throw new Error(`Consulta inesperada: ${table}`);
    return {
      select: () => loading
        ? new Promise<{ data: CompositeMaterialLayer[]; error: null }>(() => {})
        : Promise.resolve({ data: catalog, error: null }),
    };
  });
  return render(<QueryClientProvider client={client}><MaterialVariantsTab sheetId="sheet" sheetCode="SP124" /></QueryClientProvider>);
}

async function pickGroup(label: string, name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  const options = await screen.findAllByRole('option');
  fireEvent.click(options.find(option => within(option).queryByText(name, { exact: true }))!);
}

async function submitDialog(name = 'Salvar Variante') {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.variants = [];
  mocks.products = groups.map(group => ({ id: `product-${group.id}`, name: group.name, group_id: group.id, color: 'PRETO', active: true }));
  Element.prototype.scrollIntoView = vi.fn();
});

describe('variante com Cabedal dublado · persistência pelo diálogo', () => {
  it('ao criar Glow grava o cabedal dublado e a forração Glow mesmo com flags desligadas', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Variante' }));
    await pickGroup('Material principal da variante', 'GLOW METALLIC');
    await submitDialog();
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({
      main_material_group_id: 'glow', upper_material_group_id: 'target', upper_material_product_id: null,
      lining_material_group_id: 'glow', lining_material_product_id: null, reference_id: 'sheet',
    })));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('ao editar e trocar o principal recalcula pins gerados da seleção anterior', async () => {
    mocks.variants = [{ ...variant }];
    renderTab();
    fireEvent.click(screen.getByTitle('Editar variante'));
    await pickGroup('Material principal da variante', 'NAPA SOFT');
    await submitDialog();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      id: variant.id,
      data: expect.objectContaining({ main_material_group_id: 'napa', upper_material_group_id: 'base', lining_material_group_id: 'napa' }),
    })));
  });

  it('ao duplicar e trocar o principal persiste os novos grupos nas sobrescritas', async () => {
    mocks.variants = [{ ...variant }];
    renderTab();
    fireEvent.click(screen.getByTitle('Duplicar variante (copia BOM específico)'));
    await pickGroup('Material principal da variante', 'NAPA SOFT');
    await submitDialog('Duplicar Variante');
    await waitFor(() => expect(mocks.duplicate).toHaveBeenCalledWith(expect.objectContaining({
      source_variant_id: variant.id,
      overrides: expect.objectContaining({ main_material_group_id: 'napa', upper_material_group_id: 'base', lining_material_group_id: 'napa', lining_material_product_id: null }),
    })));
  });

  it('bloqueia quando o dublado existe mas ainda não possui nenhum SKU ativo', async () => {
    mocks.products = mocks.products.filter(product => product.group_id !== 'target');
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Variante' }));
    await pickGroup('Material principal da variante', 'GLOW METALLIC');
    await submitDialog();
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('O material dublado ainda não tem cores cadastradas', undefined);
  });

  it('impede salvar enquanto o catálogo de composições está carregando', () => {
    renderTab({ loading: true });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Variante' }));
    expect(screen.getByRole('button', { name: 'Conferindo Cabedal…' })).toBeDisabled();
  });

  it('não permite perder o cabedal quando o catálogo está vazio mas a consulta da base prova que ele é composto', async () => {
    renderTab({ catalog: [], liningFollows: true });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Variante' }));
    await pickGroup('Material principal da variante', 'GLOW METALLIC');
    await submitDialog();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('ao duplicar, trocar o forro explicitamente também remove o produto legado que venceria o novo grupo', async () => {
    mocks.variants = [{ ...variant, lining_material_product_id: 'product-napa', lining_material_group_id: 'napa' }];
    renderTab();
    fireEvent.click(screen.getByTitle('Duplicar variante (copia BOM específico)'));
    await pickGroup('Grupo de forro', 'GLOW METALLIC');
    await submitDialog('Duplicar Variante');
    await waitFor(() => expect(mocks.duplicate).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({ lining_material_group_id: 'glow', lining_material_product_id: null }),
    })));
  });
});

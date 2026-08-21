import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  ArtisanalStrapCapabilities,
  ArtisanalStrapCatalog,
} from '@/hooks/useArtisanalStraps';
import { ArtisanalStrapEditor } from '../ArtisanalStrapEditor';

vi.mock('@/hooks/useArtisanalStraps', () => ({
  useSaveArtisanalStrapBundle: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ data: [] }),
}));

vi.mock('@/hooks/useContractors', () => ({
  useContractors: () => ({ data: [] }),
}));

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
    render(
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
 * A cor canônica da tira comprada pronta é DERIVADA do produto acabado e o
 * campo fica bloqueado. Pedir "Selecione a cor canônica." no save era um beco
 * sem saída: o operador não tinha como atender. O bloqueio precisa apontar o
 * passo executável.
 */
describe('ArtisanalStrapEditor — tira comprada pronta com cor derivada', () => {
  const renderBuyReady = (extra: Record<string, unknown> = {}) => render(
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

  it('anuncia que a cor não se escolhe ali e mantém o campo bloqueado', () => {
    renderBuyReady();
    expect(screen.getByText('Derivada do produto comprado pronto')).toBeInTheDocument();
    expect(screen.getByText(/vem do produto escolhido em/i)).toBeInTheDocument();
  });

  it('sem produto acabado, manda escolher o produto — não a cor', async () => {
    const user = userEvent.setup();
    renderBuyReady();

    await user.click(screen.getByRole('button', { name: /Salvar tudo/i }));

    expect(await screen.findByText(/Selecione o produto comprado pronto/i)).toBeInTheDocument();
    expect(screen.queryByText('Selecione a cor canônica.')).not.toBeInTheDocument();
  });

  it('com produto cuja cor não é canônica, nomeia a cor que falta cadastrar', async () => {
    const user = userEvent.setup();
    renderBuyReady({ finishedProductId: PRODUCT_ID });

    expect(screen.getByText('Cor do produto sem identidade canônica')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Salvar tudo/i }));

    expect(await screen.findAllByText(/CRISTAL COM FUNDO BRANCO/)).not.toHaveLength(0);
    expect(screen.queryByText('Selecione a cor canônica.')).not.toBeInTheDocument();
  });
});

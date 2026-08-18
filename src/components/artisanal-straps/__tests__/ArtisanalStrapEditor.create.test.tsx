import { render, screen } from '@testing-library/react';
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

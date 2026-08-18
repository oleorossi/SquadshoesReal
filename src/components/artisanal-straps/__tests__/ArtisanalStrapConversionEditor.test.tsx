import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ArtisanalStrapCapabilities,
  ArtisanalStrapCatalog,
} from '@/hooks/useArtisanalStraps';
import { ArtisanalStrapConversionEditor } from '../ArtisanalStrapConversionEditor';

vi.mock('@/hooks/useArtisanalStraps', () => ({
  useSaveArtisanalStrapConversion: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
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
  products: [],
  groups: [],
  capabilities,
};

describe('ArtisanalStrapConversionEditor', () => {
  it('cadastra a conversão sem solicitar cor ou produto de estoque', () => {
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={vi.fn()}
        catalog={emptyCatalog}
        capabilities={capabilities}
        mode="create"
        origin="hub"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Cadastrar conversão' })).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma cor é gravada aqui/i)).toBeInTheDocument();
    expect(screen.queryByText(/Cor canônica/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Produto e estoque/i)).not.toBeInTheDocument();
  });
});

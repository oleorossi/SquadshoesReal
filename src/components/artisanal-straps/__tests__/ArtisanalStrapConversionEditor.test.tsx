import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArtisanalStrapCapabilities,
  ArtisanalStrapCatalog,
} from '@/hooks/useArtisanalStraps';
import { ArtisanalStrapConversionEditor } from '../ArtisanalStrapConversionEditor';

const mutations = vi.hoisted(() => ({
  approveWidth: vi.fn(),
  reuseLegacy: vi.fn(),
  saveConversion: vi.fn(),
  saveWidth: vi.fn(),
}));

vi.mock('@/hooks/useArtisanalStraps', () => ({
  useSaveArtisanalStrapConversion: () => ({
    isPending: false,
    mutateAsync: mutations.saveConversion,
  }),
  useReuseLegacyArtisanalStrapRecipe: () => ({
    isPending: false,
    mutateAsync: mutations.reuseLegacy,
  }),
  useSaveBaseMaterialWidthProfile: () => ({
    isPending: false,
    mutateAsync: mutations.saveWidth,
  }),
  useApproveBaseMaterialWidthProfile: () => ({
    isPending: false,
    mutateAsync: mutations.approveWidth,
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
  legacy_recipes: [],
  products: [],
  groups: [],
  capabilities,
};

const catalogWithoutWidth: ArtisanalStrapCatalog = {
  ...emptyCatalog,
  types: [{ id: 'type-1', name: 'Tira chata', active: true }],
  measures: [{
    id: 'measure-1',
    strap_type_id: 'type-1',
    display_name: '8mm',
    finished_width_mm: 8,
    active: true,
  }],
  groups: [{ id: 'base-1', name: 'NAPA SOFT' }],
};

const catalogWithApprovedWidth: ArtisanalStrapCatalog = {
  ...catalogWithoutWidth,
  width_profiles: [{
    id: 'width-profile-approved',
    base_group_id: 'base-1',
    version: 2,
    usable_width_mm: 1370,
    status: 'approved',
  }],
};

const catalogWithLegacyRecipe: ArtisanalStrapCatalog = {
  ...catalogWithoutWidth,
  legacy_recipes: [{
    id: 'legacy-recipe-1',
    name: 'Receita Tira chata 8mm · NAPA SOFT',
    artisanal_product_name: 'Tira chata 8mm',
    base_product_name: 'NAPA SOFT',
    yield_per_meter: 60,
    labor_cost_per_meter: 0.5,
    base_time_minutes: 0,
    cut_width_mm: 20,
    default_contractor_id: null,
    notes: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    migration_status: 'review_required',
    canonical_recipe_id: null,
    migration_reason: null,
  }],
};

describe('ArtisanalStrapConversionEditor', () => {
  beforeEach(() => {
    mutations.approveWidth.mockReset().mockResolvedValue({});
    mutations.reuseLegacy.mockReset().mockResolvedValue({ recipe_id: 'recipe-reused' });
    mutations.saveConversion.mockReset().mockResolvedValue({ recipe_id: 'recipe-1' });
    mutations.saveWidth.mockReset().mockResolvedValue('width-profile-1');
  });

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

  it('permite preencher a largura pendente e aprova o perfil antes de salvar a conversão', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={onOpenChange}
        catalog={catalogWithoutWidth}
        capabilities={capabilities}
        mode="create"
        origin="hub"
        measureId="measure-1"
        baseGroupId="base-1"
      />,
    );

    const usefulWidth = screen.getByLabelText(/Largura útil da napa/i);
    expect(usefulWidth).toBeEnabled();
    expect(screen.getByText(/também será salvo e aprovado/i)).toBeInTheDocument();

    await user.type(usefulWidth, '1370');
    await user.type(screen.getByLabelText(/Largura da banda/i), '18');
    await user.type(screen.getByLabelText(/Rendimento confirmado/i), '68');
    await user.click(screen.getByRole('button', { name: /Salvar conversão/i }));

    await waitFor(() => expect(mutations.saveWidth).toHaveBeenCalledWith({
      id: undefined,
      baseGroupId: 'base-1',
      usableWidthMm: 1370,
      reason: 'Cadastro inicial da conversão',
    }));
    expect(mutations.approveWidth).toHaveBeenCalledWith({
      profileId: 'width-profile-1',
      reason: 'Cadastro inicial da conversão',
    });
    expect(mutations.saveConversion).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        recipe: expect.objectContaining({ base_width_profile_id: 'width-profile-1' }),
      }),
    }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    expect(mutations.saveWidth.mock.invocationCallOrder[0])
      .toBeLessThan(mutations.approveWidth.mock.invocationCallOrder[0]);
    expect(mutations.approveWidth.mock.invocationCallOrder[0])
      .toBeLessThan(mutations.saveConversion.mock.invocationCallOrder[0]);
  });

  it('preserva o perfil aprovado e salva somente a conversão', async () => {
    const user = userEvent.setup();
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={vi.fn()}
        catalog={catalogWithApprovedWidth}
        capabilities={capabilities}
        mode="create"
        origin="hub"
        measureId="measure-1"
        baseGroupId="base-1"
      />,
    );

    const usefulWidth = screen.getByLabelText(/Largura útil da napa/i);
    expect(usefulWidth).toBeDisabled();
    expect(usefulWidth).toHaveValue('1370');

    await user.type(screen.getByLabelText(/Largura da banda/i), '18');
    await user.type(screen.getByLabelText(/Rendimento confirmado/i), '68');
    await user.click(screen.getByRole('button', { name: /Salvar conversão/i }));

    await waitFor(() => expect(mutations.saveConversion).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        recipe: expect.objectContaining({ base_width_profile_id: 'width-profile-approved' }),
      }),
    })));
    expect(mutations.saveWidth).not.toHaveBeenCalled();
    expect(mutations.approveWidth).not.toHaveBeenCalled();
  });

  it('reaproveita uma receita anterior com dados herdados e exige a largura útil faltante', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={onOpenChange}
        catalog={catalogWithLegacyRecipe}
        capabilities={capabilities}
        mode="create"
        origin="hub"
        legacyRecipeId="legacy-recipe-1"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Reaproveitar receita anterior' })).toBeInTheDocument();
    expect(screen.getByText(/Dados recuperados do sistema anterior/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Largura da banda/i)).toHaveValue('20');
    expect(screen.getByLabelText(/Rendimento confirmado/i)).toHaveValue('60');

    await user.type(screen.getByLabelText(/Largura útil da napa/i), '1370');
    await user.click(screen.getByRole('button', { name: /Confirmar e ativar/i }));

    await waitFor(() => expect(mutations.reuseLegacy).toHaveBeenCalledWith({
      legacyRecipeId: 'legacy-recipe-1',
      payload: {
        type: { id: 'type-1' },
        measure: { id: 'measure-1' },
        base_group_id: 'base-1',
        recipe: {
          id: undefined,
          base_width_profile_id: undefined,
          cut_band_width_mm: 20,
          confirmed_yield_m_per_m: 60,
          executor_type: 'factory',
          default_contractor_id: null,
          transformation_cost_per_m: 0.5,
        },
      },
      usableWidthMm: 1370,
      editableWidthProfileId: undefined,
      reason: 'Reaproveitamento da receita anterior: Receita Tira chata 8mm · NAPA SOFT',
    }));
    expect(mutations.saveWidth).not.toHaveBeenCalled();
    expect(mutations.approveWidth).not.toHaveBeenCalled();
    expect(mutations.saveConversion).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

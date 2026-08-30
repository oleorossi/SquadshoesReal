import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArtisanalStrapCapabilities,
  ArtisanalStrapCatalog,
} from '@/hooks/useArtisanalStraps';
import { ArtisanalStrapConversionEditor } from '../ArtisanalStrapConversionEditor';

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

const mutations = vi.hoisted(() => ({
  approveWidth: vi.fn(),
  confirmConversion: vi.fn(),
  reuseLegacy: vi.fn(),
  saveConversion: vi.fn(),
  saveMaterialConversions: vi.fn(),
  saveWidth: vi.fn(),
}));

vi.mock('@/hooks/useArtisanalStraps', () => ({
  useSaveArtisanalStrapConversion: () => ({
    isPending: false,
    mutateAsync: mutations.saveConversion,
  }),
  useConfirmArtisanalStrapMaterialConversion: () => ({
    isPending: false,
    mutateAsync: mutations.confirmConversion,
  }),
  useSaveArtisanalStrapMaterialConversions: () => ({
    isPending: false,
    mutateAsync: mutations.saveMaterialConversions,
  }),
  useStrapBaseGroupCandidates: (enabled: boolean) => ({
    data: enabled ? [
      {
        id: 'base-1',
        name: 'NAPA SOFT',
        usable_width_mm: 1370,
        has_approved_width_profile: false,
        linear_sku_count: 43,
      },
      {
        id: 'base-2',
        name: 'NAPA SUDANI',
        usable_width_mm: 1200,
        has_approved_width_profile: true,
        linear_sku_count: 18,
      },
    ] : [],
    isLoading: false,
    isError: false,
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

const draftOnlyCapabilities: ArtisanalStrapCapabilities = {
  ...capabilities,
  approve_strap_recipe: false,
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
  groups: [
    { id: 'base-1', name: 'NAPA SOFT' },
    { id: 'base-2', name: 'NAPA SUDANI' },
  ],
};

const catalogWithApprovedWidth: ArtisanalStrapCatalog = {
  ...catalogWithoutWidth,
  width_profiles: [{
    id: 'width-profile-approved',
    base_group_id: 'base-1',
    version: 2,
    usable_width_mm: 1370,
    status: 'approved',
  }, {
    id: 'width-profile-sudani',
    base_group_id: 'base-2',
    version: 1,
    usable_width_mm: 1200,
    status: 'approved',
  }],
};

const catalogWithConfiguredMaterial: ArtisanalStrapCatalog = {
  ...catalogWithApprovedWidth,
  recipes: [{
    id: 'recipe-approved',
    measure_id: 'measure-1',
    base_group_id: 'base-1',
    base_width_profile_id: 'width-profile-approved',
    version: 1,
    usable_base_width_mm_snapshot: 1370,
    cut_band_width_mm: 18,
    theoretical_yield_m_per_m: 76,
    confirmed_yield_m_per_m: 68,
    executor_type: 'factory',
    default_contractor_id: null,
    transformation_cost_per_m: 0,
    status: 'approved',
  }, {
    id: 'recipe-archived',
    measure_id: 'measure-1',
    base_group_id: 'base-2',
    base_width_profile_id: 'width-profile-sudani',
    version: 1,
    usable_base_width_mm_snapshot: 1200,
    cut_band_width_mm: 20,
    theoretical_yield_m_per_m: 60,
    confirmed_yield_m_per_m: 55,
    executor_type: 'factory',
    default_contractor_id: null,
    transformation_cost_per_m: 0,
    status: 'archived',
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
    mutations.confirmConversion.mockReset().mockResolvedValue({ recipe_id: 'recipe-confirmed', status: 'approved' });
    mutations.reuseLegacy.mockReset().mockResolvedValue({ recipe_id: 'recipe-reused' });
    mutations.saveConversion.mockReset().mockResolvedValue({ recipe_id: 'recipe-1' });
    mutations.saveMaterialConversions.mockReset().mockResolvedValue({
      type_id: 'type-1',
      measure_id: 'measure-1',
      conversions: [{ base_group_id: 'base-1', recipe_id: 'recipe-1' }],
    });
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

    expect(screen.getByRole('heading', { name: 'Cadastrar tipo e materiais' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar outro material' })).toBeDisabled();
    expect(screen.getByText(/Nenhuma cor é gravada aqui/i)).toBeInTheDocument();
    expect(screen.queryByText(/Cor canônica/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Produto e estoque/i)).not.toBeInTheDocument();
  });

  it('puxa a largura física do estoque e confirma a conversão sem digitação manual', async () => {
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

    const usefulWidth = screen.getByLabelText(/Largura do material/i);
    expect(usefulWidth).toBeDisabled();
    expect(usefulWidth).toHaveValue('1370');
    expect(screen.getByText(/Largura encontrada no estoque/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Largura da banda/i), '18');
    await user.type(screen.getByLabelText(/Rendimento real/i), '68');
    await user.click(screen.getByRole('button', { name: /Confirmar rendimento e salvar/i }));

    await waitFor(() => expect(mutations.saveMaterialConversions).toHaveBeenCalledWith(expect.objectContaining({
      confirm: true,
      payload: expect.objectContaining({
        materials: [expect.objectContaining({
          base_group_id: 'base-1',
          recipe: expect.objectContaining({
            cut_band_width_mm: 18,
            confirmed_yield_m_per_m: 68,
          }),
        })],
      }),
    })));
    expect(mutations.saveWidth).not.toHaveBeenCalled();
    expect(mutations.approveWidth).not.toHaveBeenCalled();
    expect(mutations.saveConversion).not.toHaveBeenCalled();
    expect(mutations.confirmConversion).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
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

    const usefulWidth = screen.getByLabelText(/Largura do material/i);
    expect(usefulWidth).toBeDisabled();
    expect(usefulWidth).toHaveValue('1370');

    await user.type(screen.getByLabelText(/Largura da banda/i), '18');
    await user.type(screen.getByLabelText(/Rendimento real/i), '68');
    await user.click(screen.getByRole('button', { name: /Confirmar rendimento e salvar/i }));

    await waitFor(() => expect(mutations.saveMaterialConversions).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        materials: [expect.objectContaining({
          recipe: expect.objectContaining({ base_width_profile_id: 'width-profile-approved' }),
        })],
      }),
    })));
    expect(mutations.saveWidth).not.toHaveBeenCalled();
    expect(mutations.approveWidth).not.toHaveBeenCalled();
  });

  it('salva somente o rendimento real confirmado e não oferece entrada de perda percentual', async () => {
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

    await user.type(screen.getByLabelText(/Largura da banda/i), '18');
    expect(screen.queryByRole('button', { name: /Perda percentual/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Perda percentual/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Rendimento real confirmado/i), '68');

    await user.click(screen.getByRole('button', { name: /Confirmar rendimento e salvar/i }));

    await waitFor(() => expect(mutations.saveMaterialConversions).toHaveBeenCalledTimes(1));
    const recipePayload = mutations.saveMaterialConversions.mock.calls[0][0].payload.materials[0].recipe;
    expect(recipePayload.confirmed_yield_m_per_m).toBe(68);
    expect(recipePayload).not.toHaveProperty('loss_percentage');
    expect(recipePayload).not.toHaveProperty('waste_pct');
  });

  it('confirma vários materiais da mesma tira com rendimentos independentes', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={onOpenChange}
        catalog={catalogWithApprovedWidth}
        capabilities={capabilities}
        mode="create"
        origin="hub"
        measureId="measure-1"
      />,
    );

    await user.click(screen.getByLabelText(/Material possível/i));
    await user.click(screen.getByRole('option', { name: /NAPA SOFT/i }));
    await user.type(screen.getByLabelText(/Largura da banda/i), '18');
    await user.type(screen.getByLabelText(/Rendimento real confirmado/i), '68');

    await user.click(screen.getByRole('button', { name: 'Adicionar outro material' }));
    const materialSelects = screen.getAllByLabelText(/Material possível/i);
    await user.click(materialSelects[1]);
    await user.click(screen.getByRole('option', { name: /NAPA SUDANI/i }));
    const cutBandInputs = screen.getAllByLabelText(/Largura da banda/i);
    const yieldInputs = screen.getAllByLabelText(/Rendimento real confirmado/i);
    await user.type(cutBandInputs[1], '20');
    await user.type(yieldInputs[1], '55');

    await user.click(screen.getByRole('button', { name: 'Confirmar 2 rendimentos e salvar' }));

    await waitFor(() => expect(mutations.saveMaterialConversions).toHaveBeenCalledWith({
      reason: 'Cadastro inicial da conversão',
      confirm: true,
      payload: {
        type: { id: 'type-1' },
        measure: { id: 'measure-1' },
        materials: [{
          base_group_id: 'base-1',
          recipe: {
            base_width_profile_id: 'width-profile-approved',
            cut_band_width_mm: 18,
            confirmed_yield_m_per_m: 68,
            executor_type: 'factory',
            default_contractor_id: null,
            transformation_cost_per_m: 0,
          },
        }, {
          base_group_id: 'base-2',
          recipe: {
            base_width_profile_id: 'width-profile-sudani',
            cut_band_width_mm: 20,
            confirmed_yield_m_per_m: 55,
            executor_type: 'factory',
            default_contractor_id: null,
            transformation_cost_per_m: 0,
          },
        }],
      },
    }));
    expect(mutations.saveMaterialConversions).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('valida todos os materiais antes de iniciar o salvamento do lote', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={onOpenChange}
        catalog={catalogWithApprovedWidth}
        capabilities={capabilities}
        mode="create"
        origin="hub"
        measureId="measure-1"
      />,
    );

    await user.click(screen.getByLabelText(/Material possível/i));
    await user.click(screen.getByRole('option', { name: /NAPA SOFT/i }));
    await user.type(screen.getByLabelText(/Largura da banda/i), '18');
    await user.type(screen.getByLabelText(/Rendimento real confirmado/i), '68');
    await user.click(screen.getByRole('button', { name: 'Adicionar outro material' }));
    await user.click(screen.getAllByLabelText(/Material possível/i)[1]);
    await user.click(screen.getByRole('option', { name: /NAPA SUDANI/i }));

    await user.click(screen.getByRole('button', { name: 'Confirmar 2 rendimentos e salvar' }));

    expect(await screen.findByText(/NAPA SUDANI: o rendimento confirmado/i)).toBeInTheDocument();
    expect(mutations.saveMaterialConversions).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('impede recadastrar material atual, mas libera associação já arquivada', async () => {
    const user = userEvent.setup();
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={vi.fn()}
        catalog={catalogWithConfiguredMaterial}
        capabilities={capabilities}
        mode="create"
        origin="hub"
        measureId="measure-1"
      />,
    );

    await user.click(screen.getByLabelText(/Material possível/i));

    expect(screen.getByRole('option', { name: /NAPA SOFT · já cadastrado/i }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: /NAPA SUDANI/i }))
      .not.toHaveAttribute('aria-disabled', 'true');
  });

  it('salva todas as linhas como rascunho quando o usuário não pode aprovar', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={onOpenChange}
        catalog={{ ...catalogWithApprovedWidth, capabilities: draftOnlyCapabilities }}
        capabilities={draftOnlyCapabilities}
        mode="create"
        origin="hub"
        measureId="measure-1"
        baseGroupId="base-1"
      />,
    );

    await user.type(screen.getByLabelText(/Largura da banda/i), '18');
    await user.type(screen.getByLabelText(/Rendimento real confirmado/i), '68');
    await user.click(screen.getByRole('button', { name: 'Salvar conversão' }));

    await waitFor(() => expect(mutations.saveMaterialConversions).toHaveBeenCalledWith(
      expect.objectContaining({ confirm: false }),
    ));
    expect(mutations.confirmConversion).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
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
    expect(screen.getByLabelText(/Rendimento real/i)).toHaveValue('60');

    await user.type(screen.getByLabelText(/Largura do material/i), '1370');
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
    expect(mutations.saveMaterialConversions).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

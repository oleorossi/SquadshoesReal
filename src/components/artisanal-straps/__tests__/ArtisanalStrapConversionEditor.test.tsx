import { act, render, screen, waitFor } from '@testing-library/react';
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

const mutationState = vi.hoisted(() => ({
  approveWidth: false,
  confirmConversion: false,
  reuseLegacy: false,
  saveConversion: false,
  saveMaterialConversions: false,
  saveWidth: false,
}));

vi.mock('@/hooks/useArtisanalStraps', () => ({
  useSaveArtisanalStrapConversion: () => ({
    isPending: mutationState.saveConversion,
    mutateAsync: mutations.saveConversion,
  }),
  useConfirmArtisanalStrapMaterialConversion: () => ({
    isPending: mutationState.confirmConversion,
    mutateAsync: mutations.confirmConversion,
  }),
  useSaveArtisanalStrapMaterialConversions: () => ({
    isPending: mutationState.saveMaterialConversions,
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
    isPending: mutationState.reuseLegacy,
    mutateAsync: mutations.reuseLegacy,
  }),
  useSaveBaseMaterialWidthProfile: () => ({
    isPending: mutationState.saveWidth,
    mutateAsync: mutations.saveWidth,
  }),
  useApproveBaseMaterialWidthProfile: () => ({
    isPending: mutationState.approveWidth,
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

const noFinancialCapabilities: ArtisanalStrapCapabilities = {
  ...capabilities,
  can_see_financial_values: false,
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

const catalogWithDraftRecipe: ArtisanalStrapCatalog = {
  ...catalogWithApprovedWidth,
  recipes: [{
    id: 'recipe-draft',
    measure_id: 'measure-1',
    base_group_id: 'base-1',
    base_width_profile_id: 'width-profile-approved',
    version: 2,
    usable_base_width_mm_snapshot: 1370,
    cut_band_width_mm: 18,
    theoretical_yield_m_per_m: 76,
    confirmed_yield_m_per_m: 68,
    executor_type: 'factory',
    default_contractor_id: null,
    transformation_cost_per_m: 0.45,
    status: 'draft',
  }],
};

const catalogWithPendingRecipe: ArtisanalStrapCatalog = {
  ...catalogWithDraftRecipe,
  recipes: catalogWithDraftRecipe.recipes.map((recipe) => ({
    ...recipe,
    id: 'recipe-pending',
    status: 'pending_approval',
  })),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
    Object.keys(mutationState).forEach((key) => {
      mutationState[key as keyof typeof mutationState] = false;
    });
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

  it('aguarda o catálogo carregar antes de inicializar a sessão contextual', () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      capabilities,
      mode: 'create' as const,
      origin: 'hub' as const,
      measureId: 'measure-1',
      baseGroupId: 'base-1',
    };
    const { rerender } = render(
      <ArtisanalStrapConversionEditor {...props} catalog={emptyCatalog} />,
    );

    expect(screen.getByLabelText(/Largura da banda/i)).toHaveValue('');

    rerender(
      <ArtisanalStrapConversionEditor {...props} catalog={catalogWithConfiguredMaterial} />,
    );

    expect(screen.getByRole('heading', { name: 'Cadastrar tipo e material' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Largura da banda/i)).toHaveValue('18');
    expect(screen.getByLabelText(/Rendimento real confirmado/i)).toHaveValue('68');
    expect(screen.getByRole('button', { name: 'Criar nova versão' })).toBeInTheDocument();
  });

  it('bloqueia um contexto ainda não inicializado para não sobrescrever edição transitória', () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      capabilities,
      mode: 'create' as const,
      origin: 'hub' as const,
      measureId: 'measure-1',
    };
    const { rerender } = render(
      <ArtisanalStrapConversionEditor {...props} catalog={emptyCatalog} />,
    );

    expect(screen.getByLabelText(/Material possível/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /Confirmar rendimento e salvar/i })).toBeDisabled();

    rerender(
      <ArtisanalStrapConversionEditor {...props} catalog={catalogWithApprovedWidth} />,
    );

    expect(screen.getByLabelText(/Material possível/i)).toBeEnabled();

    rerender(
      <ArtisanalStrapConversionEditor
        {...props}
        recipeId="recipe-ainda-carregando"
        catalog={catalogWithApprovedWidth}
      />,
    );

    expect(screen.getByLabelText(/Material possível/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /Confirmar rendimento e salvar/i })).toBeDisabled();
  });

  it('preserva todas as linhas não salvas quando o catálogo é atualizado', async () => {
    const user = userEvent.setup();
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      capabilities,
      mode: 'create' as const,
      origin: 'hub' as const,
      measureId: 'measure-1',
    };
    const { rerender } = render(
      <ArtisanalStrapConversionEditor {...props} catalog={catalogWithApprovedWidth} />,
    );

    await user.click(screen.getByLabelText(/Material possível/i));
    await user.click(screen.getByRole('option', { name: /NAPA SOFT/i }));
    await user.type(screen.getByLabelText(/Largura da banda/i), '18');
    await user.type(screen.getByLabelText(/Rendimento real confirmado/i), '68');
    await user.click(screen.getByRole('button', { name: 'Adicionar outro material' }));
    await user.click(screen.getAllByLabelText(/Material possível/i)[1]);
    await user.click(screen.getByRole('option', { name: /NAPA SUDANI/i }));
    await user.type(screen.getAllByLabelText(/Largura da banda/i)[1], '20');
    await user.type(screen.getAllByLabelText(/Rendimento real confirmado/i)[1], '55');

    rerender(
      <ArtisanalStrapConversionEditor
        {...props}
        catalog={{
          ...catalogWithApprovedWidth,
          width_profiles: [...catalogWithApprovedWidth.width_profiles],
        }}
      />,
    );

    expect(screen.getAllByLabelText(/Material possível/i)).toHaveLength(2);
    expect(screen.getAllByLabelText(/Largura da banda/i)[0]).toHaveValue('18');
    expect(screen.getAllByLabelText(/Largura da banda/i)[1]).toHaveValue('20');
    expect(screen.getAllByLabelText(/Rendimento real confirmado/i)[0]).toHaveValue('68');
    expect(screen.getAllByLabelText(/Rendimento real confirmado/i)[1]).toHaveValue('55');
  });

  it('bloqueia toda interação durante o lote e preserva os dados quando a requisição falha', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const request = deferred<{
      type_id: string;
      measure_id: string;
      conversions: Array<{ base_group_id: string; recipe_id: string }>;
    }>();
    mutations.saveMaterialConversions.mockReturnValueOnce(request.promise);
    const editor = () => (
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={onOpenChange}
        catalog={catalogWithApprovedWidth}
        capabilities={capabilities}
        mode="create"
        origin="hub"
        measureId="measure-1"
        baseGroupId="base-1"
      />
    );
    const { rerender } = render(editor());

    await user.type(screen.getByLabelText(/Largura da banda/i), '18');
    await user.type(screen.getByLabelText(/Rendimento real confirmado/i), '68');
    await user.click(screen.getByRole('button', { name: /Confirmar rendimento e salvar/i }));
    await waitFor(() => expect(mutations.saveMaterialConversions).toHaveBeenCalledTimes(1));

    mutationState.saveMaterialConversions = true;
    rerender(editor());

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeDisabled();
    expect(screen.getByLabelText(/Material possível/i)).toBeDisabled();
    expect(screen.getByLabelText(/Largura da banda/i)).toBeDisabled();
    expect(screen.getByLabelText(/Rendimento real confirmado/i)).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    mutationState.saveMaterialConversions = false;
    await act(async () => {
      request.reject(new Error('Falha transacional simulada'));
      await request.promise.catch(() => undefined);
    });

    expect(await screen.findByText('Falha transacional simulada')).toBeInTheDocument();
    expect(screen.getByLabelText(/Largura da banda/i)).toHaveValue('18');
    expect(screen.getByLabelText(/Largura da banda/i)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('explica por que outra linha não pode ser adicionada e não cria linhas vazias em sequência', async () => {
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
      />,
    );

    const addButton = screen.getByRole('button', { name: 'Adicionar outro material' });
    expect(addButton).toBeDisabled();
    expect(screen.getByText(/Selecione o material da linha atual/i)).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Material possível/i));
    await user.click(screen.getByRole('option', { name: /NAPA SOFT/i }));
    expect(addButton).toBeEnabled();
    await user.click(addButton);

    expect(addButton).toBeDisabled();
    expect(screen.getByText(/Selecione o material da linha atual/i)).toBeInTheDocument();
    await user.click(screen.getAllByLabelText(/Material possível/i)[1]);
    await user.click(screen.getByRole('option', { name: /NAPA SUDANI/i }));
    expect(addButton).toBeDisabled();
    expect(screen.getByText(/Não há outro material elegível/i)).toBeInTheDocument();
  });

  it('bloqueia um cadastro novo antes do preenchimento quando falta acesso financeiro', () => {
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={vi.fn()}
        catalog={{ ...catalogWithApprovedWidth, capabilities: noFinancialCapabilities }}
        capabilities={noFinancialCapabilities}
        mode="create"
        origin="hub"
        measureId="measure-1"
      />,
    );

    expect(screen.getByText('Acesso financeiro necessário')).toBeInTheDocument();
    expect(screen.getByLabelText(/Material possível/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Salvar|Confirmar rendimento/i })).not.toBeInTheDocument();
  });

  it('permite editar um rascunho sem revelar ou sobrescrever o custo oculto', async () => {
    const user = userEvent.setup();
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={vi.fn()}
        catalog={{ ...catalogWithDraftRecipe, capabilities: noFinancialCapabilities }}
        capabilities={noFinancialCapabilities}
        mode="edit"
        origin="hub"
        recipeId="recipe-draft"
      />,
    );

    expect(screen.queryByLabelText(/Custo de transformação/i)).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Rendimento real confirmado/i));
    await user.type(screen.getByLabelText(/Rendimento real confirmado/i), '67');
    await user.type(screen.getByLabelText(/Motivo da alteração/i), 'Ajuste do rendimento medido');
    await user.click(screen.getByRole('button', { name: 'Salvar conversão' }));

    await waitFor(() => expect(mutations.saveConversion).toHaveBeenCalledTimes(1));
    const recipePayload = mutations.saveConversion.mock.calls[0][0].payload.recipe;
    expect(recipePayload.id).toBe('recipe-draft');
    expect(recipePayload.confirmed_yield_m_per_m).toBe(67);
    expect(recipePayload).not.toHaveProperty('transformation_cost_per_m');
  });

  it('antecipa a necessidade de aprovar o perfil físico', async () => {
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={vi.fn()}
        catalog={{ ...catalogWithoutWidth, capabilities: draftOnlyCapabilities }}
        capabilities={draftOnlyCapabilities}
        mode="create"
        origin="hub"
        measureId="measure-1"
        baseGroupId="base-1"
      />,
    );

    expect(screen.getByText('Perfil físico requer aprovação')).toBeInTheDocument();
    expect(screen.getByLabelText(/Largura da banda/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvar conversão' })).toBeDisabled();
  });

  it('usa o fluxo singular de nova versão quando medida e material já possuem receita', async () => {
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
        baseGroupId="base-1"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Cadastrar tipo e material' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar outro material' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar rendimento e salvar/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Criar nova versão' }));
    expect(screen.getByText('Nova versão em rascunho')).toBeInTheDocument();
    expect(screen.getByLabelText(/Motivo da alteração/i)).toHaveValue('Nova versão da conversão');
    await user.clear(screen.getByLabelText(/Rendimento real confirmado/i));
    await user.type(screen.getByLabelText(/Rendimento real confirmado/i), '67');
    await user.click(screen.getByRole('button', { name: /Confirmar rendimento e salvar/i }));

    await waitFor(() => expect(mutations.confirmConversion).toHaveBeenCalledTimes(1));
    expect(mutations.saveMaterialConversions).not.toHaveBeenCalled();
    expect(mutations.confirmConversion.mock.calls[0][0].payload.recipe.id).toBeUndefined();
  });

  it('mantém a sugestão de rendimento no fluxo explícito de nova versão', async () => {
    const user = userEvent.setup();
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={vi.fn()}
        catalog={catalogWithConfiguredMaterial}
        capabilities={capabilities}
        mode="edit"
        origin="hub"
        recipeId="recipe-approved"
        suggestedRecipeId="recipe-approved"
        suggestedYieldMPerM={65}
      />,
    );

    expect(screen.getByText('Nova versão em rascunho')).toBeInTheDocument();
    expect(screen.getByLabelText(/Rendimento real confirmado/i)).toHaveValue('65');
    expect(screen.getByLabelText(/Motivo da alteração/i))
      .toHaveValue('Nova versão baseada no rendimento realizado de 65 m/m');
    await user.click(screen.getByRole('button', { name: 'Salvar conversão' }));

    await waitFor(() => expect(mutations.saveConversion).toHaveBeenCalledTimes(1));
    expect(mutations.saveConversion.mock.calls[0][0].payload.recipe.id).toBeUndefined();
  });

  it('trata review como consulta e não rebaixa uma receita pendente para rascunho', () => {
    render(
      <ArtisanalStrapConversionEditor
        open
        onOpenChange={vi.fn()}
        catalog={catalogWithPendingRecipe}
        capabilities={capabilities}
        mode="review"
        origin="hub"
        recipeId="recipe-pending"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Consultar conversão em revisão' })).toBeInTheDocument();
    expect(screen.getByText('Revisão em modo de consulta')).toBeInTheDocument();
    expect(screen.getByLabelText(/Largura da banda/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Salvar conversão/i })).not.toBeInTheDocument();
    expect(mutations.saveConversion).not.toHaveBeenCalled();
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

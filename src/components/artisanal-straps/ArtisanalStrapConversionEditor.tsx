import { useEffect, useRef, useState } from 'react';
import {
  ClockCounterClockwise,
  Factory,
  FloppyDisk,
  LockKey,
  Plus,
  Ruler,
  Scissors,
  Trash,
  Warning,
} from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useContractors } from '@/hooks/useContractors';
import {
  type ArtisanalStrapCapabilities,
  type ArtisanalStrapCatalog,
  useApproveBaseMaterialWidthProfile,
  useConfirmArtisanalStrapMaterialConversion,
  useReuseLegacyArtisanalStrapRecipe,
  useSaveBaseMaterialWidthProfile,
  useSaveArtisanalStrapConversion,
  useSaveArtisanalStrapMaterialConversions,
  useStrapBaseGroupCandidates,
} from '@/hooks/useArtisanalStraps';
import type { ArtisanalStrapEditorMode, ArtisanalStrapEditorOrigin } from './ArtisanalStrapEditor';
import { StrapIdentityTrail } from './StrapIdentityTrail';

interface ArtisanalStrapConversionEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: ArtisanalStrapCatalog;
  capabilities: ArtisanalStrapCapabilities;
  mode: ArtisanalStrapEditorMode;
  origin: ArtisanalStrapEditorOrigin;
  recipeId?: string | null;
  measureId?: string | null;
  baseGroupId?: string | null;
  suggestedRecipeId?: string | null;
  suggestedYieldMPerM?: number | null;
  legacyRecipeId?: string | null;
}

interface MaterialConversionForm {
  rowId: string;
  baseGroupId: string;
  recipeId: string;
  usefulWidthMm: number;
  cutBandWidthMm: number;
  confirmedYield: number;
  executorType: 'factory' | 'contractor';
  contractorId: string;
  transformationCost: number;
}

interface ConversionForm {
  typeId: string;
  typeName: string;
  measureId: string;
  measureName: string;
  finishedWidthMm: number;
  reason: string;
  materials: MaterialConversionForm[];
}

function emptyMaterialForm(rowId = 'material-1'): MaterialConversionForm {
  return {
    rowId,
    baseGroupId: '',
    recipeId: '',
    usefulWidthMm: 0,
    cutBandWidthMm: 0,
    confirmedYield: 0,
    executorType: 'factory',
    contractorId: '',
    transformationCost: 0,
  };
}

function emptyForm(): ConversionForm {
  return {
    typeId: '',
    typeName: '',
    measureId: '',
    measureName: '',
    finishedWidthMm: 0,
    reason: '',
    materials: [emptyMaterialForm()],
  };
}

function materialForm(
  values: Partial<Omit<MaterialConversionForm, 'rowId'>>,
  rowId = 'material-1',
): MaterialConversionForm {
  return {
    ...emptyMaterialForm(rowId),
    ...values,
  };
}

const EMPTY_MATERIAL_FORM: MaterialConversionForm = {
  rowId: 'material-empty',
  baseGroupId: '',
  recipeId: '',
  usefulWidthMm: 0,
  cutBandWidthMm: 0,
  confirmedYield: 0,
  executorType: 'factory',
  contractorId: '',
  transformationCost: 0,
};

const ORIGIN_LABEL: Record<ArtisanalStrapEditorOrigin, string> = {
  hub: 'Hub de Tiras',
  estoque: 'Estoque',
  grupos: 'Grupos',
  compras: 'Compras',
  terceirizados: 'Terceirizados',
  pv: 'Pedido de venda',
};

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedIdentity(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function widthFromLegacyName(value: string) {
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*mm\b/i);
  return match ? numberOrZero(match[1].replace(',', '.')) : 0;
}

function typeNameFromLegacy(value: string) {
  return value.replace(/\s*\d+(?:[.,]\d+)?\s*mm\b.*$/i, '').trim();
}

function latestWidthProfile(
  catalog: ArtisanalStrapCatalog,
  baseGroupId: string,
  statuses: string[],
) {
  return catalog.width_profiles
    .filter((item) => item.base_group_id === baseGroupId && statuses.includes(item.status))
    .sort((left, right) => Number(right.version) - Number(left.version))[0];
}

function mutationErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Não foi possível salvar a largura útil e a conversão.';
}

export function ArtisanalStrapConversionEditor({
  open,
  onOpenChange,
  catalog,
  capabilities,
  mode,
  origin,
  recipeId,
  measureId,
  baseGroupId,
  suggestedRecipeId,
  suggestedYieldMPerM,
  legacyRecipeId,
}: ArtisanalStrapConversionEditorProps) {
  const [form, setForm] = useState<ConversionForm>(() => emptyForm());
  const [validationError, setValidationError] = useState<string | null>(null);
  const [createRecipeVersion, setCreateRecipeVersion] = useState(false);
  const nextMaterialRowId = useRef(1);
  const saveWidthProfile = useSaveBaseMaterialWidthProfile();
  const approveWidthProfile = useApproveBaseMaterialWidthProfile();
  const saveConversion = useSaveArtisanalStrapConversion();
  const confirmConversion = useConfirmArtisanalStrapMaterialConversion();
  const saveMaterialConversions = useSaveArtisanalStrapMaterialConversions();
  const reuseLegacyRecipe = useReuseLegacyArtisanalStrapRecipe();
  const baseCandidatesQuery = useStrapBaseGroupCandidates(open && !legacyRecipeId);
  const { data: contractors = [] } = useContractors();

  useEffect(() => {
    if (!open) return;
    const legacyRecipe = catalog.legacy_recipes.find((item) => item.id === legacyRecipeId);
    if (legacyRecipe) {
      const legacyProductIdentity = normalizedIdentity(legacyRecipe.artisanal_product_name);
      const legacyWidthMm = widthFromLegacyName(legacyRecipe.artisanal_product_name);
      const suggestedType = catalog.types
        .filter((item) => item.active && legacyProductIdentity.includes(normalizedIdentity(item.name)))
        .sort((left, right) => normalizedIdentity(right.name).length - normalizedIdentity(left.name).length)[0];
      const suggestedMeasure = suggestedType
        ? catalog.measures.find((item) => (
            item.active
            && item.strap_type_id === suggestedType.id
            && legacyWidthMm > 0
            && Math.abs(numberOrZero(item.finished_width_mm) - legacyWidthMm) < 0.000001
          ))
        : undefined;
      const suggestedBase = catalog.groups.find((item) => (
        normalizedIdentity(item.name) === normalizedIdentity(legacyRecipe.base_product_name)
      ));
      const selectedWidthProfile = suggestedBase
        ? latestWidthProfile(catalog, suggestedBase.id, ['approved'])
          || latestWidthProfile(catalog, suggestedBase.id, ['draft', 'pending_approval'])
        : undefined;
      const fallbackTypeName = typeNameFromLegacy(legacyRecipe.artisanal_product_name);

      setForm({
        ...emptyForm(),
        typeId: suggestedType?.id || '',
        typeName: suggestedType?.name || fallbackTypeName,
        measureId: suggestedMeasure?.id || '',
        measureName: suggestedMeasure?.display_name || (legacyWidthMm > 0 ? `${legacyWidthMm}mm` : ''),
        finishedWidthMm: numberOrZero(suggestedMeasure?.finished_width_mm) || legacyWidthMm,
        reason: `Reaproveitamento da receita anterior: ${legacyRecipe.name}`,
        materials: [materialForm({
          baseGroupId: suggestedBase?.id || '',
          usefulWidthMm: numberOrZero(selectedWidthProfile?.usable_width_mm),
          cutBandWidthMm: numberOrZero(legacyRecipe.cut_width_mm),
          confirmedYield: numberOrZero(legacyRecipe.yield_per_meter),
          executorType: legacyRecipe.default_contractor_id ? 'contractor' : 'factory',
          contractorId: legacyRecipe.default_contractor_id || '',
          transformationCost: numberOrZero(legacyRecipe.labor_cost_per_meter),
        })],
      });
      setCreateRecipeVersion(false);
      setValidationError(null);
      return;
    }
    const directRecipe = catalog.recipes.find((item) => (
      item.id === (suggestedRecipeId || recipeId)
    ));
    const selectedMeasureId = directRecipe?.measure_id || measureId || '';
    const selectedBaseGroupId = directRecipe?.base_group_id || baseGroupId || '';
    const fallbackRecipe = !directRecipe && selectedMeasureId && selectedBaseGroupId
      ? catalog.recipes
        .filter((item) => (
          item.measure_id === selectedMeasureId && item.base_group_id === selectedBaseGroupId
        ))
        .sort((left, right) => Number(right.version) - Number(left.version))[0]
      : undefined;
    const selectedRecipe = directRecipe || fallbackRecipe;
    const selectedMeasure = catalog.measures.find((item) => item.id === selectedMeasureId);
    const selectedType = catalog.types.find((item) => item.id === selectedMeasure?.strap_type_id);
    const selectedWidthProfile = latestWidthProfile(catalog, selectedBaseGroupId, ['approved'])
      || latestWidthProfile(catalog, selectedBaseGroupId, ['draft', 'pending_approval']);
    const hasYieldSuggestion = Number.isFinite(Number(suggestedYieldMPerM))
      && Number(suggestedYieldMPerM) > 0;

    setForm({
      ...emptyForm(),
      typeId: selectedType?.id || '',
      typeName: selectedType?.name || '',
      measureId: selectedMeasure?.id || '',
      measureName: selectedMeasure?.display_name || '',
      finishedWidthMm: numberOrZero(selectedMeasure?.finished_width_mm),
      reason: hasYieldSuggestion
        ? `Nova versão baseada no rendimento realizado de ${numberOrZero(suggestedYieldMPerM).toLocaleString('pt-BR')} m/m`
        : mode === 'create' ? 'Cadastro inicial da conversão' : '',
      materials: [materialForm({
        baseGroupId: selectedBaseGroupId,
        recipeId: selectedRecipe?.id || '',
        usefulWidthMm: numberOrZero(selectedWidthProfile?.usable_width_mm),
        cutBandWidthMm: numberOrZero(selectedRecipe?.cut_band_width_mm),
        confirmedYield: hasYieldSuggestion
          ? numberOrZero(suggestedYieldMPerM)
          : numberOrZero(selectedRecipe?.confirmed_yield_m_per_m),
        executorType: selectedRecipe?.executor_type || 'factory',
        contractorId: selectedRecipe?.default_contractor_id || '',
        transformationCost: numberOrZero(selectedRecipe?.transformation_cost_per_m),
      })],
    });
    nextMaterialRowId.current = 1;
    setCreateRecipeVersion(hasYieldSuggestion && Boolean(selectedRecipe));
    setValidationError(null);
  }, [open, recipeId, measureId, baseGroupId, suggestedRecipeId, suggestedYieldMPerM, legacyRecipeId, mode, catalog]);

  const legacyRecipe = catalog.legacy_recipes.find((item) => item.id === legacyRecipeId);
  const isMultiMaterialCreate = mode === 'create'
    && !legacyRecipe
    && !recipeId
    && !suggestedRecipeId;
  const selectedType = catalog.types.find((item) => item.id === form.typeId);
  const selectedMeasure = catalog.measures.find((item) => item.id === form.measureId);
  const canWrite = capabilities.manage_strap_catalog;
  const canApproveWidthInline = canWrite && capabilities.approve_strap_recipe;
  const canConfirmImmediately = canWrite && capabilities.approve_strap_recipe && !legacyRecipe;
  const canSeeFinancial = capabilities.can_see_financial_values === true;
  const canReuseLegacy = canWrite
    && capabilities.approve_strap_recipe
    && capabilities.resolve_strap_migration
    && canSeeFinancial;
  const readOnly = !canWrite || (Boolean(legacyRecipe) && !canReuseLegacy);
  const materialOptions = [...(baseCandidatesQuery.data || [])];
  form.materials.forEach((material) => {
    const selectedBase = catalog.groups.find((item) => item.id === material.baseGroupId);
    if (selectedBase && !materialOptions.some((item) => item.id === selectedBase.id)) {
      materialOptions.push({
        id: selectedBase.id,
        name: selectedBase.name,
        usable_width_mm: numberOrZero(latestWidthProfile(catalog, selectedBase.id, ['approved'])?.usable_width_mm) || null,
        has_approved_width_profile: Boolean(latestWidthProfile(catalog, selectedBase.id, ['approved'])),
        linear_sku_count: 0,
      });
    }
  });
  const configuredBaseGroupIds = new Set(catalog.recipes
    .filter((recipe) => (
      recipe.measure_id === form.measureId
      && recipe.status !== 'superseded'
      && recipe.status !== 'archived'
    ))
    .map((recipe) => recipe.base_group_id));
  const selectedBaseGroupIds = new Set(form.materials
    .map((material) => material.baseGroupId)
    .filter(Boolean));
  const materialContexts = form.materials.map((material) => {
    const selectedBase = catalog.groups.find((item) => item.id === material.baseGroupId);
    const selectedBaseCandidate = baseCandidatesQuery.data?.find((item) => item.id === material.baseGroupId);
    const currentRecipe = catalog.recipes.find((item) => item.id === material.recipeId);
    const widthProfile = latestWidthProfile(catalog, material.baseGroupId, ['approved']);
    const editableWidthProfile = latestWidthProfile(catalog, material.baseGroupId, ['draft', 'pending_approval']);
    const usefulWidthMm = widthProfile
      ? numberOrZero(widthProfile.usable_width_mm)
      : numberOrZero(selectedBaseCandidate?.usable_width_mm) || material.usefulWidthMm;
    const theoreticalYield = material.cutBandWidthMm > 0 && usefulWidthMm > 0
      ? Math.floor(usefulWidthMm / material.cutBandWidthMm)
      : 0;
    const lateralRemainder = theoreticalYield > 0
      ? usefulWidthMm - theoreticalYield * material.cutBandWidthMm
      : 0;
    const recipeIsMutable = !currentRecipe
      || currentRecipe.status === 'draft'
      || currentRecipe.status === 'pending_approval';
    const canEditRecipeFields = !readOnly && (recipeIsMutable || createRecipeVersion);
    const canEnterLegacyWidth = Boolean(legacyRecipe)
      && !widthProfile
      && !selectedBaseCandidate?.usable_width_mm
      && canApproveWidthInline
      && canEditRecipeFields;
    return {
      material,
      selectedBase,
      selectedBaseCandidate,
      currentRecipe,
      widthProfile,
      editableWidthProfile,
      usefulWidthMm,
      theoreticalYield,
      lateralRemainder,
      recipeIsMutable,
      canEditRecipeFields,
      canEnterLegacyWidth,
    };
  });
  const primaryContext = materialContexts[0];
  const primaryMaterial = primaryContext?.material || EMPTY_MATERIAL_FORM;
  const hasDefinedIdentity = Boolean(form.measureId)
    || Boolean(form.typeName.trim() && form.measureName.trim() && form.finishedWidthMm > 0);
  const identityLocked = materialContexts.some((context) => Boolean(context.currentRecipe))
    || (isMultiMaterialCreate && hasDefinedIdentity && (form.materials.length > 1 || Boolean(measureId)));
  const isSaving = saveWidthProfile.isPending
    || approveWidthProfile.isPending
    || saveConversion.isPending
    || confirmConversion.isPending
    || saveMaterialConversions.isPending
    || reuseLegacyRecipe.isPending;

  const setField = <K extends keyof ConversionForm>(key: K, value: ConversionForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationError(null);
  };

  const setMaterialField = <K extends keyof MaterialConversionForm>(
    rowId: string,
    key: K,
    value: MaterialConversionForm[K],
  ) => {
    setForm((current) => ({
      ...current,
      materials: current.materials.map((material) => (
        material.rowId === rowId ? { ...material, [key]: value } : material
      )),
    }));
    setValidationError(null);
  };

  const addMaterial = () => {
    setForm((current) => {
      const template = current.materials[current.materials.length - 1] || EMPTY_MATERIAL_FORM;
      nextMaterialRowId.current += 1;
      return {
        ...current,
        materials: [
          ...current.materials,
          materialForm({
            cutBandWidthMm: template.cutBandWidthMm,
            executorType: template.executorType,
            contractorId: template.contractorId,
            transformationCost: template.transformationCost,
          }, `material-${nextMaterialRowId.current}`),
        ],
      };
    });
    setValidationError(null);
  };

  const removeMaterial = (rowId: string) => {
    setForm((current) => ({
      ...current,
      materials: current.materials.filter((material) => material.rowId !== rowId),
    }));
    setValidationError(null);
  };

  const validate = (): string | null => {
    if (legacyRecipe?.canonical_recipe_id) {
      return 'Esta receita anterior já foi reaproveitada. Abra a conversão canônica vinculada.';
    }
    if (legacyRecipe && !canReuseLegacy) {
      return 'Reaproveitar exige permissão de catálogo, aprovação, migração e acesso financeiro.';
    }
    if (!form.typeId && !form.typeName.trim()) {
      return 'Selecione um tipo de tira ou informe um novo.';
    }
    if (!form.measureId && (!form.measureName.trim() || form.finishedWidthMm <= 0)) {
      return 'Selecione uma medida ou informe nome e largura final.';
    }
    if (form.materials.length === 0) return 'Adicione pelo menos um material possível para esta tira.';

    const seenBaseGroupIds = new Set<string>();
    for (let index = 0; index < materialContexts.length; index += 1) {
      const context = materialContexts[index];
      const { material } = context;
      const materialName = context.selectedBase?.name || `Material ${index + 1}`;
      const prefix = form.materials.length > 1 ? `${materialName}: ` : '';
      if (!material.baseGroupId) return `${prefix}selecione um material possível para esta tira.`;
      if (seenBaseGroupIds.has(material.baseGroupId)) {
        return `${materialName} foi selecionado mais de uma vez. Escolha materiais diferentes.`;
      }
      seenBaseGroupIds.add(material.baseGroupId);
      if (isMultiMaterialCreate && configuredBaseGroupIds.has(material.baseGroupId)) {
        return `${materialName} já está cadastrado para este tipo de tira. Abra a conversão existente para criar uma nova versão.`;
      }
      if (!context.widthProfile && context.usefulWidthMm <= 0) {
        return `${prefix}o material não possui uma largura física única no estoque. Corrija a Ficha de Componente antes de confirmar.`;
      }
      if (!context.widthProfile && !canApproveWidthInline && !canConfirmImmediately) {
        return `${prefix}o material ainda não possui perfil físico aprovado e seu acesso não permite confirmá-lo neste fluxo.`;
      }
      if (context.currentRecipe && !context.recipeIsMutable && !createRecipeVersion) {
        return `${prefix}a conversão aprovada é imutável. Crie uma nova versão para alterar os números.`;
      }
      if (material.cutBandWidthMm <= 0) return `${prefix}a largura da banda deve ser maior que zero.`;
      if (context.theoreticalYield <= 0) return `${prefix}a largura útil não comporta uma banda completa.`;
      if (material.confirmedYield <= 0 || material.confirmedYield > context.theoreticalYield) {
        return `${prefix}o rendimento confirmado deve estar entre 0 e ${context.theoreticalYield} m/m.`;
      }
      if (material.executorType === 'contractor' && !material.contractorId) {
        return `${prefix}selecione o terceirizado padrão da conversão.`;
      }
      if (material.executorType === 'contractor' && !contractors.some((item) => (
        item.id === material.contractorId && item.active
      ))) {
        return `${prefix}selecione um terceirizado ativo para a nova conversão.`;
      }
      if (!canSeeFinancial && (!context.currentRecipe || createRecipeVersion)) {
        return `${prefix}uma nova versão exige acesso financeiro para informar o custo de transformação.`;
      }
      if (canSeeFinancial && material.transformationCost < 0) {
        return `${prefix}o custo de transformação não pode ser negativo.`;
      }
    }
    if (!form.reason.trim()) return 'Informe o motivo para a trilha de auditoria.';
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }

    const reason = form.reason.trim();
    try {
      const typePayload = form.typeId
        ? { id: form.typeId }
        : { name: form.typeName.trim(), active: true };
      const measurePayload = form.measureId
        ? { id: form.measureId }
        : {
            display_name: form.measureName.trim(),
            finished_width_mm: form.finishedWidthMm,
            active: true,
          };

      if (isMultiMaterialCreate) {
        await saveMaterialConversions.mutateAsync({
          reason,
          confirm: canConfirmImmediately,
          payload: {
            type: typePayload,
            measure: measurePayload,
            materials: materialContexts.map((context) => ({
              base_group_id: context.material.baseGroupId,
              recipe: {
                base_width_profile_id: context.widthProfile?.id,
                cut_band_width_mm: context.material.cutBandWidthMm,
                confirmed_yield_m_per_m: context.material.confirmedYield,
                executor_type: context.material.executorType,
                default_contractor_id: context.material.executorType === 'contractor'
                  ? context.material.contractorId
                  : null,
                ...(canSeeFinancial
                  ? { transformation_cost_per_m: context.material.transformationCost }
                  : {}),
              },
            })),
          },
        });
        onOpenChange(false);
        return;
      }

      if (!primaryContext) throw new Error('Adicione um material antes de salvar a conversão.');
      let resolvedWidthProfileId = primaryContext.widthProfile?.id;
      if (!legacyRecipe && !resolvedWidthProfileId && !canConfirmImmediately) {
        resolvedWidthProfileId = await saveWidthProfile.mutateAsync({
          id: primaryContext.editableWidthProfile?.id,
          baseGroupId: primaryMaterial.baseGroupId,
          usableWidthMm: primaryContext.usefulWidthMm,
          reason,
        });
        await approveWidthProfile.mutateAsync({
          profileId: resolvedWidthProfileId,
          reason,
        });
      }

      const payload = {
          type: typePayload,
          measure: measurePayload,
          base_group_id: primaryMaterial.baseGroupId,
          recipe: {
            id: createRecipeVersion ? undefined : primaryMaterial.recipeId || undefined,
            base_width_profile_id: resolvedWidthProfileId,
            cut_band_width_mm: primaryMaterial.cutBandWidthMm,
            confirmed_yield_m_per_m: primaryMaterial.confirmedYield,
            executor_type: primaryMaterial.executorType,
            default_contractor_id: primaryMaterial.executorType === 'contractor'
              ? primaryMaterial.contractorId
              : null,
            ...(canSeeFinancial ? { transformation_cost_per_m: primaryMaterial.transformationCost } : {}),
          },
        };

      if (legacyRecipe) {
        await reuseLegacyRecipe.mutateAsync({
          legacyRecipeId: legacyRecipe.id,
          payload,
          usableWidthMm: primaryContext.widthProfile ? null : primaryContext.usefulWidthMm,
          editableWidthProfileId: primaryContext.editableWidthProfile?.id,
          reason,
        });
      } else if (canConfirmImmediately && mode === 'create') {
        await confirmConversion.mutateAsync({ reason, payload });
      } else {
        await saveConversion.mutateAsync({ reason, payload });
      }
      onOpenChange(false);
    } catch (saveError) {
      setValidationError(mutationErrorMessage(saveError));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-3xl">
        <div className="flex min-h-full flex-col">
          <SheetHeader className="border-b border-border px-4 pb-4 pt-5 pr-12 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{ORIGIN_LABEL[origin]}</Badge>
              <Badge variant="secondary">
                {legacyRecipe ? 'Histórico → conversão' : 'Conversão técnica'}
              </Badge>
              <Badge variant="outline">Todas as cores</Badge>
            </div>
            <SheetTitle>
              {legacyRecipe
                ? 'Reaproveitar receita anterior'
                : mode === 'create'
                  ? isMultiMaterialCreate ? 'Cadastrar tipo e materiais' : 'Cadastrar tipo e material'
                  : 'Editar conversão'}
            </SheetTitle>
            <SheetDescription>
              {legacyRecipe
                ? 'Confira os dados recuperados e complete os campos obrigatórios de rendimento. O registro antigo continuará preservado.'
                : 'Defina os números uma única vez por família, medida e napa-base. Inclua quantos materiais forem necessários; cada rendimento será confirmado separadamente e valerá para todas as cores.'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-6 px-4 py-5 sm:px-6">
            {!canWrite && (
              <Alert>
                <LockKey className="h-4 w-4" />
                <AlertTitle>Consulta somente</AlertTitle>
                <AlertDescription>Sua permissão não permite alterar conversões.</AlertDescription>
              </Alert>
            )}

            {legacyRecipe && readOnly && canWrite && (
              <Alert>
                <LockKey className="h-4 w-4" />
                <AlertTitle>Reaproveitamento restrito</AlertTitle>
                <AlertDescription>
                  Esta ação exige aprovação de receitas, resolução da migração e acesso aos valores financeiros.
                </AlertDescription>
              </Alert>
            )}

            {legacyRecipe && (
              <Alert>
                <ClockCounterClockwise className="h-4 w-4" />
                <AlertTitle>Dados recuperados do sistema anterior</AlertTitle>
                <AlertDescription>
                  <span className="font-semibold text-foreground">
                    {legacyRecipe.artisanal_product_name} · {legacyRecipe.base_product_name}
                  </span>
                  {' · '}banda {numberOrZero(legacyRecipe.cut_width_mm) || '—'} mm
                  {' · '}rendimento {numberOrZero(legacyRecipe.yield_per_meter) || '—'} m/m.
                  Confira as sugestões e preencha a largura útil ou a identidade que estiver faltando.
                </AlertDescription>
              </Alert>
            )}

            <StrapIdentityTrail
              typeName={selectedType?.name || form.typeName}
              measureName={selectedMeasure?.display_name || form.measureName}
              baseName={isMultiMaterialCreate
                ? `${selectedBaseGroupIds.size} de ${form.materials.length} ${form.materials.length === 1 ? 'material definido' : 'materiais definidos'}`
                : primaryContext?.selectedBase?.name}
              baseLabel={isMultiMaterialCreate ? 'Materiais' : 'Napa-base'}
            />

            <Alert>
              <Scissors className="h-4 w-4" />
              <AlertTitle>Conversão compartilhada</AlertTitle>
              <AlertDescription>
                Para o mesmo tipo/medida e a mesma família do material-base, banda, rendimento, executor e custo valem para todas as cores. Ex.: NAPA SOFT 1370 × 1000 mm → Tira Meia Cana 10 mm = 55 m/m em qualquer cor. Nenhuma cor é gravada aqui.
              </AlertDescription>
            </Alert>

            <section className="space-y-3" aria-labelledby="strap-conversion-identity">
              <div className="flex items-center gap-2">
                <Scissors className="h-4 w-4 text-primary" />
                <h3 id="strap-conversion-identity" className="text-sm font-bold">Tipo de tira</h3>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="strap-conversion-measure">Tipo de tira *</Label>
                <Select
                  value={form.measureId || '__new__'}
                  onValueChange={(value) => {
                    const selectedMeasureId = value === '__new__' ? '' : value;
                    const measure = catalog.measures.find((item) => item.id === selectedMeasureId);
                    const type = catalog.types.find((item) => item.id === measure?.strap_type_id);
                    setForm((current) => ({
                      ...current,
                      typeId: type?.id || '',
                      typeName: type?.name || '',
                      measureId: measure?.id || '',
                      measureName: measure?.display_name || '',
                      finishedWidthMm: numberOrZero(measure?.finished_width_mm),
                      materials: [emptyMaterialForm(current.materials[0]?.rowId || 'material-1')],
                    }));
                    nextMaterialRowId.current = 1;
                    setValidationError(null);
                  }}
                  disabled={readOnly || identityLocked}
                >
                  <SelectTrigger id="strap-conversion-measure"><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__new__">Novo tipo de tira…</SelectItem>
                    {catalog.measures
                      .filter((measure) => measure.active && catalog.types.some((type) => (
                        type.id === measure.strap_type_id && type.active
                      )))
                      .sort((left, right) => {
                        const leftType = catalog.types.find((item) => item.id === left.strap_type_id)?.name || '';
                        const rightType = catalog.types.find((item) => item.id === right.strap_type_id)?.name || '';
                        return `${leftType} ${left.display_name}`.localeCompare(`${rightType} ${right.display_name}`, 'pt-BR');
                      })
                      .map((measure) => (
                        <SelectItem key={measure.id} value={measure.id}>
                          {catalog.types.find((item) => item.id === measure.strap_type_id)?.name || 'Tira'} · {measure.display_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {!form.measureId && (
                  <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
                    <div className="space-y-1.5">
                      <Label htmlFor="strap-new-type-name">Nome do tipo</Label>
                      <Input
                        id="strap-new-type-name"
                        value={form.typeName}
                        onChange={(event) => setField('typeName', event.target.value)}
                        placeholder="Ex.: TIRA CHATA"
                        disabled={readOnly || identityLocked}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="strap-new-type-width">Medida final</Label>
                      <NumberInput
                        id="strap-new-type-width"
                        value={form.finishedWidthMm}
                        onChange={(value) => {
                          setForm((current) => ({
                            ...current,
                            finishedWidthMm: value,
                            measureName: value > 0 ? `${value.toLocaleString('pt-BR')} mm` : '',
                          }));
                          setValidationError(null);
                        }}
                        unit="mm"
                        disabled={readOnly || identityLocked}
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>

            <Separator />

            <section className="space-y-4" aria-labelledby="strap-conversion-materials">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Factory className="h-4 w-4 text-primary" />
                  <div>
                    <h3 id="strap-conversion-materials" className="text-sm font-bold">Materiais possíveis e rendimentos</h3>
                    <p className="text-xs text-muted-foreground">
                      Cada material mantém sua própria largura, banda, rendimento, executor e custo.
                    </p>
                  </div>
                </div>
                {isMultiMaterialCreate && (
                  <Badge variant="outline">
                    {form.materials.length} {form.materials.length === 1 ? 'material' : 'materiais'}
                  </Badge>
                )}
              </div>

              <div className="space-y-4">
                {materialContexts.map((context, index) => {
                  const { material } = context;
                  const materialLabel = context.selectedBase?.name || `Material ${index + 1}`;
                  const materialHeadingId = `strap-conversion-${material.rowId}-heading`;
                  const materialSelectId = `strap-conversion-${material.rowId}-base`;
                  const usefulWidthId = `strap-conversion-${material.rowId}-useful-width`;
                  const cutBandId = `strap-conversion-${material.rowId}-cut-band`;
                  const confirmedYieldId = `strap-conversion-${material.rowId}-confirmed-yield`;
                  const executorId = `strap-conversion-${material.rowId}-executor`;
                  const contractorId = `strap-conversion-${material.rowId}-contractor`;
                  const transformationCostId = `strap-conversion-${material.rowId}-cost`;
                  return (
                    <article
                      key={material.rowId}
                      role="group"
                      aria-labelledby={materialHeadingId}
                      className="space-y-4 rounded-lg border border-border bg-card p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                            Material {index + 1}
                          </p>
                          <h4 id={materialHeadingId} className="text-sm font-bold text-foreground">{materialLabel}</h4>
                        </div>
                        <div className="flex items-center gap-2">
                          {context.currentRecipe && <Badge variant="outline">v{context.currentRecipe.version}</Badge>}
                          {isMultiMaterialCreate && form.materials.length > 1 && !readOnly && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeMaterial(material.rowId)}
                              aria-label={`Remover ${materialLabel}`}
                            >
                              <Trash className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor={materialSelectId}>Material possível *</Label>
                        <Select
                          value={material.baseGroupId}
                          onValueChange={(value) => {
                            const selectedWidthProfile = latestWidthProfile(catalog, value, ['approved'])
                              || latestWidthProfile(catalog, value, ['draft', 'pending_approval']);
                            const candidate = baseCandidatesQuery.data?.find((item) => item.id === value);
                            setForm((current) => ({
                              ...current,
                              materials: current.materials.map((item) => item.rowId === material.rowId
                                ? {
                                    ...item,
                                    baseGroupId: value,
                                    recipeId: '',
                                    usefulWidthMm: numberOrZero(selectedWidthProfile?.usable_width_mm)
                                      || numberOrZero(candidate?.usable_width_mm),
                                    confirmedYield: 0,
                                  }
                                : item),
                            }));
                            setValidationError(null);
                          }}
                          disabled={readOnly || Boolean(context.currentRecipe)}
                        >
                          <SelectTrigger id={materialSelectId}>
                            <SelectValue placeholder={baseCandidatesQuery.isLoading ? 'Buscando materiais no estoque…' : 'Selecione o material'} />
                          </SelectTrigger>
                          <SelectContent>
                            {materialOptions.map((item) => {
                              const selectedInAnotherRow = form.materials.some((row) => (
                                row.rowId !== material.rowId && row.baseGroupId === item.id
                              ));
                              const alreadyConfigured = isMultiMaterialCreate && configuredBaseGroupIds.has(item.id);
                              const widthMissing = !numberOrZero(item.usable_width_mm);
                              return (
                                <SelectItem
                                  key={item.id}
                                  value={item.id}
                                  disabled={widthMissing || selectedInAnotherRow || alreadyConfigured}
                                >
                                  {item.name}
                                  {alreadyConfigured
                                    ? ' · já cadastrado'
                                    : selectedInAnotherRow
                                      ? ' · já selecionado'
                                      : widthMissing
                                        ? ' · dimensões pendentes'
                                        : ` · ${numberOrZero(item.usable_width_mm).toLocaleString('pt-BR')} mm`}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>

                      {material.baseGroupId && (
                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                          <div className="flex items-start gap-3">
                            <Ruler className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">Medidas físicas do estoque</p>
                              <p className="mt-1 text-sm text-foreground">
                                <strong>{context.selectedBase?.name || 'Material'}</strong>
                                {' · '}largura {context.usefulWidthMm > 0 ? `${context.usefulWidthMm.toLocaleString('pt-BR')} mm` : 'pendente'}
                                {' · '}unidade linear m
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {context.selectedBaseCandidate?.linear_sku_count
                                  ? `${context.selectedBaseCandidate.linear_sku_count} SKU(s) ativo(s) confirmam esta medida.`
                                  : 'A medida vem da Ficha de Componente do material e não varia por cor.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {context.currentRecipe && !context.recipeIsMutable && (
                        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold">Versão aprovada preservada</p>
                            <p className="text-xs text-muted-foreground">Pedidos anteriores continuam usando o snapshot já registrado.</p>
                          </div>
                          {canWrite && !createRecipeVersion && (
                            <Button type="button" variant="outline" size="sm" onClick={() => setCreateRecipeVersion(true)}>
                              Criar nova versão
                            </Button>
                          )}
                          {createRecipeVersion && <Badge variant="secondary">Nova versão em rascunho</Badge>}
                        </div>
                      )}

                      {!context.widthProfile && material.baseGroupId && (
                        <Alert variant={context.usefulWidthMm > 0 ? 'default' : 'destructive'}>
                          {context.usefulWidthMm > 0 ? <Ruler className="h-4 w-4" /> : <Warning className="h-4 w-4" />}
                          <AlertTitle>{context.usefulWidthMm > 0 ? 'Largura encontrada no estoque' : 'Dimensão física pendente'}</AlertTitle>
                          <AlertDescription>
                            {context.usefulWidthMm > 0
                              ? `A largura de ${context.usefulWidthMm.toLocaleString('pt-BR')} mm será vinculada automaticamente ao confirmar. Você não precisa digitá-la.`
                              : legacyRecipe && context.canEnterLegacyWidth
                                ? 'Este registro histórico não possui uma dimensão inequívoca no estoque. Informe-a somente para concluir a migração assistida.'
                                : 'Corrija a largura em Materiais > Ficha de Componente > Dimensões. O cadastro de tiras não aceita uma medida manual diferente do estoque.'}
                          </AlertDescription>
                        </Alert>
                      )}

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={usefulWidthId}>Largura do material (estoque)</Label>
                          <NumberInput
                            id={usefulWidthId}
                            value={context.usefulWidthMm}
                            onChange={(value) => setMaterialField(material.rowId, 'usefulWidthMm', value)}
                            unit="mm"
                            disabled={!context.canEnterLegacyWidth}
                          />
                          {!context.widthProfile && context.editableWidthProfile && (
                            <p className="text-xs text-muted-foreground">
                              Rascunho v{context.editableWidthProfile.version} será atualizado e aprovado.
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={cutBandId}>Largura da banda *</Label>
                          <NumberInput
                            id={cutBandId}
                            value={material.cutBandWidthMm}
                            onChange={(value) => setMaterialField(material.rowId, 'cutBandWidthMm', value)}
                            unit="mm"
                            disabled={!context.canEditRecipeFields}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={confirmedYieldId}>Rendimento real confirmado *</Label>
                          <NumberInput
                            id={confirmedYieldId}
                            value={material.confirmedYield}
                            onChange={(value) => setMaterialField(material.rowId, 'confirmedYield', value)}
                            unit="m/m"
                            disabled={!context.canEditRecipeFields}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-4">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bandas completas</p>
                          <p className="font-mono text-lg font-bold">{context.theoreticalYield || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Teórico</p>
                          <p className="font-mono text-lg font-bold">{context.theoreticalYield ? `${context.theoreticalYield} m/m` : '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Rendimento usado</p>
                          <p className="font-mono text-lg font-bold" aria-live="polite">
                            {material.confirmedYield > 0 ? `${material.confirmedYield.toLocaleString('pt-BR')} m/m` : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sobra lateral</p>
                          <p className="font-mono text-lg font-bold">{context.theoreticalYield ? `${context.lateralRemainder} mm` : '—'}</p>
                        </div>
                      </div>

                      <details className="rounded-lg border border-border bg-muted/20 p-3" open={Boolean(context.currentRecipe || legacyRecipe)}>
                        <summary className="cursor-pointer text-sm font-semibold">Produção e custo</summary>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Configuração operacional deste material. O rendimento continua independente da cor.
                        </p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={executorId}>Executor padrão *</Label>
                            <Select
                              value={material.executorType}
                              onValueChange={(value) => setMaterialField(
                                material.rowId,
                                'executorType',
                                value as 'factory' | 'contractor',
                              )}
                              disabled={!context.canEditRecipeFields}
                            >
                              <SelectTrigger id={executorId}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="factory">Fábrica</SelectItem>
                                <SelectItem value="contractor">Terceirizado</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {material.executorType === 'contractor' && (
                            <div className="space-y-1.5">
                              <Label htmlFor={contractorId}>Terceirizado *</Label>
                              <Select
                                value={material.contractorId}
                                onValueChange={(value) => setMaterialField(material.rowId, 'contractorId', value)}
                                disabled={!context.canEditRecipeFields}
                              >
                                <SelectTrigger id={contractorId}><SelectValue placeholder="Selecione" /></SelectTrigger>
                                <SelectContent>
                                  {contractors.filter((item) => item.active).map((item) => (
                                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          {canSeeFinancial && (
                            <div className="space-y-1.5">
                              <Label htmlFor={transformationCostId}>Custo de transformação</Label>
                              <NumberInput
                                id={transformationCostId}
                                value={material.transformationCost}
                                onChange={(value) => setMaterialField(material.rowId, 'transformationCost', value)}
                                unit="R$/m"
                                disabled={!context.canEditRecipeFields}
                              />
                            </div>
                          )}
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>

              {baseCandidatesQuery.isError && !legacyRecipe && (
                <p className="text-xs text-destructive">Não foi possível consultar as medidas físicas do estoque.</p>
              )}

              {isMultiMaterialCreate && !readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2 border-dashed"
                  onClick={addMaterial}
                  disabled={form.materials.length >= 25 || !hasDefinedIdentity}
                  title={!hasDefinedIdentity ? 'Defina o tipo e a medida antes de adicionar materiais.' : undefined}
                >
                  <Plus className="h-4 w-4" /> Adicionar outro material
                </Button>
              )}
            </section>

            {!readOnly && (mode !== 'create' || Boolean(legacyRecipe)) && (
              <section className="space-y-1.5" aria-labelledby="strap-conversion-audit">
                <Label id="strap-conversion-audit">Motivo da alteração *</Label>
                <Textarea
                  value={form.reason}
                  onChange={(event) => setField('reason', event.target.value)}
                  placeholder="Explique o cadastro ou ajuste para a auditoria."
                  rows={2}
                />
              </section>
            )}

            {validationError && (
              <Alert variant="destructive">
                <Warning className="h-4 w-4" />
                <AlertTitle>Revise a conversão</AlertTitle>
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}
          </div>

          <SheetFooter className="sticky bottom-0 border-t border-border bg-background px-4 py-4 sm:px-6">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
            {!readOnly && (
              <Button onClick={() => handleSave()} disabled={isSaving} className="gap-2">
                <FloppyDisk className="h-4 w-4" />
                {isSaving
                  ? 'Salvando…'
                  : legacyRecipe
                    ? 'Confirmar e ativar'
                    : canConfirmImmediately && mode === 'create'
                      ? isMultiMaterialCreate && form.materials.length > 1
                        ? `Confirmar ${form.materials.length} rendimentos e salvar`
                        : 'Confirmar rendimento e salvar'
                      : isMultiMaterialCreate && form.materials.length > 1
                        ? `Salvar ${form.materials.length} conversões`
                        : 'Salvar conversão'}
              </Button>
            )}
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}

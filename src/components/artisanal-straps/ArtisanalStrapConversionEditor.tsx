import { useEffect, useState } from 'react';
import {
  ClockCounterClockwise,
  Factory,
  FloppyDisk,
  LockKey,
  Ruler,
  Scissors,
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

interface ConversionForm {
  typeId: string;
  typeName: string;
  measureId: string;
  measureName: string;
  finishedWidthMm: number;
  baseGroupId: string;
  recipeId: string;
  usefulWidthMm: number;
  cutBandWidthMm: number;
  confirmedYield: number;
  executorType: 'factory' | 'contractor';
  contractorId: string;
  transformationCost: number;
  reason: string;
}

const EMPTY_FORM: ConversionForm = {
  typeId: '',
  typeName: '',
  measureId: '',
  measureName: '',
  finishedWidthMm: 0,
  baseGroupId: '',
  recipeId: '',
  usefulWidthMm: 0,
  cutBandWidthMm: 0,
  confirmedYield: 0,
  executorType: 'factory',
  contractorId: '',
  transformationCost: 0,
  reason: '',
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
  const [form, setForm] = useState<ConversionForm>(EMPTY_FORM);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [createRecipeVersion, setCreateRecipeVersion] = useState(false);
  const saveWidthProfile = useSaveBaseMaterialWidthProfile();
  const approveWidthProfile = useApproveBaseMaterialWidthProfile();
  const saveConversion = useSaveArtisanalStrapConversion();
  const confirmConversion = useConfirmArtisanalStrapMaterialConversion();
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
        ...EMPTY_FORM,
        typeId: suggestedType?.id || '',
        typeName: suggestedType?.name || fallbackTypeName,
        measureId: suggestedMeasure?.id || '',
        measureName: suggestedMeasure?.display_name || (legacyWidthMm > 0 ? `${legacyWidthMm}mm` : ''),
        finishedWidthMm: numberOrZero(suggestedMeasure?.finished_width_mm) || legacyWidthMm,
        baseGroupId: suggestedBase?.id || '',
        usefulWidthMm: numberOrZero(selectedWidthProfile?.usable_width_mm),
        cutBandWidthMm: numberOrZero(legacyRecipe.cut_width_mm),
        confirmedYield: numberOrZero(legacyRecipe.yield_per_meter),
        executorType: legacyRecipe.default_contractor_id ? 'contractor' : 'factory',
        contractorId: legacyRecipe.default_contractor_id || '',
        transformationCost: numberOrZero(legacyRecipe.labor_cost_per_meter),
        reason: `Reaproveitamento da receita anterior: ${legacyRecipe.name}`,
        recipeId: '',
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
      ...EMPTY_FORM,
      typeId: selectedType?.id || '',
      typeName: selectedType?.name || '',
      measureId: selectedMeasure?.id || '',
      measureName: selectedMeasure?.display_name || '',
      finishedWidthMm: numberOrZero(selectedMeasure?.finished_width_mm),
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
      reason: hasYieldSuggestion
        ? `Nova versão baseada no rendimento realizado de ${numberOrZero(suggestedYieldMPerM).toLocaleString('pt-BR')} m/m`
        : mode === 'create' ? 'Cadastro inicial da conversão' : '',
    });
    setCreateRecipeVersion(hasYieldSuggestion && Boolean(selectedRecipe));
    setValidationError(null);
  }, [open, recipeId, measureId, baseGroupId, suggestedRecipeId, suggestedYieldMPerM, legacyRecipeId, mode, catalog]);

  const legacyRecipe = catalog.legacy_recipes.find((item) => item.id === legacyRecipeId);
  const selectedType = catalog.types.find((item) => item.id === form.typeId);
  const selectedMeasure = catalog.measures.find((item) => item.id === form.measureId);
  const selectedBase = catalog.groups.find((item) => item.id === form.baseGroupId);
  const selectedBaseCandidate = baseCandidatesQuery.data?.find((item) => item.id === form.baseGroupId);
  const materialOptions = [...(baseCandidatesQuery.data || [])];
  if (selectedBase && !materialOptions.some((item) => item.id === selectedBase.id)) {
    materialOptions.push({
      id: selectedBase.id,
      name: selectedBase.name,
      usable_width_mm: numberOrZero(latestWidthProfile(catalog, selectedBase.id, ['approved'])?.usable_width_mm) || null,
      has_approved_width_profile: Boolean(latestWidthProfile(catalog, selectedBase.id, ['approved'])),
      linear_sku_count: 0,
    });
  }
  const currentRecipe = catalog.recipes.find((item) => item.id === form.recipeId);
  const widthProfile = latestWidthProfile(catalog, form.baseGroupId, ['approved']);
  const editableWidthProfile = latestWidthProfile(catalog, form.baseGroupId, ['draft', 'pending_approval']);
  const usefulWidthMm = widthProfile
    ? numberOrZero(widthProfile.usable_width_mm)
    : numberOrZero(selectedBaseCandidate?.usable_width_mm) || form.usefulWidthMm;
  const theoreticalYield = form.cutBandWidthMm > 0 && usefulWidthMm > 0
    ? Math.floor(usefulWidthMm / form.cutBandWidthMm)
    : 0;
  const lateralRemainder = theoreticalYield > 0
    ? usefulWidthMm - theoreticalYield * form.cutBandWidthMm
    : 0;
  const confirmedYield = form.confirmedYield;
  const recipeIsMutable = !currentRecipe
    || currentRecipe.status === 'draft'
    || currentRecipe.status === 'pending_approval';
  const identityLocked = Boolean(currentRecipe);
  const canWrite = capabilities.manage_strap_catalog;
  const canApproveWidthInline = canWrite && capabilities.approve_strap_recipe;
  const canConfirmImmediately = canWrite && capabilities.approve_strap_recipe && !legacyRecipe;
  const canSeeFinancial = capabilities.can_see_financial_values === true;
  const canReuseLegacy = canWrite
    && capabilities.approve_strap_recipe
    && capabilities.resolve_strap_migration
    && canSeeFinancial;
  const readOnly = !canWrite || (Boolean(legacyRecipe) && !canReuseLegacy);
  const canEditRecipeFields = !readOnly && (recipeIsMutable || createRecipeVersion);
  const canEnterLegacyWidth = Boolean(legacyRecipe)
    && !widthProfile
    && !selectedBaseCandidate?.usable_width_mm
    && canApproveWidthInline
    && canEditRecipeFields;
  const isSaving = saveWidthProfile.isPending
    || approveWidthProfile.isPending
    || saveConversion.isPending
    || confirmConversion.isPending
    || reuseLegacyRecipe.isPending;

  const setField = <K extends keyof ConversionForm>(key: K, value: ConversionForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
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
    if (!form.baseGroupId) return 'Selecione um material possível para esta tira.';
    if (!widthProfile && usefulWidthMm <= 0) {
      return 'O material não possui uma largura física única no estoque. Corrija a Ficha de Componente antes de confirmar.';
    }
    if (!widthProfile && !canApproveWidthInline && !canConfirmImmediately) {
      return 'O material ainda não possui perfil físico aprovado e seu acesso não permite confirmá-lo neste fluxo.';
    }
    if (currentRecipe && !recipeIsMutable && !createRecipeVersion) {
      return 'A conversão aprovada é imutável. Crie uma nova versão para alterar os números.';
    }
    if (form.cutBandWidthMm <= 0) return 'A largura da banda deve ser maior que zero.';
    if (theoreticalYield <= 0) return 'A largura útil não comporta uma banda completa.';
    if (confirmedYield <= 0 || confirmedYield > theoreticalYield) {
      return `O rendimento confirmado deve estar entre 0 e ${theoreticalYield} m/m.`;
    }
    if (form.executorType === 'contractor' && !form.contractorId) {
      return 'Selecione o terceirizado padrão da conversão.';
    }
    if (form.executorType === 'contractor' && !contractors.some((item) => (
      item.id === form.contractorId && item.active
    ))) {
      return 'Selecione um terceirizado ativo para a nova conversão.';
    }
    if (!canSeeFinancial && (!currentRecipe || createRecipeVersion)) {
      return 'Uma nova versão exige acesso financeiro para informar o custo de transformação.';
    }
    if (canSeeFinancial && form.transformationCost < 0) {
      return 'O custo de transformação não pode ser negativo.';
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
      let resolvedWidthProfileId = widthProfile?.id;
      if (!legacyRecipe && !resolvedWidthProfileId && !canConfirmImmediately) {
        resolvedWidthProfileId = await saveWidthProfile.mutateAsync({
          id: editableWidthProfile?.id,
          baseGroupId: form.baseGroupId,
          usableWidthMm: usefulWidthMm,
          reason,
        });
        await approveWidthProfile.mutateAsync({
          profileId: resolvedWidthProfileId,
          reason,
        });
      }

      const payload = {
          type: form.typeId
            ? { id: form.typeId }
            : { name: form.typeName.trim(), active: true },
          measure: form.measureId
            ? { id: form.measureId }
            : {
                display_name: form.measureName.trim(),
                finished_width_mm: form.finishedWidthMm,
                active: true,
              },
          base_group_id: form.baseGroupId,
          recipe: {
            id: createRecipeVersion ? undefined : form.recipeId || undefined,
            base_width_profile_id: resolvedWidthProfileId,
            cut_band_width_mm: form.cutBandWidthMm,
            confirmed_yield_m_per_m: confirmedYield,
            executor_type: form.executorType,
            default_contractor_id: form.executorType === 'contractor' ? form.contractorId : null,
            ...(canSeeFinancial ? { transformation_cost_per_m: form.transformationCost } : {}),
          },
        };

      if (legacyRecipe) {
        await reuseLegacyRecipe.mutateAsync({
          legacyRecipeId: legacyRecipe.id,
          payload,
          usableWidthMm: widthProfile ? null : usefulWidthMm,
          editableWidthProfileId: editableWidthProfile?.id,
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
      <SheetContent side="right" className="w-full p-0 sm:max-w-2xl">
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
                : mode === 'create' ? 'Cadastrar tipo e material' : 'Editar conversão'}
            </SheetTitle>
            <SheetDescription>
              {legacyRecipe
                ? 'Confira os dados recuperados e complete os campos obrigatórios de rendimento. O registro antigo continuará preservado.'
                : 'Defina os números uma única vez por família, medida e napa-base. Na rotina, escolha o tipo e o material; as medidas físicas vêm do estoque e valem para todas as cores.'}
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
              baseName={selectedBase?.name}
            />

            <Alert>
              <Scissors className="h-4 w-4" />
              <AlertTitle>Conversão compartilhada</AlertTitle>
              <AlertDescription>
                Banda, rendimento, executor e custo são iguais para todas as cores desta combinação. Nenhuma cor é gravada aqui.
              </AlertDescription>
            </Alert>

            <section className="space-y-3" aria-labelledby="strap-conversion-identity">
              <div className="flex items-center gap-2">
                <Scissors className="h-4 w-4 text-primary" />
                <h3 id="strap-conversion-identity" className="text-sm font-bold">Tipo e material</h3>
              </div>
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label>Tipo de tira *</Label>
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
                      }));
                      setValidationError(null);
                    }}
                    disabled={readOnly || identityLocked}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
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

                <div className="space-y-1.5">
                  <Label>Material possível *</Label>
                  <Select
                    value={form.baseGroupId}
                    onValueChange={(value) => {
                      const selectedWidthProfile = latestWidthProfile(catalog, value, ['approved'])
                        || latestWidthProfile(catalog, value, ['draft', 'pending_approval']);
                      const candidate = baseCandidatesQuery.data?.find((item) => item.id === value);
                      setForm((current) => ({
                        ...current,
                        baseGroupId: value,
                        usefulWidthMm: numberOrZero(selectedWidthProfile?.usable_width_mm)
                          || numberOrZero(candidate?.usable_width_mm),
                      }));
                      setValidationError(null);
                    }}
                    disabled={readOnly || identityLocked}
                  >
                    <SelectTrigger><SelectValue placeholder={baseCandidatesQuery.isLoading ? 'Buscando materiais no estoque…' : 'Selecione o material'} /></SelectTrigger>
                    <SelectContent>
                      {materialOptions.map((item) => (
                        <SelectItem key={item.id} value={item.id} disabled={!numberOrZero(item.usable_width_mm)}>
                          {item.name}{numberOrZero(item.usable_width_mm) > 0
                            ? ` · ${numberOrZero(item.usable_width_mm).toLocaleString('pt-BR')} mm`
                            : ' · dimensões pendentes'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {baseCandidatesQuery.isError && !legacyRecipe && (
                    <p className="text-xs text-destructive">Não foi possível consultar as medidas físicas do estoque.</p>
                  )}
                </div>

                {form.baseGroupId && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-start gap-3">
                      <Ruler className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">Medidas físicas do estoque</p>
                        <p className="mt-1 text-sm text-foreground">
                          <strong>{selectedBase?.name || 'Material'}</strong>
                          {' · '}largura {usefulWidthMm > 0 ? `${usefulWidthMm.toLocaleString('pt-BR')} mm` : 'pendente'}
                          {' · '}unidade linear m
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {selectedBaseCandidate?.linear_sku_count
                            ? `${selectedBaseCandidate.linear_sku_count} SKU(s) ativo(s) confirmam esta medida.`
                            : 'A medida vem da Ficha de Componente do material e não varia por cor.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <Separator />

            <section className="space-y-3" aria-labelledby="strap-conversion-numbers">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Factory className="h-4 w-4 text-primary" />
                  <h3 id="strap-conversion-numbers" className="text-sm font-bold">Confirmar rendimento</h3>
                </div>
                {currentRecipe && <Badge variant="outline">v{currentRecipe.version}</Badge>}
              </div>

              {currentRecipe && !recipeIsMutable && (
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

              {!widthProfile && form.baseGroupId && (
                <Alert variant={usefulWidthMm > 0 ? 'default' : 'destructive'}>
                  {usefulWidthMm > 0 ? <Ruler className="h-4 w-4" /> : <Warning className="h-4 w-4" />}
                  <AlertTitle>{usefulWidthMm > 0 ? 'Largura encontrada no estoque' : 'Dimensão física pendente'}</AlertTitle>
                  <AlertDescription>
                    {usefulWidthMm > 0
                      ? `A largura de ${usefulWidthMm.toLocaleString('pt-BR')} mm será vinculada automaticamente ao confirmar. Você não precisa digitá-la.`
                      : legacyRecipe && canEnterLegacyWidth
                        ? 'Este registro histórico não possui uma dimensão inequívoca no estoque. Informe-a somente para concluir a migração assistida.'
                        : 'Corrija a largura em Materiais > Ficha de Componente > Dimensões. O cadastro de tiras não aceita uma medida manual diferente do estoque.'}
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="strap-conversion-useful-width">Largura do material (estoque)</Label>
                  <NumberInput
                    id="strap-conversion-useful-width"
                    value={usefulWidthMm}
                    onChange={(value) => setField('usefulWidthMm', value)}
                    unit="mm"
                    disabled={!canEnterLegacyWidth}
                  />
                  {!widthProfile && editableWidthProfile && (
                    <p className="text-xs text-muted-foreground">
                      Rascunho v{editableWidthProfile.version} será atualizado e aprovado.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="strap-conversion-cut-band">Largura da banda *</Label>
                  <NumberInput
                    id="strap-conversion-cut-band"
                    value={form.cutBandWidthMm}
                    onChange={(value) => setField('cutBandWidthMm', value)}
                    unit="mm"
                    disabled={!canEditRecipeFields}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="strap-conversion-confirmed-yield">Rendimento real confirmado *</Label>
                  <NumberInput
                    id="strap-conversion-confirmed-yield"
                    value={form.confirmedYield}
                    onChange={(value) => setField('confirmedYield', value)}
                    unit="m/m"
                    disabled={!canEditRecipeFields}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bandas completas</p>
                  <p className="font-mono text-lg font-bold">{theoreticalYield || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Teórico</p>
                  <p className="font-mono text-lg font-bold">{theoreticalYield ? `${theoreticalYield} m/m` : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Rendimento usado</p>
                  <p className="font-mono text-lg font-bold" aria-live="polite">
                    {confirmedYield > 0 ? `${confirmedYield.toLocaleString('pt-BR')} m/m` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sobra lateral</p>
                  <p className="font-mono text-lg font-bold">{theoreticalYield ? `${lateralRemainder} mm` : '—'}</p>
                </div>
              </div>

              <details className="rounded-lg border border-border bg-muted/20 p-3" open={Boolean(currentRecipe || legacyRecipe)}>
                <summary className="cursor-pointer text-sm font-semibold">Produção e custo</summary>
                <p className="mt-1 text-xs text-muted-foreground">
                  Configuração operacional avançada. O rendimento continua independente da cor.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Executor padrão *</Label>
                    <Select
                      value={form.executorType}
                      onValueChange={(value) => setField('executorType', value as 'factory' | 'contractor')}
                      disabled={!canEditRecipeFields}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="factory">Fábrica</SelectItem>
                        <SelectItem value="contractor">Terceirizado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.executorType === 'contractor' && (
                    <div className="space-y-1.5">
                      <Label>Terceirizado *</Label>
                      <Select
                        value={form.contractorId}
                        onValueChange={(value) => setField('contractorId', value)}
                        disabled={!canEditRecipeFields}
                      >
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
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
                      <Label>Custo de transformação</Label>
                      <NumberInput
                        value={form.transformationCost}
                        onChange={(value) => setField('transformationCost', value)}
                        unit="R$/m"
                        disabled={!canEditRecipeFields}
                      />
                    </div>
                  )}
                </div>
              </details>
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
              <Button onClick={handleSave} disabled={isSaving} className="gap-2">
                <FloppyDisk className="h-4 w-4" />
                {isSaving
                  ? 'Salvando…'
                  : legacyRecipe
                    ? 'Confirmar e ativar'
                    : canConfirmImmediately && mode === 'create'
                      ? 'Confirmar rendimento e salvar'
                      : 'Salvar conversão'}
              </Button>
            )}
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}

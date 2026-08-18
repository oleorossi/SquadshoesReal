import { useEffect, useMemo, useState } from 'react';
import {
  Factory,
  FloppyDisk,
  LockKey,
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
  useSaveBaseMaterialWidthProfile,
  useSaveArtisanalStrapConversion,
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
}: ArtisanalStrapConversionEditorProps) {
  const [form, setForm] = useState<ConversionForm>(EMPTY_FORM);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [createRecipeVersion, setCreateRecipeVersion] = useState(false);
  const saveWidthProfile = useSaveBaseMaterialWidthProfile();
  const approveWidthProfile = useApproveBaseMaterialWidthProfile();
  const saveConversion = useSaveArtisanalStrapConversion();
  const { data: contractors = [] } = useContractors();

  useEffect(() => {
    if (!open) return;
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
  }, [open, recipeId, measureId, baseGroupId, suggestedRecipeId, suggestedYieldMPerM, mode, catalog]);

  const selectedType = catalog.types.find((item) => item.id === form.typeId);
  const selectedMeasure = catalog.measures.find((item) => item.id === form.measureId);
  const selectedBase = catalog.groups.find((item) => item.id === form.baseGroupId);
  const currentRecipe = catalog.recipes.find((item) => item.id === form.recipeId);
  const widthProfile = latestWidthProfile(catalog, form.baseGroupId, ['approved']);
  const editableWidthProfile = latestWidthProfile(catalog, form.baseGroupId, ['draft', 'pending_approval']);
  const usefulWidthMm = widthProfile
    ? numberOrZero(widthProfile.usable_width_mm)
    : form.usefulWidthMm;
  const theoreticalYield = form.cutBandWidthMm > 0 && usefulWidthMm > 0
    ? Math.floor(usefulWidthMm / form.cutBandWidthMm)
    : 0;
  const lateralRemainder = theoreticalYield > 0
    ? usefulWidthMm - theoreticalYield * form.cutBandWidthMm
    : 0;
  const recipeIsMutable = !currentRecipe
    || currentRecipe.status === 'draft'
    || currentRecipe.status === 'pending_approval';
  const identityLocked = Boolean(currentRecipe);
  const canWrite = capabilities.manage_strap_catalog;
  const canApproveWidthInline = canWrite && capabilities.approve_strap_recipe;
  const canSeeFinancial = capabilities.can_see_financial_values === true;
  const readOnly = !canWrite;
  const canEditRecipeFields = !readOnly && (recipeIsMutable || createRecipeVersion);
  const isSaving = saveWidthProfile.isPending
    || approveWidthProfile.isPending
    || saveConversion.isPending;

  const setField = <K extends keyof ConversionForm>(key: K, value: ConversionForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationError(null);
  };

  const validate = (): string | null => {
    if (!form.typeId && !form.typeName.trim()) {
      return 'Selecione uma família ou informe uma nova.';
    }
    if (!form.measureId && (!form.measureName.trim() || form.finishedWidthMm <= 0)) {
      return 'Selecione uma medida ou informe nome e largura final.';
    }
    if (!form.baseGroupId) return 'Selecione a napa-base.';
    if (!widthProfile && form.usefulWidthMm <= 0) return 'Informe a largura útil da napa-base.';
    if (!widthProfile && !canApproveWidthInline) {
      return 'A napa-base não possui perfil aprovado e seu acesso não permite aprová-lo neste fluxo.';
    }
    if (currentRecipe && !recipeIsMutable && !createRecipeVersion) {
      return 'A conversão aprovada é imutável. Crie uma nova versão para alterar os números.';
    }
    if (form.cutBandWidthMm <= 0) return 'A largura da banda deve ser maior que zero.';
    if (theoreticalYield <= 0) return 'A largura útil não comporta uma banda completa.';
    if (form.confirmedYield <= 0 || form.confirmedYield > theoreticalYield) {
      return `O rendimento confirmado deve estar entre 0 e ${theoreticalYield} m/m.`;
    }
    if (form.executorType === 'contractor' && !form.contractorId) {
      return 'Selecione o terceirizado padrão da conversão.';
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
      if (!resolvedWidthProfileId) {
        resolvedWidthProfileId = await saveWidthProfile.mutateAsync({
          id: editableWidthProfile?.id,
          baseGroupId: form.baseGroupId,
          usableWidthMm: form.usefulWidthMm,
          reason,
        });
        await approveWidthProfile.mutateAsync({
          profileId: resolvedWidthProfileId,
          reason,
        });
      }

      await saveConversion.mutateAsync({
        reason,
        payload: {
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
            confirmed_yield_m_per_m: form.confirmedYield,
            executor_type: form.executorType,
            default_contractor_id: form.executorType === 'contractor' ? form.contractorId : null,
            ...(canSeeFinancial ? { transformation_cost_per_m: form.transformationCost } : {}),
          },
        },
      });
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
              <Badge variant="secondary">Conversão técnica</Badge>
              <Badge variant="outline">Todas as cores</Badge>
            </div>
            <SheetTitle>{mode === 'create' ? 'Cadastrar conversão' : 'Editar conversão'}</SheetTitle>
            <SheetDescription>
              Defina os números uma única vez por família, medida e napa-base. A cor será cadastrada somente no estoque.
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
                <h3 id="strap-conversion-identity" className="text-sm font-bold">Identidade da conversão</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Família/tipo *</Label>
                  <Select
                    value={form.typeId || '__new__'}
                    onValueChange={(value) => {
                      const typeId = value === '__new__' ? '' : value;
                      setForm((current) => ({
                        ...current,
                        typeId,
                        typeName: typeId ? catalog.types.find((item) => item.id === typeId)?.name || '' : '',
                        measureId: '',
                        measureName: '',
                        finishedWidthMm: 0,
                      }));
                      setValidationError(null);
                    }}
                    disabled={readOnly || identityLocked}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">Nova família…</SelectItem>
                      {catalog.types.filter((item) => item.active).map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!form.typeId && (
                    <Input
                      value={form.typeName}
                      onChange={(event) => setField('typeName', event.target.value)}
                      placeholder="Ex.: TIRA CHATA"
                      disabled={readOnly || identityLocked}
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Medida final *</Label>
                  <Select
                    value={form.measureId || '__new__'}
                    onValueChange={(value) => {
                      const selectedId = value === '__new__' ? '' : value;
                      const measure = catalog.measures.find((item) => item.id === selectedId);
                      setForm((current) => ({
                        ...current,
                        measureId: selectedId,
                        measureName: measure?.display_name || '',
                        finishedWidthMm: numberOrZero(measure?.finished_width_mm),
                      }));
                      setValidationError(null);
                    }}
                    disabled={readOnly || identityLocked || (!form.typeId && !form.typeName.trim())}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">Nova medida…</SelectItem>
                      {catalog.measures
                        .filter((item) => item.active && item.strap_type_id === form.typeId)
                        .map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.display_name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {!form.measureId && (
                    <div className="grid grid-cols-[1fr_110px] gap-2">
                      <Input
                        value={form.measureName}
                        onChange={(event) => setField('measureName', event.target.value)}
                        placeholder="Ex.: 8 mm"
                        disabled={readOnly || identityLocked}
                      />
                      <NumberInput
                        value={form.finishedWidthMm}
                        onChange={(value) => setField('finishedWidthMm', value)}
                        unit="mm"
                        disabled={readOnly || identityLocked}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Napa-base *</Label>
                  <Select
                    value={form.baseGroupId}
                    onValueChange={(value) => {
                      const selectedWidthProfile = latestWidthProfile(catalog, value, ['approved'])
                        || latestWidthProfile(catalog, value, ['draft', 'pending_approval']);
                      setForm((current) => ({
                        ...current,
                        baseGroupId: value,
                        usefulWidthMm: numberOrZero(selectedWidthProfile?.usable_width_mm),
                      }));
                      setValidationError(null);
                    }}
                    disabled={readOnly || identityLocked}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione a base" /></SelectTrigger>
                    <SelectContent>
                      {catalog.groups.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-3" aria-labelledby="strap-conversion-numbers">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Factory className="h-4 w-4 text-primary" />
                  <h3 id="strap-conversion-numbers" className="text-sm font-bold">Números da conversão</h3>
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
                <Alert>
                  <Warning className="h-4 w-4" />
                  <AlertTitle>{canApproveWidthInline ? 'Preencha a largura útil' : 'Largura útil pendente'}</AlertTitle>
                  <AlertDescription>
                    {canApproveWidthInline
                      ? 'Ao salvar a conversão, o perfil da napa-base também será salvo e aprovado.'
                      : 'Aprove o perfil de largura da napa-base na aba Catálogo antes de salvar a conversão.'}
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="strap-conversion-useful-width">
                    Largura útil da napa {!widthProfile && <span className="text-destructive">*</span>}
                  </Label>
                  <NumberInput
                    id="strap-conversion-useful-width"
                    value={usefulWidthMm}
                    onChange={(value) => setField('usefulWidthMm', value)}
                    unit="mm"
                    disabled={Boolean(widthProfile) || !canApproveWidthInline || !canEditRecipeFields}
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
                  <Label htmlFor="strap-conversion-confirmed-yield">Rendimento confirmado *</Label>
                  <NumberInput
                    id="strap-conversion-confirmed-yield"
                    value={form.confirmedYield}
                    onChange={(value) => setField('confirmedYield', value)}
                    unit="m/m"
                    disabled={!canEditRecipeFields}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bandas completas</p>
                  <p className="font-mono text-lg font-bold">{theoreticalYield || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Teórico</p>
                  <p className="font-mono text-lg font-bold">{theoreticalYield ? `${theoreticalYield} m/m` : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sobra lateral</p>
                  <p className="font-mono text-lg font-bold">{theoreticalYield ? `${lateralRemainder} mm` : '—'}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
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
            </section>

            {!readOnly && (
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
                {isSaving ? 'Salvando…' : 'Salvar conversão'}
              </Button>
            )}
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}

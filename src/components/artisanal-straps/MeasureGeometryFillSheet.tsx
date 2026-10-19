/**
 * Janela de preenchimento — wizard 2 passos (grill Hub 19/10/2026).
 *
 * A) Tipo/medida → cria/liga grupo `TIPO NMM` + rendimento × bobina (espalha napas)
 * B) Cores canônicas (≥1) → SKU no grupo + variante Hub (mesma cor)
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  LockKey,
  Scissors,
  Warning,
} from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { StrapIdentityTrail } from '@/components/artisanal-straps/StrapIdentityTrail';
import {
  type ArtisanalStrapCapabilities,
  type ArtisanalStrapCatalog,
} from '@/hooks/useArtisanalStraps';
import {
  strapMeasureYieldBoardKey,
  useSetStrapMeasureGeometryYield,
  useStrapMeasureYieldBoard,
} from '@/hooks/useStrapMeasureYieldBoard';
import { saveArtisanalStrapMeasureHubFields } from '@/lib/saveArtisanalStrapMeasureHubFields';
import { ensureStrapMeasureStockGroup, strapStockGroupName } from '@/lib/ensureStrapMeasureStockGroup';
import { buildUniqueSkus } from '@/lib/createGroupWithColors';
import {
  formatStrapNapaGeometryLabel,
  strapGeometryYieldCeiling,
} from '@/lib/strapNapaGeometry';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface UntypedQueryResult {
  data: unknown;
  error: unknown;
}

interface UntypedSupabaseClient {
  rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<UntypedQueryResult>;
}

const db = supabase as unknown as UntypedSupabaseClient;

/** Bobina padrão da fábrica (grill Q15). */
export const DEFAULT_STRAP_NAPA_GEOMETRY = { widthMm: 1370, lengthMm: 1000 } as const;

export interface MeasureGeometryFillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: ArtisanalStrapCatalog;
  capabilities: ArtisanalStrapCapabilities;
  measureId?: string | null;
}

type WizardStep = 'rendimento' | 'cores';

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errMsg(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Erro desconhecido';
}

function preferPrimaryNapaId(families: Array<{ id: string; name: string }>): string | null {
  if (!families.length) return null;
  const soft = families.find((f) => /napa\s*soft/i.test(f.name));
  return (soft || families[0]).id;
}

export function MeasureGeometryFillSheet({
  open,
  onOpenChange,
  catalog,
  capabilities,
  measureId: initialMeasureId = null,
}: MeasureGeometryFillSheetProps) {
  const queryClient = useQueryClient();
  const boardQuery = useStrapMeasureYieldBoard(open);
  const saveYield = useSetStrapMeasureGeometryYield();

  const canWrite = capabilities.manage_strap_catalog === true;
  const canSeeFinancial = capabilities.can_see_financial_values === true;

  const [step, setStep] = useState<WizardStep>('rendimento');
  const [measureId, setMeasureId] = useState('');
  const [typeName, setTypeName] = useState('');
  const [finishedWidthMm, setFinishedWidthMm] = useState(0);
  const [bandMm, setBandMm] = useState(0);
  const [yieldMPerM, setYieldMPerM] = useState(0);
  const [laborCostPerM, setLaborCostPerM] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Estado após passo A (para o B).
  const [resolvedMeasureId, setResolvedMeasureId] = useState('');
  const [resolvedTypeId, setResolvedTypeId] = useState('');
  const [strapGroupId, setStrapGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [selectedColorIds, setSelectedColorIds] = useState<string[]>([]);

  const isNewMeasure = !measureId;
  const selectedMeasure = catalog.measures.find((item) => item.id === measureId);
  const selectedType = catalog.types.find((item) => item.id === selectedMeasure?.strap_type_id);
  const boardRow = (boardQuery.data || []).find((row) => row.measure_id === measureId);

  const effectiveTypeName = (selectedType?.name || typeName).trim();
  const effectiveWidth = selectedMeasure
    ? numberOrZero(selectedMeasure.finished_width_mm)
    : finishedWidthMm;
  const predictedGroupName = effectiveTypeName && effectiveWidth > 0
    ? strapStockGroupName(effectiveTypeName, effectiveWidth)
    : '';

  const napaPreviewQuery = useQuery({
    queryKey: ['napa-groups-matching-geometry', DEFAULT_STRAP_NAPA_GEOMETRY.widthMm, DEFAULT_STRAP_NAPA_GEOMETRY.lengthMm],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc('list_napa_groups_matching_geometry', {
        p_width_mm: DEFAULT_STRAP_NAPA_GEOMETRY.widthMm,
        p_length_mm: DEFAULT_STRAP_NAPA_GEOMETRY.lengthMm,
      });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return rows.map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          id: String(row.napa_group_id ?? ''),
          name: String(row.napa_group_name ?? ''),
          widthMm: Number(row.width_mm) || 0,
          lengthMm: Number(row.length_mm) || 0,
        };
      }).filter((row) => row.id && row.name);
    },
  });

  const napaFamilies = napaPreviewQuery.data || [];
  const geomKey = {
    minMm: Math.min(DEFAULT_STRAP_NAPA_GEOMETRY.widthMm, DEFAULT_STRAP_NAPA_GEOMETRY.lengthMm),
    maxMm: Math.max(DEFAULT_STRAP_NAPA_GEOMETRY.widthMm, DEFAULT_STRAP_NAPA_GEOMETRY.lengthMm),
  };
  const theoretical = strapGeometryYieldCeiling(geomKey, bandMm || undefined);

  const canonicalColors = useMemo(
    () => [...catalog.colors]
      .filter((color) => color.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [catalog.colors],
  );

  useEffect(() => {
    if (!open) return;
    setStep('rendimento');
    setValidationError(null);
    setSelectedColorIds([]);
    setResolvedMeasureId('');
    setResolvedTypeId('');
    setStrapGroupId('');
    setGroupName('');
    const seedId = initialMeasureId || '';
    setMeasureId(seedId);
    if (!seedId) {
      setTypeName('');
      setFinishedWidthMm(0);
      setBandMm(0);
      setYieldMPerM(0);
      setLaborCostPerM(0);
      return;
    }
    const measure = catalog.measures.find((item) => item.id === seedId);
    const type = catalog.types.find((item) => item.id === measure?.strap_type_id);
    setTypeName(type?.name || '');
    setFinishedWidthMm(numberOrZero(measure?.finished_width_mm));
    setLaborCostPerM(numberOrZero(measure?.preco_artesanal_per_m));
  }, [open, initialMeasureId, catalog.measures, catalog.types]);

  useEffect(() => {
    if (!open || step !== 'rendimento') return;
    const band = numberOrZero(boardRow?.cut_band_width_mm);
    const current = numberOrZero(boardRow?.sample_yield_m_per_m);
    if (band > 0) setBandMm((prev) => (prev > 0 ? prev : band));
    const ceiling = strapGeometryYieldCeiling(geomKey, band || bandMm || undefined);
    if (current > 0) {
      setYieldMPerM((prev) => (prev > 0 ? prev : current));
    } else if (ceiling > 0) {
      setYieldMPerM((prev) => (prev > 0 ? prev : ceiling));
    }
  }, [open, step, boardRow, bandMm, geomKey.minMm, geomKey.maxMm]);

  useEffect(() => {
    if (!open || step !== 'rendimento') return;
    if (boardRow?.has_yield) return;
    const ceiling = strapGeometryYieldCeiling(geomKey, bandMm || undefined);
    if (ceiling > 0) setYieldMPerM(ceiling);
  }, [bandMm, open, step, boardRow?.has_yield, geomKey.minMm, geomKey.maxMm]);

  const isSaving = busy || saveYield.isPending;

  const handleMeasureChange = (value: string) => {
    const nextId = value === '__new__' ? '' : value;
    setMeasureId(nextId);
    setValidationError(null);
    setBandMm(0);
    setYieldMPerM(0);
    if (!nextId) {
      setTypeName('');
      setFinishedWidthMm(0);
      setLaborCostPerM(0);
      return;
    }
    const measure = catalog.measures.find((item) => item.id === nextId);
    const type = catalog.types.find((item) => item.id === measure?.strap_type_id);
    setTypeName(type?.name || '');
    setFinishedWidthMm(numberOrZero(measure?.finished_width_mm));
    setLaborCostPerM(numberOrZero(measure?.preco_artesanal_per_m));
  };

  const ensureMeasureId = async (): Promise<{
    measureId: string;
    typeId: string;
    typeName: string;
    widthMm: number;
  }> => {
    if (measureId) {
      const typeId = selectedType?.id || selectedMeasure?.strap_type_id || '';
      if (!typeId) throw new Error('Tipo da medida não encontrado.');
      return {
        measureId,
        typeId,
        typeName: effectiveTypeName,
        widthMm: effectiveWidth,
      };
    }
    const trimmedType = typeName.trim();
    if (!trimmedType) throw new Error('Informe o nome do tipo de tira.');
    if (!(finishedWidthMm > 0)) throw new Error('Informe a medida final (mm).');

    const typeResult = await db.rpc('save_artisanal_strap_type', {
      p_name: trimmedType,
      p_id: null,
      p_active: true,
      p_reason: 'Hub: criar tipo (wizard rendimento)',
    });
    if (typeResult.error) throw typeResult.error;
    const typeId = String(typeResult.data ?? '');
    if (!typeId) throw new Error('Não foi possível criar o tipo de tira.');

    const displayName = `${finishedWidthMm.toLocaleString('pt-BR')} mm`;
    const measureResult = await db.rpc('save_artisanal_strap_measure', {
      p_strap_type_id: typeId,
      p_display_name: displayName,
      p_finished_width_mm: finishedWidthMm,
      p_id: null,
      p_active: true,
      p_reason: 'Hub: criar medida (wizard rendimento)',
    });
    if (measureResult.error) throw measureResult.error;
    const createdMeasureId = String(measureResult.data ?? '');
    if (!createdMeasureId) throw new Error('Não foi possível criar a medida.');

    return {
      measureId: createdMeasureId,
      typeId,
      typeName: trimmedType,
      widthMm: finishedWidthMm,
    };
  };

  const handleSaveStepA = async () => {
    setValidationError(null);
    if (!canWrite) {
      setValidationError('Sem permissão para gravar rendimento.');
      return;
    }
    if (!(yieldMPerM > 0)) {
      setValidationError('Informe o rendimento (m de tira por m de napa).');
      return;
    }
    if (!(bandMm > 0)) {
      setValidationError('Informe a banda de corte (mm).');
      return;
    }

    setBusy(true);
    try {
      const ensured = await ensureMeasureId();
      const group = await ensureStrapMeasureStockGroup({
        measureId: ensured.measureId,
        typeName: ensured.typeName,
        finishedWidthMm: ensured.widthMm,
        cutBandWidthMm: bandMm,
      });

      await saveYield.mutateAsync({
        measureId: ensured.measureId,
        yieldMPerM,
        cutBandWidthMm: bandMm,
        geometryWidthMm: DEFAULT_STRAP_NAPA_GEOMETRY.widthMm,
        geometryLengthMm: DEFAULT_STRAP_NAPA_GEOMETRY.lengthMm,
      });

      if (canSeeFinancial && laborCostPerM >= 0) {
        await saveArtisanalStrapMeasureHubFields(
          ensured.measureId,
          { precoArtesanalPerM: laborCostPerM },
          'Hub: mão de obra da medida (wizard)',
        );
      }

      setResolvedMeasureId(ensured.measureId);
      setResolvedTypeId(ensured.typeId);
      setStrapGroupId(group.strapGroupId);
      setGroupName(group.groupName);
      setMeasureId(ensured.measureId);
      toast.success(
        group.created
          ? `Grupo ${group.groupName} criado e rendimento espalhado.`
          : `Grupo ${group.groupName} ligado e rendimento espalhado.`,
      );
      await queryClient.invalidateQueries({ queryKey: strapMeasureYieldBoardKey });
      await queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
      setStep('cores');
    } catch (error) {
      const message = errMsg(error);
      setValidationError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const toggleColor = (colorId: string, checked: boolean) => {
    setSelectedColorIds((prev) => {
      if (checked) return prev.includes(colorId) ? prev : [...prev, colorId];
      return prev.filter((id) => id !== colorId);
    });
  };

  const handleSaveStepB = async () => {
    setValidationError(null);
    if (selectedColorIds.length === 0) {
      setValidationError('Escolha ao menos uma cor canônica.');
      return;
    }
    if (!resolvedMeasureId || !strapGroupId || !resolvedTypeId) {
      setValidationError('Conclua o rendimento (passo 1) antes das cores.');
      return;
    }

    const primaryNapaId = preferPrimaryNapaId(napaFamilies);
    if (!primaryNapaId) {
      setValidationError('Nenhuma napa elegível na geometria 1370×1000 — não dá para publicar no Hub.');
      return;
    }

    setBusy(true);
    try {
      const colors = selectedColorIds.map((id) => {
        const color = canonicalColors.find((item) => item.id === id);
        if (!color) throw new Error('Cor canônica inválida.');
        return color;
      });

      const existingSkus = catalog.products.map((product) => product.sku);
      const skus = buildUniqueSkus(groupName || 'TIRA', colors.map((c) => c.name), existingSkus);

      // Porta oficial do Hub: 1 cor canônica = 1 SKU no grupo + 1 variante (Q16).
      for (let index = 0; index < colors.length; index += 1) {
        const color = colors[index];
        const { data, error } = await db.rpc('save_artisanal_strap_catalog_bundle', {
          p_reason: 'Hub: cor = variante (wizard rendimento)',
          p_payload: {
            type: { id: resolvedTypeId },
            measure: { id: resolvedMeasureId },
            variant: {
              base_group_id: primaryNapaId,
              identity_basis: 'reference_base',
              identity_group_id: null,
              internal_production_enabled: true,
              color_id: color.id,
              min_stock_m: 0,
              min_stock_replenishment_mode: 'internal',
              purchase_enabled: false,
              status: 'active',
              review_reason: null,
            },
            product: {
              name: `${groupName}: ${color.name}`,
              sku: skus[index],
              category: 'Material Base',
            },
            recipe: undefined,
          },
        });
        if (error) throw error;

        const finishedProductId = String(
          (data as { finished_product_id?: string } | null)?.finished_product_id ?? '',
        );
        if (!finishedProductId) {
          throw new Error(`Bundle não devolveu o produto da cor ${color.name}.`);
        }

        // Writer legado não grava group_id/color — vincula ao grupo TIPO NMM.
        const bind = await db.rpc('bind_strap_finished_product_group', {
          p_product_id: finishedProductId,
          p_group_id: strapGroupId,
          p_color: color.name,
          p_reason: 'Hub: SKU no grupo da medida (wizard)',
        });
        if (bind.error) throw bind.error;
      }

      await queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`${colors.length} cor(es) publicadas no estoque e no Hub.`);
      onOpenChange(false);
    } catch (error) {
      const message = errMsg(error);
      setValidationError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && isSaving) return;
        onOpenChange(next);
      }}
    >
      <SheetContent side="right" className="w-full p-0 sm:max-w-xl" aria-busy={isSaving}>
        <div className="flex min-h-full flex-col">
          <SheetHeader className="border-b border-border px-4 pb-4 pt-5 pr-12 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Hub de Tiras</Badge>
              <Badge variant={step === 'rendimento' ? 'default' : 'secondary'}>1 · Rendimento</Badge>
              <Badge variant={step === 'cores' ? 'default' : 'secondary'}>2 · Cores</Badge>
            </div>
            <SheetTitle>
              {step === 'rendimento'
                ? (isNewMeasure ? 'Cadastrar medida e rendimento' : 'Informar rendimento da bobina')
                : 'Cores da tira (estoque = Hub)'}
            </SheetTitle>
            <SheetDescription>
              {step === 'rendimento'
                ? 'Salvar cria o grupo de estoque (ex.: TIRA CHATA 20MM) e espalha o m/m em todas as napas da bobina 1370×1000.'
                : 'Escolha as cores canônicas. Cada cor vira SKU no grupo e variante no Hub — a mesma identidade.'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 px-4 py-5 sm:px-6">
            {!canWrite && (
              <Alert>
                <LockKey className="h-4 w-4" />
                <AlertTitle>Somente consulta</AlertTitle>
                <AlertDescription>Sua permissão não permite gravar.</AlertDescription>
              </Alert>
            )}

            <StrapIdentityTrail
              typeName={effectiveTypeName || undefined}
              measureName={selectedMeasure?.display_name
                || (effectiveWidth > 0 ? `${effectiveWidth.toLocaleString('pt-BR')} mm` : undefined)}
              baseName={step === 'cores' ? groupName : (predictedGroupName || formatStrapNapaGeometryLabel(geomKey))}
              baseLabel={step === 'cores' ? 'Grupo' : (predictedGroupName ? 'Grupo (ao salvar)' : 'Bobina')}
            />

            {step === 'rendimento' ? (
              <>
                <Alert>
                  <Scissors className="h-4 w-4" />
                  <AlertTitle>Grupo = a própria medida</AlertTitle>
                  <AlertDescription>
                    Não precisa escolher grupo à parte.
                    {predictedGroupName
                      ? <> Ao salvar nasce/liga <span className="font-semibold text-foreground">{predictedGroupName}</span>.</>
                      : ' Informe tipo e medida para prever o nome do grupo.'}
                  </AlertDescription>
                </Alert>

                <section className="space-y-3" aria-labelledby="geom-fill-measure">
                  <h3 id="geom-fill-measure" className="text-sm font-bold">Tipo e medida</h3>
                  <div className="space-y-1.5">
                    <Label htmlFor="geom-fill-measure-select">Medida *</Label>
                    <Select
                      value={measureId || '__new__'}
                      onValueChange={handleMeasureChange}
                      disabled={!canWrite || isSaving}
                    >
                      <SelectTrigger id="geom-fill-measure-select">
                        <SelectValue placeholder="Selecione a medida" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__new__">Nova medida…</SelectItem>
                        {catalog.measures
                          .filter((measure) => measure.active)
                          .sort((left, right) => {
                            const leftType = catalog.types.find((t) => t.id === left.strap_type_id)?.name || '';
                            const rightType = catalog.types.find((t) => t.id === right.strap_type_id)?.name || '';
                            return `${leftType} ${left.display_name}`.localeCompare(
                              `${rightType} ${right.display_name}`,
                              'pt-BR',
                            );
                          })
                          .map((measure) => (
                            <SelectItem key={measure.id} value={measure.id}>
                              {catalog.types.find((t) => t.id === measure.strap_type_id)?.name || 'Tira'}
                              {' · '}
                              {measure.display_name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {isNewMeasure && (
                    <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                      <div className="space-y-1.5">
                        <Label htmlFor="geom-fill-type-name">Nome do tipo *</Label>
                        <Input
                          id="geom-fill-type-name"
                          value={typeName}
                          onChange={(event) => setTypeName(event.target.value)}
                          placeholder="Ex.: TIRA CHATA"
                          disabled={!canWrite || isSaving}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="geom-fill-width">Medida final *</Label>
                        <NumberInput
                          id="geom-fill-width"
                          value={finishedWidthMm}
                          onChange={(value) => setFinishedWidthMm(Number(value) || 0)}
                          min={0}
                          step="1"
                          decimals={1}
                          unit="mm"
                          disabled={!canWrite || isSaving}
                        />
                      </div>
                    </div>
                  )}
                </section>

                <section className="space-y-3 rounded-lg border border-border bg-muted/15 p-4" aria-labelledby="geom-fill-yield">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id="geom-fill-yield" className="text-sm font-bold">Rendimento da bobina</h3>
                    <Badge variant="outline">{formatStrapNapaGeometryLabel(geomKey)}</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="geom-fill-yield-input">Rendimento (m/m) *</Label>
                      <NumberInput
                        id="geom-fill-yield-input"
                        value={yieldMPerM}
                        onChange={(value) => setYieldMPerM(Number(value) || 0)}
                        min={0}
                        step="1"
                        decimals={2}
                        unit="m/m"
                        disabled={!canWrite || isSaving}
                      />
                      {theoretical > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          Sugestão teórica (floor bobina ÷ banda): {theoretical.toLocaleString('pt-BR')} m/m
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="geom-fill-band">Banda de corte *</Label>
                      <NumberInput
                        id="geom-fill-band"
                        value={bandMm}
                        onChange={(value) => setBandMm(Number(value) || 0)}
                        min={0}
                        step="1"
                        decimals={1}
                        unit="mm"
                        disabled={!canWrite || isSaving}
                      />
                    </div>
                  </div>
                  {canSeeFinancial && (
                    <div className="max-w-xs space-y-1.5">
                      <Label htmlFor="geom-fill-labor">Mão de obra (R$/m)</Label>
                      <NumberInput
                        id="geom-fill-labor"
                        value={laborCostPerM}
                        onChange={(value) => setLaborCostPerM(Number(value) || 0)}
                        min={0}
                        step="0.01"
                        decimals={2}
                        unit="R$/m"
                        disabled={!canWrite || isSaving}
                      />
                    </div>
                  )}
                </section>

                <section className="space-y-2" aria-labelledby="geom-fill-families">
                  <h3 id="geom-fill-families" className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Napas que recebem este rendimento ({napaFamilies.length})
                  </h3>
                  {napaPreviewQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">Carregando famílias…</p>
                  ) : napaFamilies.length === 0 ? (
                    <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                      <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" weight="bold" />
                      Nenhuma napa elegível com ficha 1370×1000. Cadastre largura/comprimento em Materiais → Ficha de componente.
                    </p>
                  ) : (
                    <ul className="grid gap-1.5 sm:grid-cols-2">
                      {napaFamilies.map((family) => (
                        <li
                          key={family.id}
                          className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground"
                        >
                          {family.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            ) : (
              <section className="space-y-3" aria-labelledby="geom-fill-colors">
                <div>
                  <h3 id="geom-fill-colors" className="text-sm font-bold">Cores canônicas *</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Obrigatório escolher ao menos uma. Cada cor cria o SKU em{' '}
                    <span className="font-semibold text-foreground">{groupName || 'grupo'}</span>
                    {' '}e a variante no Hub.
                  </p>
                </div>
                <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {canonicalColors.map((color) => {
                    const checked = selectedColorIds.includes(color.id);
                    return (
                      <label
                        key={color.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/40',
                          checked && 'bg-muted/50',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleColor(color.id, value === true)}
                          disabled={!canWrite || isSaving}
                        />
                        <span className="font-medium text-foreground">{color.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedColorIds.length} selecionada(s)
                </p>
              </section>
            )}

            {validationError && (
              <Alert variant="destructive">
                <Warning className="h-4 w-4" />
                <AlertTitle>Não foi possível salvar</AlertTitle>
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}
          </div>

          <SheetFooter className="border-t border-border px-4 py-4 sm:px-6">
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                className="h-10"
                disabled={isSaving}
                onClick={() => {
                  if (step === 'cores') {
                    setStep('rendimento');
                    setValidationError(null);
                    return;
                  }
                  onOpenChange(false);
                }}
              >
                {step === 'cores' ? 'Voltar' : 'Fechar'}
              </Button>
              {step === 'rendimento' ? (
                <Button
                  type="button"
                  className="h-10 gap-2"
                  disabled={!canWrite || isSaving || !(yieldMPerM > 0) || !(bandMm > 0)}
                  onClick={() => void handleSaveStepA()}
                >
                  {isSaving ? 'Gravando…' : (
                    <>
                      Salvar rendimento
                      <ArrowRight className="h-4 w-4" weight="bold" />
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-10 gap-2"
                  disabled={!canWrite || isSaving || selectedColorIds.length === 0}
                  onClick={() => void handleSaveStepB()}
                >
                  {isSaving ? 'Publicando…' : (
                    <>
                      <Check className="h-4 w-4" weight="bold" />
                      Concluir cores
                    </>
                  )}
                </Button>
              )}
            </div>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}

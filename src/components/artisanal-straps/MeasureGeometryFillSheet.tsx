/**
 * Janela de preenchimento otimizada (grill Hub 19/10/2026).
 *
 * Um rendimento + banda por medida × geometria de bobina; ao salvar,
 * espalha para todas as napas elegíveis com a mesma ficha
 * (1000×1370 ≡ 1370×1000). Sem receita por napa.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
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
  type StrapMeasureYieldBoardRow,
} from '@/hooks/useStrapMeasureYieldBoard';
import { saveArtisanalStrapMeasureHubFields } from '@/lib/saveArtisanalStrapMeasureHubFields';
import {
  formatStrapNapaGeometryLabel,
  strapGeometryYieldCeiling,
  type StrapNapaGeometryKey,
} from '@/lib/strapNapaGeometry';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface UntypedQueryResult {
  data: unknown;
  error: unknown;
}

interface UntypedSupabaseClient {
  rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<UntypedQueryResult>;
  from: (table: string) => {
    upsert: (
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ) => PromiseLike<UntypedQueryResult>;
  };
}

const db = supabase as unknown as UntypedSupabaseClient;

export interface MeasureGeometryFillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: ArtisanalStrapCatalog;
  capabilities: ArtisanalStrapCapabilities;
  /** Medida pré-selecionada (card / deep-link). */
  measureId?: string | null;
}

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

function primaryGeometry(row: StrapMeasureYieldBoardRow | undefined): {
  key: StrapNapaGeometryKey;
  familyNames: string[];
} | null {
  if (!row?.geometries.length) return null;
  const primary = [...row.geometries].sort((a, b) => b.family_count - a.family_count)[0];
  if (!primary) return null;
  return {
    key: {
      minMm: Number(primary.geom_min_mm) || 0,
      maxMm: Number(primary.geom_max_mm) || 0,
    },
    familyNames: primary.family_names?.length
      ? primary.family_names
      : row.families.map((f) => f.napa_group_name),
  };
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

  const [measureId, setMeasureId] = useState('');
  const [typeName, setTypeName] = useState('');
  const [finishedWidthMm, setFinishedWidthMm] = useState(0);
  const [strapGroupId, setStrapGroupId] = useState('');
  const [bandMm, setBandMm] = useState(0);
  const [yieldMPerM, setYieldMPerM] = useState(0);
  const [laborCostPerM, setLaborCostPerM] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const boardRows = boardQuery.data || [];
  const selectedRow = boardRows.find((row) => row.measure_id === measureId);
  const isNewMeasure = !measureId;

  const strapGroups = useMemo(
    () => catalog.groups
      .filter((group) => group.is_artisanal_strap === true || /tira|overlock|meia.?cana|elastico/i.test(group.name || ''))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [catalog.groups],
  );

  const geometry = useMemo(() => primaryGeometry(selectedRow), [selectedRow]);

  // Prefill ao abrir / trocar medida.
  useEffect(() => {
    if (!open) return;
    setValidationError(null);
    const seedId = initialMeasureId || '';
    setMeasureId(seedId);
    if (!seedId) {
      setTypeName('');
      setFinishedWidthMm(0);
      setStrapGroupId('');
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

  // Quando o board carrega a medida, preenche banda/yield/teórico e grupo.
  useEffect(() => {
    if (!open || !measureId || !selectedRow) return;
    const band = numberOrZero(selectedRow.cut_band_width_mm);
    const geom = primaryGeometry(selectedRow);
    const theoretical = geom
      ? strapGeometryYieldCeiling(geom.key, band || undefined)
      : 0;
    const current = numberOrZero(selectedRow.sample_yield_m_per_m);
    setBandMm((prev) => (prev > 0 ? prev : band));
    setYieldMPerM((prev) => {
      if (prev > 0) return prev;
      return current > 0 ? current : theoretical;
    });
    if (selectedRow.strap_group_id) {
      setStrapGroupId(selectedRow.strap_group_id);
    }
  }, [open, measureId, selectedRow]);

  // Recalcula teórico quando a banda muda e ainda não há yield confirmado.
  useEffect(() => {
    if (!open || !geometry) return;
    if (selectedRow?.has_yield) return;
    const theoretical = strapGeometryYieldCeiling(geometry.key, bandMm || undefined);
    if (theoretical > 0) {
      setYieldMPerM((prev) => (prev > 0 && selectedRow?.has_yield ? prev : theoretical));
    }
  }, [open, bandMm, geometry, selectedRow?.has_yield]);

  const theoretical = geometry
    ? strapGeometryYieldCeiling(geometry.key, bandMm || undefined)
    : 0;
  const familyNames = geometry?.familyNames ?? [];
  const selectedMeasure = catalog.measures.find((item) => item.id === measureId);
  const selectedType = catalog.types.find((item) => item.id === selectedMeasure?.strap_type_id);
  const selectedGroup = strapGroups.find((group) => group.id === strapGroupId);

  const isSaving = saveYield.isPending || creating;

  const handleMeasureChange = (value: string) => {
    const nextId = value === '__new__' ? '' : value;
    setMeasureId(nextId);
    setValidationError(null);
    setBandMm(0);
    setYieldMPerM(0);
    if (!nextId) {
      setTypeName('');
      setFinishedWidthMm(0);
      setStrapGroupId('');
      setLaborCostPerM(0);
      return;
    }
    const measure = catalog.measures.find((item) => item.id === nextId);
    const type = catalog.types.find((item) => item.id === measure?.strap_type_id);
    setTypeName(type?.name || '');
    setFinishedWidthMm(numberOrZero(measure?.finished_width_mm));
    setLaborCostPerM(numberOrZero(measure?.preco_artesanal_per_m));
  };

  const ensureMeasureId = async (): Promise<string> => {
    if (measureId) return measureId;

    const trimmedType = typeName.trim();
    if (!trimmedType) throw new Error('Informe o nome do tipo de tira.');
    if (!(finishedWidthMm > 0)) throw new Error('Informe a medida final (mm).');
    if (!strapGroupId) throw new Error('Vincule o grupo de estoque da tira.');

    const typeResult = await db.rpc('save_artisanal_strap_type', {
      p_name: trimmedType,
      p_id: null,
      p_active: true,
      p_reason: 'Hub: criar tipo para rendimento por geometria',
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
      p_reason: 'Hub: criar medida para rendimento por geometria',
    });
    if (measureResult.error) throw measureResult.error;
    const createdMeasureId = String(measureResult.data ?? '');
    if (!createdMeasureId) throw new Error('Não foi possível criar a medida.');

    const mapResult = await db.from('strap_hub_measure_group_map').upsert(
      { measure_id: createdMeasureId, strap_group_id: strapGroupId },
      { onConflict: 'measure_id' },
    );
    if (mapResult.error) throw mapResult.error;

    return createdMeasureId;
  };

  const handleSave = async () => {
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

    setCreating(true);
    try {
      // Medida existente sem mapa: exige grupo antes do yield.
      if (measureId && selectedRow && !selectedRow.strap_group_id) {
        if (!strapGroupId) {
          throw new Error('Vincule o grupo de estoque da tira antes de gravar.');
        }
        const mapResult = await db.from('strap_hub_measure_group_map').upsert(
          { measure_id: measureId, strap_group_id: strapGroupId },
          { onConflict: 'measure_id' },
        );
        if (mapResult.error) throw mapResult.error;
      }

      const resolvedMeasureId = await ensureMeasureId();
      const geom = geometry?.key;

      await saveYield.mutateAsync({
        measureId: resolvedMeasureId,
        yieldMPerM,
        cutBandWidthMm: bandMm,
        geometryWidthMm: geom?.maxMm || null,
        geometryLengthMm: geom?.minMm || null,
      });

      if (canSeeFinancial && laborCostPerM >= 0) {
        await saveArtisanalStrapMeasureHubFields(
          resolvedMeasureId,
          { precoArtesanalPerM: laborCostPerM },
          'Hub: mão de obra da medida (geometria)',
        );
      }

      await queryClient.invalidateQueries({ queryKey: strapMeasureYieldBoardKey });
      await queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
      onOpenChange(false);
    } catch (error) {
      const message = errMsg(error);
      setValidationError(message);
      toast.error(message);
    } finally {
      setCreating(false);
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
              <Badge variant="secondary">Rendimento × bobina</Badge>
              <Badge variant="outline">Todas as napas da geometria</Badge>
            </div>
            <SheetTitle>
              {isNewMeasure ? 'Cadastrar medida e rendimento' : 'Informar rendimento da bobina'}
            </SheetTitle>
            <SheetDescription>
              Um número cobre Soft, Glow, Sudani… com a mesma ficha (1000×1370 = 1370×1000).
              Cores vêm do cadastro de cada napa — não se escolhem aqui.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 px-4 py-5 sm:px-6">
            {!canWrite && (
              <Alert>
                <LockKey className="h-4 w-4" />
                <AlertTitle>Somente consulta</AlertTitle>
                <AlertDescription>Sua permissão não permite gravar rendimento.</AlertDescription>
              </Alert>
            )}

            <StrapIdentityTrail
              typeName={selectedType?.name || typeName || undefined}
              measureName={selectedMeasure?.display_name
                || (finishedWidthMm > 0 ? `${finishedWidthMm.toLocaleString('pt-BR')} mm` : undefined)}
              baseName={geometry
                ? formatStrapNapaGeometryLabel(geometry.key)
                : selectedGroup?.name}
              baseLabel={geometry ? 'Bobina' : 'Grupo'}
            />

            <Alert>
              <Scissors className="h-4 w-4" />
              <AlertTitle>Otimização automática</AlertTitle>
              <AlertDescription>
                Ao salvar, o rendimento e a banda são espalhados para todas as napas elegíveis
                com a mesma geometria. Napa nova com ficha igual herda sozinha.
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

              {(isNewMeasure || (selectedRow && !selectedRow.strap_group_id)) && (
                <div className="space-y-1.5">
                  <Label htmlFor="geom-fill-group">Grupo de estoque da tira *</Label>
                  <Select
                    value={strapGroupId || undefined}
                    onValueChange={setStrapGroupId}
                    disabled={!canWrite || isSaving}
                  >
                    <SelectTrigger id="geom-fill-group">
                      <SelectValue placeholder="Ex.: TIRA CHATA 20MM" />
                    </SelectTrigger>
                    <SelectContent>
                      {strapGroups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Liga a medida do Hub ao grupo onde o rendimento fica gravado.
                  </p>
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-lg border border-border bg-muted/15 p-4" aria-labelledby="geom-fill-yield">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="geom-fill-yield" className="text-sm font-bold">Rendimento da bobina</h3>
                {geometry && (
                  <Badge variant="outline">{formatStrapNapaGeometryLabel(geometry.key)}</Badge>
                )}
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
                  <p className="text-[11px] text-muted-foreground">
                    Um valor por medida — igual para todas as napas.
                  </p>
                </div>
              )}
            </section>

            <section className="space-y-2" aria-labelledby="geom-fill-families">
              <h3 id="geom-fill-families" className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Napas que recebem este rendimento ({familyNames.length})
              </h3>
              {boardQuery.isLoading && measureId ? (
                <p className="text-sm text-muted-foreground">Carregando famílias…</p>
              ) : familyNames.length === 0 ? (
                <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" weight="bold" />
                  {isNewMeasure
                    ? 'Depois de gravar a medida, o sistema lista as napas pela ficha de componente.'
                    : 'Nenhuma napa elegível com ficha nesta geometria. Cadastre largura/comprimento em Materiais → Ficha de componente.'}
                </p>
              ) : (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {familyNames.map((name) => (
                    <li
                      key={name}
                      className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </section>

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
                onClick={() => onOpenChange(false)}
              >
                Fechar
              </Button>
              <Button
                type="button"
                className="h-10 gap-2"
                disabled={!canWrite || isSaving || !(yieldMPerM > 0) || !(bandMm > 0)}
                onClick={() => void handleSave()}
              >
                <FloppyDisk className="h-4 w-4" weight="bold" />
                {isSaving ? 'Gravando…' : 'Salvar e espalhar'}
              </Button>
            </div>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}

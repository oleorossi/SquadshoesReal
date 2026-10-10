import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleNotch as Loader2, Warning } from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import {
  useArtisanalStrapCatalog,
  useSaveArtisanalStrapMaterialConversions,
  useStrapBaseGroupCandidates,
} from '@/hooks/useArtisanalStraps';
import { describePostgrestError } from '@/lib/postgrestErrors';
import {
  resolveStrapMeasureForYield,
  siblingStrapRecipeDefaults,
  strapBasesMissingRecipeForMeasure,
  theoreticalStrapYieldMPerM,
} from '@/lib/strapMeasureYieldFromConsumption';

export interface StrapMeasureYieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Id da medida no Hub (preferido). */
  measureId?: string | null;
  /** Rótulo da preview quando o id ainda não veio. */
  measureName?: string | null;
  /** Nome do tipo na tela de consumo (ex.: "TIRA OVERLOCK 5MM"). */
  typeLabel: string;
  suggestedCutBandMm?: number | null;
  suggestedYieldMPerM?: number | null;
  /** Depois de confirmar e invalidar o consumo. */
  onSaved?: () => void;
}

/**
 * Modal do §03: um rendimento por medida, aplicado a todas as napas elegíveis
 * ainda sem receita. Persiste via `save_artisanal_strap_material_conversions`
 * com confirm=true (mesmo writer do Hub).
 */
export default function StrapMeasureYieldDialog({
  open,
  onOpenChange,
  measureId,
  measureName,
  typeLabel,
  suggestedCutBandMm,
  suggestedYieldMPerM,
  onSaved,
}: StrapMeasureYieldDialogProps) {
  const queryClient = useQueryClient();
  const catalogQuery = useArtisanalStrapCatalog(false, { enabled: open });
  const candidatesQuery = useStrapBaseGroupCandidates(open);
  const saveConversions = useSaveArtisanalStrapMaterialConversions();

  const catalog = catalogQuery.data;
  const canWrite = catalog?.capabilities.manage_strap_catalog === true;
  const canApprove = catalog?.capabilities.approve_strap_recipe === true;

  const measure = useMemo(
    () => resolveStrapMeasureForYield(catalog, { measureId, measureName }),
    [catalog, measureId, measureName],
  );

  const missingBases = useMemo(() => {
    if (!measure) return [];
    return strapBasesMissingRecipeForMeasure(
      catalog,
      candidatesQuery.data || [],
      measure.id,
    );
  }, [catalog, candidatesQuery.data, measure]);

  const siblingDefaults = useMemo(() => {
    if (!measure) return { cutBandWidthMm: 0, confirmedYieldMPerM: 0 };
    return siblingStrapRecipeDefaults(catalog, measure.id);
  }, [catalog, measure]);

  const [cutBandWidthMm, setCutBandWidthMm] = useState(0);
  const [confirmedYield, setConfirmedYield] = useState(0);
  const [reason, setReason] = useState('Rendimento confirmado pelo consumo do PV');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const cut = Number(suggestedCutBandMm) > 0
      ? Number(suggestedCutBandMm)
      : siblingDefaults.cutBandWidthMm;
    const yieldM = Number(suggestedYieldMPerM) > 0
      ? Number(suggestedYieldMPerM)
      : siblingDefaults.confirmedYieldMPerM;
    setCutBandWidthMm(cut > 0 ? cut : 0);
    setConfirmedYield(yieldM > 0 ? yieldM : 0);
    setReason('Rendimento confirmado pelo consumo do PV');
    setValidationError(null);
  }, [
    open,
    measure?.id,
    suggestedCutBandMm,
    suggestedYieldMPerM,
    siblingDefaults.cutBandWidthMm,
    siblingDefaults.confirmedYieldMPerM,
  ]);

  const minUsableWidth = useMemo(() => {
    const widths = missingBases
      .map((base) => Number(base.usable_width_mm) || 0)
      .filter((value) => value > 0);
    if (widths.length === 0) return 0;
    return Math.min(...widths);
  }, [missingBases]);

  const theoreticalYield = theoreticalStrapYieldMPerM(minUsableWidth, cutBandWidthMm);

  const typeName = useMemo(() => {
    if (!measure || !catalog) return typeLabel;
    return catalog.types.find((entry) => entry.id === measure.strap_type_id)?.name
      || typeLabel;
  }, [catalog, measure, typeLabel]);

  const handleSave = async () => {
    if (!measure) {
      setValidationError('Não foi possível identificar a medida da tira no Hub.');
      return;
    }
    if (!canWrite || !canApprove) {
      setValidationError(
        'É preciso permissão de catálogo e de aprovação de receita para confirmar o rendimento.',
      );
      return;
    }
    if (missingBases.length === 0) {
      setValidationError(
        'Todas as napas elegíveis já têm receita para esta medida. Abra o Hub de Tiras se o consumo ainda estiver incompleto.',
      );
      return;
    }
    if (!(cutBandWidthMm > 0)) {
      setValidationError('Informe a largura da banda de corte (mm).');
      return;
    }
    if (!(confirmedYield > 0)) {
      setValidationError('Informe o rendimento confirmado (m de tira por m de napa).');
      return;
    }
    if (theoreticalYield > 0 && confirmedYield > theoreticalYield) {
      setValidationError(
        `O rendimento não pode passar de ${theoreticalYield} m/m (largura útil ÷ banda).`,
      );
      return;
    }
    if (!reason.trim()) {
      setValidationError('Informe o motivo da alteração.');
      return;
    }

    setValidationError(null);
    try {
      await saveConversions.mutateAsync({
        reason: reason.trim(),
        confirm: true,
        payload: {
          type: { id: measure.strap_type_id },
          measure: { id: measure.id },
          materials: missingBases.map((base) => ({
            base_group_id: base.id,
            recipe: {
              cut_band_width_mm: cutBandWidthMm,
              confirmed_yield_m_per_m: confirmedYield,
              executor_type: 'factory' as const,
              default_contractor_id: null,
            },
          })),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['pv-consumption'] });
      onOpenChange(false);
      onSaved?.();
    } catch (error: unknown) {
      setValidationError(describePostgrestError(error));
    }
  };

  const loading = catalogQuery.isLoading || candidatesQuery.isLoading;
  const saving = saveConversions.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Informar rendimento da tira</DialogTitle>
          <DialogDescription>
            Um rendimento para {typeName}
            {measure ? ` · ${measure.display_name}` : ''}
            . Grava no Hub para todas as napas ainda sem receita desta medida.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando catálogo de tiras…
          </div>
        ) : !measure ? (
          <Alert variant="destructive">
            <Warning className="h-4 w-4" />
            <AlertTitle>Medida não encontrada</AlertTitle>
            <AlertDescription>
              Não deu para casar esta tira com uma medida do Hub. Cadastre o
              rendimento em Tiras artesanais → Calculadora.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {(!canWrite || !canApprove) && (
              <Alert>
                <Warning className="h-4 w-4" />
                <AlertTitle>Somente consulta</AlertTitle>
                <AlertDescription>
                  Peça a um administrador a permissão de catálogo e aprovação de
                  receita, ou cadastre o rendimento no Hub de Tiras.
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {missingBases.length === 0 ? (
                <span>Nenhuma napa pendente de receita para esta medida.</span>
              ) : (
                <span>
                  Será confirmado em{' '}
                  <span className="font-semibold text-foreground">
                    {missingBases.length}
                  </span>
                  {' '}
                  {missingBases.length === 1 ? 'napa' : 'napas'}
                  : {missingBases.slice(0, 4).map((b) => b.name).join(', ')}
                  {missingBases.length > 4 ? ` +${missingBases.length - 4}` : ''}.
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="strap-yield-cut-band">Banda de corte (mm) *</Label>
                <NumberInput
                  id="strap-yield-cut-band"
                  value={cutBandWidthMm}
                  onChange={setCutBandWidthMm}
                  unit="mm"
                  min={0}
                  decimals={2}
                  disabled={!canWrite || saving || missingBases.length === 0}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="strap-yield-confirmed">Rendimento (m/m) *</Label>
                <NumberInput
                  id="strap-yield-confirmed"
                  value={confirmedYield}
                  onChange={setConfirmedYield}
                  unit="m/m"
                  min={0}
                  decimals={2}
                  disabled={!canWrite || saving || missingBases.length === 0}
                />
                {theoreticalYield > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Teto teórico (menor largura útil ÷ banda): {theoreticalYield} m/m
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="strap-yield-reason">Motivo *</Label>
              <Textarea
                id="strap-yield-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                disabled={!canWrite || saving}
              />
            </div>
          </div>
        )}

        {validationError ? (
          <Alert variant="destructive">
            <Warning className="h-4 w-4" />
            <AlertTitle>Não foi possível confirmar</AlertTitle>
            <AlertDescription>{validationError}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={
              saving
              || loading
              || !measure
              || !canWrite
              || !canApprove
              || missingBases.length === 0
            }
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirmando…
              </>
            ) : (
              'Confirmar rendimento'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

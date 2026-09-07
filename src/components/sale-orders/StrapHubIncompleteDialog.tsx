import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleNotch as Loader2, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
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
import { supabase } from '@/integrations/supabase/client';
import type { ArtisanalStrapCatalog } from '@/hooks/useArtisanalStraps';
import {
  groupStrapHubIncompleteByMeasure,
  type StrapHubIncompleteIssue,
} from '@/lib/strapPvOrigem';

export interface StrapHubPricePatch {
  measureId: string;
  precoArtesanalPerM?: number | null;
  precoPrestadorPerM?: number | null;
}

export interface StrapHubIncompleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: StrapHubIncompleteIssue[];
  catalog: ArtisanalStrapCatalog | null | undefined;
  /** Depois de gravar os preços e invalidar o catálogo, o PV retoma o save. */
  onCompleted: (patches: StrapHubPricePatch[]) => void;
}

interface MeasureDraft {
  measureId: string;
  labels: string[];
  displayName: string;
  needsArtesanal: boolean;
  needsPrestador: boolean;
  precoArtesanalPerM: number;
  precoPrestadorPerM: number;
}

function buildDrafts(
  issues: StrapHubIncompleteIssue[],
  catalog: ArtisanalStrapCatalog | null | undefined,
): MeasureDraft[] {
  const gaps = groupStrapHubIncompleteByMeasure(issues);
  const byId = new Map((catalog?.measures || []).map((measure) => [measure.id, measure]));
  return gaps.map((gap) => {
    const measure = byId.get(gap.measureId);
    return {
      measureId: gap.measureId,
      labels: gap.labels,
      displayName: measure?.display_name || gap.measureId.slice(0, 8),
      needsArtesanal: gap.needsArtesanal,
      needsPrestador: gap.needsPrestador,
      precoArtesanalPerM: Number(measure?.preco_artesanal_per_m) > 0
        ? Number(measure?.preco_artesanal_per_m)
        : 0,
      precoPrestadorPerM: Number(measure?.preco_prestador_per_m) > 0
        ? Number(measure?.preco_prestador_per_m)
        : 0,
    };
  });
}

/**
 * Spec origem-tira-pv-hub-os §15: Hub incompleto abre diálogo no PV para
 * preencher preço MO / artesanal sem sair do pedido; só então conclui o save.
 */
export default function StrapHubIncompleteDialog({
  open,
  onOpenChange,
  issues,
  catalog,
  onCompleted,
}: StrapHubIncompleteDialogProps) {
  const queryClient = useQueryClient();
  const canWrite = catalog?.capabilities.manage_strap_catalog === true;
  const canSeeFinancial = catalog?.capabilities.can_see_financial_values === true;
  const [drafts, setDrafts] = useState<MeasureDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDrafts(buildDrafts(issues, catalog));
    setValidationError(null);
    setSaving(false);
  }, [open, issues, catalog]);

  const titleLabels = useMemo(
    () => drafts.flatMap((draft) => draft.labels).slice(0, 3).join(', '),
    [drafts],
  );

  const setDraftField = (
    measureId: string,
    field: 'precoArtesanalPerM' | 'precoPrestadorPerM',
    value: number,
  ) => {
    setDrafts((current) => current.map((draft) => (
      draft.measureId === measureId ? { ...draft, [field]: value } : draft
    )));
  };

  const handleSave = async () => {
    if (!canWrite) {
      setValidationError('Sua permissão permite consultar, mas não alterar o Hub de Tiras.');
      return;
    }
    if (!canSeeFinancial) {
      setValidationError('Sem permissão para ver/editar valores financeiros do Hub.');
      return;
    }
    for (const draft of drafts) {
      if (draft.needsArtesanal && !(draft.precoArtesanalPerM > 0)) {
        setValidationError(`${draft.labels[0] || draft.displayName}: informe o preço artesanal (R$/m).`);
        return;
      }
      if (draft.needsPrestador && !(draft.precoPrestadorPerM > 0)) {
        setValidationError(`${draft.labels[0] || draft.displayName}: informe a mão de obra do prestador (R$/m).`);
        return;
      }
    }

    setSaving(true);
    setValidationError(null);
    try {
      const patches: StrapHubPricePatch[] = [];
      for (const draft of drafts) {
        const patch: {
          preco_artesanal_per_m?: number | null;
          preco_prestador_per_m?: number | null;
        } = {};
        const resultPatch: StrapHubPricePatch = { measureId: draft.measureId };
        if (draft.needsArtesanal) {
          const value = draft.precoArtesanalPerM > 0 ? draft.precoArtesanalPerM : null;
          patch.preco_artesanal_per_m = value;
          resultPatch.precoArtesanalPerM = value;
        }
        if (draft.needsPrestador) {
          const value = draft.precoPrestadorPerM > 0 ? draft.precoPrestadorPerM : null;
          patch.preco_prestador_per_m = value;
          resultPatch.precoPrestadorPerM = value;
        }
        if (Object.keys(patch).length === 0) continue;
        const { error } = await supabase
          .from('artisanal_strap_measures')
          .update(patch)
          .eq('id', draft.measureId);
        if (error) throw error;
        patches.push(resultPatch);
      }
      await queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
      toast.success('Hub de Tiras atualizado. Continuando o salvamento…');
      onOpenChange(false);
      onCompleted(patches);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setValidationError(message);
      toast.error('Não foi possível gravar os preços no Hub de Tiras.', {
        description: message,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Completar Hub de Tiras</DialogTitle>
          <DialogDescription>
            {titleLabels
              ? `Falta cadastrar preço para ${titleLabels}. Preencha abaixo para salvar o pedido sem sair desta tela.`
              : 'Falta cadastrar preço no Hub de Tiras. Preencha abaixo para salvar o pedido.'}
          </DialogDescription>
        </DialogHeader>

        {!canWrite && (
          <Alert>
            <Warning className="h-4 w-4" />
            <AlertTitle>Somente consulta</AlertTitle>
            <AlertDescription>
              Peça a um administrador para cadastrar os preços no Hub de Tiras, ou peça a permissão de catálogo.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma pendência de preço encontrada.</p>
          ) : drafts.map((draft) => (
            <div
              key={draft.measureId}
              className="space-y-3 rounded-md border border-border bg-muted/20 p-3"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-foreground">
                  {draft.labels.join(' · ') || 'Tira'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Medida: {draft.displayName}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {draft.needsArtesanal && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`hub-preco-artesanal-${draft.measureId}`}>
                      Preço artesanal (R$/m) *
                    </Label>
                    <NumberInput
                      id={`hub-preco-artesanal-${draft.measureId}`}
                      value={draft.precoArtesanalPerM}
                      onChange={(value) => setDraftField(draft.measureId, 'precoArtesanalPerM', value)}
                      unit="R$/m"
                      min={0}
                      disabled={!canWrite || saving || !canSeeFinancial}
                      autoFocus={draft.needsArtesanal && !draft.needsPrestador}
                    />
                  </div>
                )}
                {draft.needsPrestador && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`hub-preco-prestador-${draft.measureId}`}>
                      Mão de obra prestador (R$/m) *
                    </Label>
                    <NumberInput
                      id={`hub-preco-prestador-${draft.measureId}`}
                      value={draft.precoPrestadorPerM}
                      onChange={(value) => setDraftField(draft.measureId, 'precoPrestadorPerM', value)}
                      unit="R$/m"
                      min={0}
                      disabled={!canWrite || saving || !canSeeFinancial}
                      autoFocus
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {validationError && (
          <Alert variant="destructive">
            <Warning className="h-4 w-4" />
            <AlertTitle>Não foi possível continuar</AlertTitle>
            <AlertDescription>{validationError}</AlertDescription>
          </Alert>
        )}

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
            disabled={saving || !canWrite || drafts.length === 0}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              'Salvar e continuar o pedido'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

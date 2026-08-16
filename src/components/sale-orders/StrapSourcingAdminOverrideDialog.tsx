import { useEffect, useState } from 'react';
import { ShieldWarning, Warning } from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  type OverrideSaleOrderItemStrapSourcingResult,
  type SaleOrderItemFormData,
  useOverrideSaleOrderItemStrapSourcing,
} from '@/hooks/useSaleOrders';
import { strapSourcingErrorDetails } from '@/lib/strapSourcingOverride';

export interface StrapSourcingAdminOverrideTarget {
  saleOrderItemId: string;
  expectedRevision: number;
  referenceLabel: string;
  lines: NonNullable<SaleOrderItemFormData['strap_sourcing']>;
  detectionDiagnostic: string;
}

function sourceLabel(value: string) {
  return value === 'internal' ? 'Produzir com napa própria' : 'Comprar tira pronta';
}

export function StrapSourcingAdminOverrideDialog({
  target,
  onClose,
  onApplied,
}: {
  target: StrapSourcingAdminOverrideTarget | null;
  onClose: () => void;
  onApplied: (result: OverrideSaleOrderItemStrapSourcingResult) => void;
}) {
  const overrideSource = useOverrideSaleOrderItemStrapSourcing();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [correlationId, setCorrelationId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    setReason('');
    setConfirmed(false);
    setError(null);
    setCorrelationId(crypto.randomUUID());
  }, [target?.saleOrderItemId, target?.expectedRevision]);

  const close = () => {
    if (!overrideSource.isPending) onClose();
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldWarning className="h-5 w-5 text-destructive" /> Override administrativo de origem</DialogTitle>
          <DialogDescription>
            O salvamento normal foi abortado porque esta origem já possui compromisso operacional. Nenhum outro campo do PV foi salvo.
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="space-y-4">
            <Alert variant="destructive">
              <Warning className="h-4 w-4" />
              <AlertTitle>Troca comprometida detectada pelo servidor</AlertTitle>
              <AlertDescription>{target.detectionDiagnostic}</AlertDescription>
            </Alert>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{target.referenceLabel}</Badge>
              <Badge variant="outline">revisão esperada {target.expectedRevision}</Badge>
              <Badge variant="secondary">{Object.keys(target.lines).length} linha(s)</Badge>
            </div>

            <div className="space-y-2">
              {Object.entries(target.lines).map(([technicalLineId, selection]) => (
                <div key={technicalLineId} className="space-y-1 rounded-md border border-border p-3">
                  <p className="text-sm font-semibold">{sourceLabel(selection.source_mode)}</p>
                  <p className="break-all font-mono text-[10px] text-muted-foreground">linha: {technicalLineId}</p>
                  <p className="break-all font-mono text-[10px] text-muted-foreground">variante: {selection.strap_variant_id}</p>
                  <p className="break-all font-mono text-[10px] text-muted-foreground">cor: {selection.color_id || '—'}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label>Motivo obrigatório *</Label>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explique por que a origem precisa mudar depois do compromisso."
                rows={3}
              />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
              <span>Confirmo que o sistema neutralizará somente promessas reversíveis, preservará fatos já realizados e reconciliará demanda, OC, lote e OS antes de concluir.</span>
            </label>

            {error && (
              <Alert variant="destructive">
                <Warning className="h-4 w-4" />
                <AlertTitle>Override não aplicado</AlertTitle>
                <AlertDescription className="whitespace-pre-wrap break-words">{strapSourcingErrorDetails(error)} Recarregue o PV se a revisão tiver mudado.</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={overrideSource.isPending}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={!target || !reason.trim() || !confirmed || overrideSource.isPending}
            onClick={async () => {
              if (!target) return;
              setError(null);
              try {
                const result = await overrideSource.mutateAsync({
                  saleOrderItemId: target.saleOrderItemId,
                  expectedRevision: target.expectedRevision,
                  lines: target.lines,
                  reason: reason.trim(),
                  correlationId,
                });
                onApplied(result);
              } catch (nextError) {
                setError(nextError);
              }
            }}
          >{overrideSource.isPending ? 'Reconciliando…' : 'Confirmar override e reconciliar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  CircleNotch as Loader2,
  ShieldWarning,
  Warning,
} from '@phosphor-icons/react';
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
  formatPhysicalFactKinds,
  listPhysicalFactBlockers,
  type SaleOrderCommandPreflight,
} from '@/lib/saleOrderCommand';

export interface AdminCompensatoryCancelTarget {
  id: string;
  orderNumber: string | null;
  /** Destino do comando: Cancelado ou Rascunho (Aprovado→Rascunho). */
  status: string;
  preflight: SaleOrderCommandPreflight;
}

interface Props {
  target: AdminCompensatoryCancelTarget | null;
  pending?: boolean;
  onClose: () => void;
  onConfirm: (input: { reason: string }) => Promise<void>;
}

function onlyStageFacts(preflight: SaleOrderCommandPreflight): boolean {
  const blockers = listPhysicalFactBlockers(preflight);
  if (blockers.length === 0) return false;
  return blockers.every((blocker) => {
    const kinds = Array.isArray(blocker.details?.fact_kinds)
      ? blocker.details.fact_kinds.map(String)
      : [];
    return kinds.length > 0 && kinds.every((kind) => kind === 'stage');
  });
}

export default function AdminCompensatoryCancelDialog({
  target,
  pending = false,
  onClose,
  onConfirm,
}: Props) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason('');
    setConfirmed(false);
    setError(null);
  }, [target?.id, target?.status]);

  const blockers = useMemo(
    () => (target ? listPhysicalFactBlockers(target.preflight) : []),
    [target],
  );
  const stageOnly = target ? onlyStageFacts(target.preflight) : false;
  const reasonOk = reason.trim().length >= 15;
  const canSubmit = Boolean(target) && reasonOk && confirmed && !pending;

  const close = () => {
    if (!pending) onClose();
  };

  const titleAction = target?.status === 'Rascunho'
    ? 'Reverter para Rascunho (compensatório)'
    : 'Cancelamento compensatório';

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldWarning className="h-5 w-5 text-destructive" />
            {titleAction}
          </DialogTitle>
          <DialogDescription>
            {target?.orderNumber ? `${target.orderNumber} · ` : ''}
            Cancelamento automático recusou fato físico. Este caminho só é
            permitido a admin e reutiliza o estorno de ledger do cancel de OP.
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="space-y-4">
            <Alert variant={stageOnly ? 'default' : 'destructive'}>
              <Warning className="h-4 w-4" />
              <AlertTitle>
                {stageOnly
                  ? 'Apontamento Kanban sem baixa dura de estoque'
                  : 'Há fato físico com impacto de material'}
              </AlertTitle>
              <AlertDescription>
                {stageOnly
                  ? 'Este PV tem apontamento Kanban sem baixa dura de estoque. Cancelamento compensatório cancela as OPs, libera reservas e não inventa crédito de material.'
                  : 'Conferir se o material volta ao estoque ou é scrap antes de confirmar — o estorno de ledger credita o saldo contábil.'}
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                OPs / fatos que bloqueiam o cancel automático
              </p>
              {blockers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum blocker físico listado no preflight.</p>
              ) : (
                blockers.map((blocker, index) => {
                  const opNumber = typeof blocker.details?.op_number === 'string'
                    ? blocker.details.op_number
                    : null;
                  const kinds = formatPhysicalFactKinds(blocker);
                  return (
                    <div
                      key={`${blocker.code}-${opNumber || index}`}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3"
                    >
                      {opNumber && <Badge variant="outline">{opNumber}</Badge>}
                      {kinds && <Badge variant="secondary">{kinds}</Badge>}
                      <p className="w-full text-sm text-foreground">{blocker.message}</p>
                    </div>
                  );
                })
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="compensatory-cancel-reason">Motivo obrigatório (mín. 15 caracteres)</Label>
              <Textarea
                id="compensatory-cancel-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Descreva por que o cancelamento compensatório é necessário e o que foi conferido no chão."
                rows={3}
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">{reason.trim().length}/15</p>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
                disabled={pending}
              />
              <span>
                Confirmo que materiais físicos foram conferidos (retorno ao estoque ou scrap)
                e que o histórico de apontamentos permanecerá após cancelar as OPs.
              </span>
            </label>

            {error && (
              <Alert variant="destructive">
                <Warning className="h-4 w-4" />
                <AlertTitle>Cancelamento não aplicado</AlertTitle>
                <AlertDescription className="whitespace-pre-wrap break-words">{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            Voltar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canSubmit}
            onClick={async () => {
              if (!target) return;
              setError(null);
              try {
                await onConfirm({ reason: reason.trim() });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldWarning className="mr-2 h-4 w-4" />}
            Confirmar compensatório
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

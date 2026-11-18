/**
 * Conferência parcial de um job do Ateliê.
 * A quantidade padrão é o saldo. Estorno só passa se a produção ainda não
 * consumiu esses pares — quem recusa é a RPC.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  ATELIER_SECTOR_LABEL,
  type AtelierSector,
} from '@/lib/atelier';
import { atelierReceiptRemaining, atelierWholePairs } from '@/lib/atelierReceipt';
import { useAccessControl } from '@/hooks/useAccessControl';
import { AtelierReceiptMeter } from '@/components/atelier/AtelierReceiptMeter';
import {
  atelierKeys,
  registerAtelierJobReceipt,
  reverseAtelierJobReceipt,
  useAtelierJobReceipts,
  type AtelierLotJob,
} from '@/hooks/useAtelier';

interface Props {
  job: AtelierLotJob | null;
  onClose: () => void;
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function AtelierReceiptDialog({ job, onClose }: Props) {
  const qc = useQueryClient();
  const open = !!job;
  const received = Number(job?.received_pairs) || 0;
  const pairs = Number(job?.pairs) || 0;
  const remaining = atelierReceiptRemaining(pairs, received);
  const [qty, setQty] = useState(String(remaining || ''));
  const [defect, setDefect] = useState('');
  const [loss, setLoss] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { roles } = useAccessControl();
  const canReverse = roles.includes('admin') || roles.includes('gerente');
  const { data: history = [], isLoading } = useAtelierJobReceipts(open ? job!.id : null);
  const sector = job ? (ATELIER_SECTOR_LABEL[job.sector as AtelierSector] ?? job.sector) : '';
  const good = atelierWholePairs(qty);
  const defectPairs = defect.trim() === '' ? 0 : atelierWholePairs(defect, true);
  const lossPairs = loss.trim() === '' ? 0 : atelierWholePairs(loss, true);
  const preview = (good ?? 0) + (defectPairs ?? 0) + (lossPairs ?? 0);

  useEffect(() => {
    if (!job) return;
    setQty(String(atelierReceiptRemaining(Number(job.pairs) || 0, Number(job.received_pairs) || 0) || ''));
    setDefect('');
    setLoss('');
    setNote('');
    setReason('');
  }, [job]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: atelierKeys.all });
  };

  const conferir = async () => {
    if (!job) return;
    if (good == null || defectPairs == null || lossPairs == null) {
      toast.error('Use só pares inteiros. Sem vírgula, ponto ou número negativo.');
      return;
    }
    setBusy(true);
    try {
      await registerAtelierJobReceipt({
        jobId: job.id,
        pairs: good,
        defect: defectPairs,
        loss: lossPairs,
        note,
      });
      toast.success(`${sector}: ${good} pares bons conferidos`);
      await refresh();
      onClose();
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message)
        : 'Falha ao conferir';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const estornar = async (receiptId: string) => {
    if (!reason.trim()) {
      toast.error('Informe o motivo do estorno');
      return;
    }
    setBusy(true);
    try {
      await reverseAtelierJobReceipt({ receiptId, reason: reason.trim() });
      toast.success('Lançamento estornado');
      setReason('');
      await refresh();
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message)
        : 'Falha ao estornar';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conferir recebimento</DialogTitle>
          <DialogDescription>
            {job ? `${job.order_number}. O número sobe com o que você lançar agora.` : ''}
          </DialogDescription>
        </DialogHeader>
        {job && (
          <AtelierReceiptMeter
            received={received}
            pairs={pairs}
            preview={remaining > 0 ? Math.min(preview, remaining) : 0}
            label={sector}
          />
        )}
        {job && remaining > 0 && (
          <div className="space-y-2">
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">Pares bons</span>
              <Input
                inputMode="numeric"
                className="h-9 font-mono"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                aria-label="Quantidade recebida"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-foreground">Defeito</span>
                <Input
                  inputMode="numeric"
                  className="h-9 font-mono"
                  value={defect}
                  onChange={(e) => setDefect(e.target.value)}
                  placeholder="0"
                  aria-label="Pares com defeito"
                />
              </label>
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-foreground">Perda</span>
                <Input
                  inputMode="numeric"
                  className="h-9 font-mono"
                  value={loss}
                  onChange={(e) => setLoss(e.target.value)}
                  placeholder="0"
                  aria-label="Pares perdidos"
                />
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              A conta a pagar usa só os pares bons. Defeito e perda entram no saldo do job.
            </p>
            {preview > remaining && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                Passa do saldo. O máximo desta entrada é {remaining}.
              </p>
            )}
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">Observação</span>
              <Input
                className="h-9"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Opcional"
              />
            </label>
          </div>
        )}
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">Histórico</p>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma entrada ainda.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
              {history.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-2 rounded border border-border/60 px-2 py-1">
                  <span>
                    <span className="font-mono font-semibold">{row.pairs}</span>
                    {' bons'}
                    {Number(row.qty_defect) > 0 ? ` · ${row.qty_defect} defeito` : ''}
                    {Number(row.qty_loss) > 0 ? ` · ${row.qty_loss} perda` : ''}
                    {' · '}
                    {formatWhen(row.created_at)}
                    {row.note ? ` · ${row.note}` : ''}
                    {row.reversed_at ? ` · estornado (${row.reversal_reason})` : ''}
                  </span>
                  {!row.reversed_at && canReverse && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 text-[11px]"
                      disabled={busy}
                      onClick={() => void estornar(row.id)}
                    >
                      Estornar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {history.some((row) => !row.reversed_at) && (
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">Motivo do estorno</span>
              <Input
                className="h-9"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Obrigatório para estornar"
              />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Fechar</Button>
          {job && remaining > 0 && (
            <Button type="button" size="sm" disabled={busy} onClick={() => void conferir()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Conferir recebimento
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

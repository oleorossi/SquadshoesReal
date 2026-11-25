import { useState } from 'react';
import { ArrowCounterClockwise as Undo2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRevertInvoicedSaleOrder } from '@/hooks/useRevertInvoicedSaleOrder';

interface Props {
  saleOrderId: string;
  orderNumber: string;
  /** "icon" = botão só ícone (h-7 w-7); "default" = botão com texto. */
  size?: 'icon' | 'default';
}

/**
 * Botão "Reverter Faturamento" — aparece quando PV está em status 'Faturado'.
 * Abre dialog pedindo justificativa (mín. 10 chars) e dispara RPC atômica.
 * Com NF autorizada, a RPC reabre a produção e mantém o título a receber.
 */
export function RevertInvoiceButton({ saleOrderId, orderNumber, size = 'icon' }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const revert = useRevertInvoicedSaleOrder();

  const submit = async () => {
    if (reason.trim().length < 10) return;
    try {
      await revert.mutateAsync({ saleOrderId, reason: reason.trim() });
      setOpen(false);
      setReason('');
    } catch {
      // toast já é exibido no hook
    }
  };

  return (
    <>
      {size === 'icon' ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-amber-700 hover:text-amber-700 hover:bg-amber-500/10"
          title="Reverter faturamento (reabre a produção)"
          aria-label="Reverter faturamento"
          onClick={() => setOpen(true)}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-1.5 border-amber-600/50 text-amber-700 hover:bg-amber-500/10"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Reverter Faturamento
        </Button>
      )}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverter faturamento de {orderNumber}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>O PV volta para <strong>Em Produção</strong>, ou para <strong>Aprovado</strong> se o cabedal ainda não voltou do Ateliê. Os efeitos:</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>OPs finalizadas reabrem e as etapas fechadas pelo faturamento voltam para pendente</li>
                  <li>Preparos de cabedal cancelados voltam para o Lançar</li>
                  <li>Material baixado no faturamento volta ao estoque e é reservado de novo (OP sem apontamento real)</li>
                  <li>NFs em processamento mudam pra cancelada</li>
                </ul>
                <p className="text-amber-700 font-medium">
                  Com NF autorizada vinculada, o título a receber e os lançamentos financeiros ficam como estão. Sem NF, duplicatas pendentes cancelam e os lançamentos estornam.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="revert-reason">Justificativa (obrigatória, mín. 10 caracteres)</Label>
            <Textarea
              id="revert-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Cliquei em Faturado por engano. NF não foi emitida."
              rows={3}
              maxLength={500}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={revert.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); submit(); }}
              disabled={reason.trim().length < 10 || revert.isPending}
            >
              {revert.isPending ? 'Revertendo…' : 'Reverter'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Warning as AlertTriangle } from '@phosphor-icons/react';
import { formatBR } from '@/lib/minBillingDate';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedDateISO: string;
  minDateISO: string;
  affectedCount: number;
  /** Confirmação: usuário aceita registrar override manual com motivo opcional. */
  onConfirm: (reason: string | null) => void;
}

/**
 * Dialog disparado quando o usuário tenta definir a data de faturamento
 * abaixo da data mínima calculada (hoje + lead time total).
 * Pede confirmação e registra a decisão como override manual.
 */
export function MinBillingDateConfirmDialog({
  open,
  onOpenChange,
  selectedDateISO,
  minDateISO,
  affectedCount,
  onConfirm,
}: Props) {
  const [reason, setReason] = useState('');

  const handleConfirm = () => {
    onConfirm(reason.trim() || null);
    setReason('');
  };

  // Diferença em dias para feedback visual
  const diffDays = (() => {
    if (!selectedDateISO || !minDateISO) return 0;
    const a = new Date(selectedDateISO).getTime();
    const b = new Date(minDateISO).getTime();
    return Math.round((b - a) / 86400000);
  })();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
            Data abaixo do mínimo recomendado
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                Você está definindo a data de faturamento para{' '}
                <strong>{formatBR(selectedDateISO)}</strong>, mas a data mínima calculada
                — considerando lead time de fornecedor, buffer de material e os tempos
                de corte, costura, montagem e acabamento — é{' '}
                <strong>{formatBR(minDateISO)}</strong>.
              </p>
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-foreground">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs text-muted-foreground">Antecipação</span>
                  <strong className="text-amber-700 dark:text-amber-400">
                    {diffDays} dia{diffDays === 1 ? '' : 's'} antes do mínimo
                  </strong>
                </div>
                <p className="text-xs text-muted-foreground">
                  {affectedCount > 1
                    ? `${affectedCount} pedidos serão marcados como override manual.`
                    : 'O pedido será marcado como override manual e destacado no Kanban.'}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="override-reason" className="text-xs uppercase font-bold text-muted-foreground">
                  Motivo (opcional)
                </Label>
                <Textarea
                  id="override-reason"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Ex: cliente VIP / horas extras autorizadas / material já em estoque"
                  rows={3}
                  className="text-sm"
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            Confirmar mesmo assim
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
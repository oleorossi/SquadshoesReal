import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Warning as AlertTriangle } from '@phosphor-icons/react';
import type { PointingWarning } from '@/hooks/useOrderStages';

interface Props {
  open: boolean;
  warnings: PointingWarning[];
  /** Contexto pra pessoa saber o que está confirmando (ex.: "Costura — OP-00123, +200 pares") */
  contextLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirming?: boolean;
}

/**
 * Regras de transição (R6.3): nada trava o chão de fábrica — o sistema mostra
 * o problema na hora e pede um OK explícito. A confirmação vai gravada no
 * ledger (production_pointings.confirmed_warnings) com a autoria de quem
 * confirmou (created_by).
 */
export default function ConfirmPointingWarnings({
  open, warnings, contextLabel, onConfirm, onCancel, confirming,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={v => { if (!v) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" weight="fill" />
            Confirmar apontamento com avisos
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {contextLabel && (
                <p className="text-sm font-medium text-foreground">{contextLabel}</p>
              )}
              <ul className="space-y-2">
                {warnings.map(w => (
                  <li
                    key={w.code}
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300"
                  >
                    {w.message}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Ao confirmar, o apontamento é gravado mesmo assim e a sua confirmação
                fica registrada no histórico da OP.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={confirming}>
            Confirmar mesmo assim
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

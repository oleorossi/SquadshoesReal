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
import { Warning as AlertTriangle } from '@phosphor-icons/react';

export interface BlockingOp {
  id: string;
  order_number: string | null;
  status: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ops: BlockingOp[];
  isCancelling: boolean;
  /** Confirma cancelamento em batch e re-dispara o save do PV. */
  onConfirm: () => void;
}

/**
 * Dialog disparado quando o usuário tenta editar um PV que tem OPs em produção
 * avançada. Lista as OPs bloqueadoras, alerta sobre perda de material físico
 * já consumido, e oferece botão "Cancelar todas e editar" que faz batch cancel
 * (estorno de estoque/grade) antes de re-disparar o save.
 */
export function CancelOpsAndEditDialog({
  open,
  onOpenChange,
  ops,
  isCancelling,
  onConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
            {ops.length} OP{ops.length === 1 ? '' : 's'} em produção bloqueando edição
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p className="text-foreground">
                Editar este PV deleta+recria todas as OPs vinculadas. As OPs abaixo já
                estão em produção avançada — pra liberar a edição preciso cancelá-las
                antes (estorna estoque reservado e grade de solado).
              </p>

              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                  OPs que serão canceladas
                </div>
                <ul className="space-y-1 font-mono text-sm">
                  {ops.map(op => (
                    <li key={op.id} className="flex items-center justify-between gap-3">
                      <span className="font-bold">{op.order_number || op.id.slice(0, 8)}</span>
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">
                        {op.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-xs uppercase tracking-widest text-amber-700 dark:text-amber-400 font-bold mb-1">
                  Atenção — material já consumido fisicamente
                </div>
                <p className="text-xs text-foreground/80">
                  Cabedal cortado, sintético picado, costura feita — esse material
                  <strong> não volta ao estoque</strong>. Apenas as reservas pendentes
                  são liberadas. Se você só precisa ajustar dados que não afetam a
                  produção (cliente, prazo, observações), prefira cancelar este modal.
                </p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCancelling}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isCancelling}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isCancelling
              ? `Cancelando ${ops.length} OP${ops.length === 1 ? '' : 's'}...`
              : `Cancelar ${ops.length} OP${ops.length === 1 ? '' : 's'} e editar`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

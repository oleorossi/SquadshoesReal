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
import { Button } from '@/components/ui/button';
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
  isPreflighting?: boolean;
  preflightError?: string | null;
  hasVersionConflict?: boolean;
  isCancelling: boolean;
  /** Confirma cancelamento + save no writer transacional do PV. */
  onConfirm: () => void;
  /** Descarta o snapshot obsoleto e carrega novamente o agregado canônico. */
  onReload?: () => void;
}

/**
 * Dialog disparado quando o usuário tenta editar um PV que tem OPs em produção
 * avançada. Lista as OPs bloqueadoras, alerta sobre perda de material físico
 * já consumido, e oferece botão "Cancelar todas e editar" que executa o
 * cancelamento e o save em uma única transação no servidor.
 */
export function CancelOpsAndEditDialog({
  open,
  onOpenChange,
  ops,
  isPreflighting = false,
  preflightError,
  hasVersionConflict = false,
  isCancelling,
  onConfirm,
  onReload,
}: Props) {
  const isBusy = isPreflighting || isCancelling;
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
                no mesmo salvamento. Somente reservas ainda pendentes são liberadas;
                consumo físico e grade já baixados permanecem consumidos.
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

              {preflightError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <div className="mb-1 text-xs font-bold uppercase tracking-widest text-destructive">
                    Não foi possível confirmar a edição
                  </div>
                  <p className="text-xs text-foreground/80">
                    {preflightError}{' '}
                    {hasVersionConflict
                      ? 'Nenhuma OP foi cancelada. Recarregue o PV para revisar a versão atual; alterações locais ainda não salvas serão descartadas.'
                      : 'Uma recusa do servidor reverte a transação inteira. Se houve falha de conexão, recarregue o PV antes de tentar novamente para confirmar o estado gravado.'}
                  </p>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>Cancelar</AlertDialogCancel>
          {hasVersionConflict && onReload && (
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={onReload}
            >
              Recarregar e revisar
            </Button>
          )}
          <AlertDialogAction
            onClick={(event) => {
              // A Action do Radix fecha o dialog por padrão. Aqui ele só pode
              // fechar depois do preflight e do writer confirmarem sucesso.
              event.preventDefault();
              onConfirm();
            }}
            disabled={isBusy || hasVersionConflict}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isPreflighting
              ? 'Validando e salvando de forma atômica...'
              : isCancelling
              ? `Cancelando ${ops.length} OP${ops.length === 1 ? '' : 's'}...`
              : `Cancelar ${ops.length} OP${ops.length === 1 ? '' : 's'} e editar`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

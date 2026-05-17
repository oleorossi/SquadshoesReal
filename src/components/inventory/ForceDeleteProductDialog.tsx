import { useState } from 'react';
import { useDeleteProduct, type ProductLinksSummary } from '@/hooks/useProducts';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Warning as AlertTriangle } from '@phosphor-icons/react';
import { toast } from 'sonner';

type State =
  | { kind: 'idle' }
  | { kind: 'confirm-force'; productId: string; links: ProductLinksSummary; message: string };

/**
 * Encapsula o fluxo completo de exclusão de produto:
 *   1. Tenta delete normal
 *   2. Se o hook responder com `_canForce` (vínculos detectados), abre dialog
 *      pedindo confirmação dupla (digitar "EXCLUIR") pra apagar tudo via RPC
 *      force_delete_product.
 *
 * Uso:
 *   const { tryDelete, dialog } = useForceDeleteProductFlow();
 *   <Button onClick={() => tryDelete(productId)}>Excluir</Button>
 *   {dialog}
 */
interface ForceDeleteFlowOptions {
  /** Callback chamado após exclusão bem-sucedida (normal ou forçada). */
  onSuccess?: () => void;
}

export function useForceDeleteProductFlow(opts: ForceDeleteFlowOptions = {}) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [confirmation, setConfirmation] = useState('');
  const deleteMut = useDeleteProduct();

  const tryDelete = async (productId: string) => {
    try {
      await deleteMut.mutateAsync(productId);
      opts.onSuccess?.();
    } catch (err: any) {
      if (err?._canForce && err?._links) {
        setState({
          kind: 'confirm-force',
          productId: err._productId || productId,
          links: err._links as ProductLinksSummary,
          message: err.message,
        });
        setConfirmation('');
      }
      // outros erros: toast genérico já é mostrado pelo onError do hook
    }
  };

  const handleForce = async () => {
    if (state.kind !== 'confirm-force') return;
    if (confirmation.trim().toUpperCase() !== 'EXCLUIR') {
      toast.error('Digite "EXCLUIR" para confirmar.');
      return;
    }
    try {
      await deleteMut.mutateAsync({ id: state.productId, force: true });
      setState({ kind: 'idle' });
      setConfirmation('');
      opts.onSuccess?.();
    } catch {
      // erro já tratado pelo hook
    }
  };

  const dialog = state.kind === 'confirm-force' ? (
    <AlertDialog open onOpenChange={(open) => { if (!open) setState({ kind: 'idle' }); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> Forçar exclusão deste produto?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>{state.message}</p>
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1.5 text-sm">
                <p className="font-semibold text-destructive">Os seguintes vínculos serão APAGADOS:</p>
                <ul className="list-disc list-inside text-foreground space-y-0.5">
                  {state.links.sheet_materials > 0 && (
                    <li>{state.links.sheet_materials} {state.links.sheet_materials === 1 ? 'linha de ficha técnica' : 'linhas de ficha técnica'} (BOMs)</li>
                  )}
                  {state.links.reservations > 0 && (
                    <li>{state.links.reservations} {state.links.reservations === 1 ? 'reserva ativa será cancelada' : 'reservas ativas serão canceladas'}</li>
                  )}
                  {state.links.purchase_items > 0 && (
                    <li>{state.links.purchase_items} {state.links.purchase_items === 1 ? 'item de OC' : 'itens de OC'}</li>
                  )}
                  {state.links.stock_movements > 0 && (
                    <li>{state.links.stock_movements} {state.links.stock_movements === 1 ? 'movimentação de estoque (perde histórico)' : 'movimentações de estoque (perde histórico)'}</li>
                  )}
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                Esta ação é <strong>irreversível</strong>. Recomendamos apenas para produtos cadastrados errado por engano.
                Pra desligar o produto preservando histórico, prefira <strong>desativar</strong>.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-delete" className="text-xs font-medium">
                  Digite <code className="bg-muted px-1 rounded">EXCLUIR</code> pra confirmar:
                </Label>
                <Input
                  id="confirm-delete"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="EXCLUIR"
                  autoComplete="off"
                  autoFocus
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => { setState({ kind: 'idle' }); setConfirmation(''); }}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleForce}
            disabled={confirmation.trim().toUpperCase() !== 'EXCLUIR' || deleteMut.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMut.isPending ? 'Excluindo...' : 'Sim, excluir tudo'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;

  return { tryDelete, dialog, isDeleting: deleteMut.isPending };
}

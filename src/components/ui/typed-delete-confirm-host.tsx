import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DeleteConfirmWordField } from '@/components/ui/delete-confirm-word-field';
import { isDeleteConfirmWord } from '@/lib/deleteConfirmWord';
import {
  getTypedDeleteConfirmState,
  settleTypedDeleteConfirm,
  subscribeTypedDeleteConfirm,
} from '@/lib/typedDeleteConfirmStore';

/**
 * Host global da confirmação de exclusão em massa (`confirmAndBulkDelete`).
 * Montar uma vez em App.
 */
export function TypedDeleteConfirmHost() {
  const { request } = useSyncExternalStore(
    subscribeTypedDeleteConfirm, getTypedDeleteConfirmState, getTypedDeleteConfirmState,
  );
  const [typed, setTyped] = useState('');

  useEffect(() => { setTyped(''); }, [request]);

  const ok = isDeleteConfirmWord(typed);

  return (
    <AlertDialog open={!!request} onOpenChange={(open) => { if (!open) settleTypedDeleteConfirm(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {!!request?.lines?.length && (
                <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-foreground">
                  {request.lines.map((line, i) => <div key={i}>{line}</div>)}
                  {!!request.moreCount && (
                    <div className="text-muted-foreground">… e mais {request.moreCount}</div>
                  )}
                </div>
              )}
              {request?.extraWarning && <p className="whitespace-pre-line">{request.extraWarning}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <DeleteConfirmWordField
          value={typed}
          onChange={setTyped}
          onSubmit={() => { if (ok) settleTypedDeleteConfirm(true); }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settleTypedDeleteConfirm(true)}
            disabled={!ok}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

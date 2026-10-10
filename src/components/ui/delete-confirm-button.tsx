import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DeleteConfirmWordField } from '@/components/ui/delete-confirm-word-field';
import { isDeleteConfirmWord } from '@/lib/deleteConfirmWord';
import { Trash as Trash2 } from '@phosphor-icons/react';

interface DeleteConfirmButtonProps {
  onConfirm: () => void;
  title?: string;
  description?: string;
  /** Icon button size class, default h-7 w-7 */
  size?: string;
  /** Trash icon size class, default h-3.5 w-3.5 */
  iconSize?: string;
  /** Anti-acidente: usuário precisa digitar "excluir" pra habilitar o botão.
   *  19/05/2026: adicionado depois de 7 PVs sumirem por delete acidental.
   *  10/10/2026: a palavra passou a ser sempre "excluir" (antes era o nº do PV). */
  requireTypedConfirm?: boolean;
}

export default function DeleteConfirmButton({
  onConfirm,
  title = 'Confirmar exclusão?',
  description = 'Esta ação não pode ser desfeita.',
  size = 'h-7 w-7',
  iconSize = 'h-3.5 w-3.5',
  requireTypedConfirm = false,
}: DeleteConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const typeOk = !requireTypedConfirm || isDeleteConfirmWord(typed);
  return (
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setTyped(''); }}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={title} className={`${size} text-destructive hover:text-destructive`}>
          <Trash2 className={iconSize} aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {requireTypedConfirm && (
          <DeleteConfirmWordField
            value={typed}
            onChange={setTyped}
            onSubmit={() => {
              if (!typeOk) return;
              setOpen(false);
              setTyped('');
              onConfirm();
            }}
          />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={!typeOk}
            className={`bg-destructive text-destructive-foreground hover:bg-destructive/90 ${!typeOk ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

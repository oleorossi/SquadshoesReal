import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash as Trash2 } from '@phosphor-icons/react';

interface DeleteConfirmButtonProps {
  onConfirm: () => void;
  title?: string;
  description?: string;
  /** Icon button size class, default h-7 w-7 */
  size?: string;
  /** Trash icon size class, default h-3.5 w-3.5 */
  iconSize?: string;
  /** Anti-acidente: se setado, usuário precisa digitar este texto pra habilitar
   *  o botão "Excluir". Recomendado pra deletes irreversíveis (ex: número do PV).
   *  19/05/2026: adicionado depois de 7 PVs sumirem por delete acidental. */
  confirmTypedText?: string;
}

export default function DeleteConfirmButton({
  onConfirm,
  title = 'Confirmar exclusão?',
  description = 'Esta ação não pode ser desfeita.',
  size = 'h-7 w-7',
  iconSize = 'h-3.5 w-3.5',
  confirmTypedText,
}: DeleteConfirmButtonProps) {
  const [typed, setTyped] = useState('');
  const requiresType = !!confirmTypedText;
  const typeOk = !requiresType || typed.trim() === confirmTypedText;
  return (
    <AlertDialog onOpenChange={(open) => { if (!open) setTyped(''); }}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className={`${size} text-destructive hover:text-destructive`}>
          <Trash2 className={iconSize} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {requiresType && (
          <div className="space-y-2 pt-2">
            <label className="text-sm font-medium">
              Pra confirmar, digite <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{confirmTypedText}</code> abaixo:
            </label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmTypedText}
              autoFocus
              autoComplete="off"
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={!typeOk}
            className={!typeOk ? 'opacity-50 cursor-not-allowed' : ''}
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

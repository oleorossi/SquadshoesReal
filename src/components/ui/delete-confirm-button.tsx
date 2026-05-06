import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

interface DeleteConfirmButtonProps {
  onConfirm: () => void;
  title?: string;
  description?: string;
  /** Icon button size class, default h-7 w-7 */
  size?: string;
  /** Trash icon size class, default h-3.5 w-3.5 */
  iconSize?: string;
}

export default function DeleteConfirmButton({
  onConfirm,
  title = 'Confirmar exclusão?',
  description = 'Esta ação não pode ser desfeita.',
  size = 'h-7 w-7',
  iconSize = 'h-3.5 w-3.5',
}: DeleteConfirmButtonProps) {
  return (
    <AlertDialog>
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
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Excluir</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

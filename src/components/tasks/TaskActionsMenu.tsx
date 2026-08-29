import { useState } from 'react';
import {
  CheckCircle, Circle, CircleHalf, Copy, DotsThree, Eye, Flag, Trash,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PRIORITY_LABEL, STATUS_LABEL, type NoteTaskPriority, type NoteTaskStatus,
  type NoteTaskWithNote,
} from '@/hooks/useNoteTasks';

interface TaskActionsMenuProps {
  task: NoteTaskWithNote;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  duplicatePending?: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onChangePriority: (priority: NoteTaskPriority) => void;
  onChangeStatus: (status: NoteTaskStatus) => void;
  onDelete: () => void;
}

export function TaskActionsMenu({
  task,
  canCreate,
  canEdit,
  canDelete,
  duplicatePending,
  onOpen,
  onDuplicate,
  onChangePriority,
  onChangeStatus,
  onDelete,
}: TaskActionsMenuProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={event => event.stopPropagation()}
            aria-label={`Ações da tarefa: ${task.text}`}
          >
            <DotsThree className="h-4 w-4" weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onOpen}>
            <Eye className="mr-2 h-4 w-4" /> Abrir detalhes
          </DropdownMenuItem>
          {canCreate && (
            <DropdownMenuItem onSelect={onDuplicate} disabled={duplicatePending}>
              <Copy className="mr-2 h-4 w-4" /> {duplicatePending ? 'Duplicando…' : 'Duplicar tarefa'}
            </DropdownMenuItem>
          )}

          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Flag className="mr-2 h-4 w-4" /> Prioridade
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-40">
                  <DropdownMenuRadioGroup value={task.priority} onValueChange={value => onChangePriority(value as NoteTaskPriority)}>
                    {(['alta', 'media', 'baixa'] as NoteTaskPriority[]).map(priority => (
                      <DropdownMenuRadioItem key={priority} value={priority}>{PRIORITY_LABEL[priority]}</DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {task.status === 'done' ? <CheckCircle className="mr-2 h-4 w-4" /> : task.status === 'doing' ? <CircleHalf className="mr-2 h-4 w-4" /> : <Circle className="mr-2 h-4 w-4" />}
                  Status
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  <DropdownMenuRadioGroup value={task.status} onValueChange={value => onChangeStatus(value as NoteTaskStatus)}>
                    {(['todo', 'doing', 'done'] as NoteTaskStatus[]).map(status => (
                      <DropdownMenuRadioItem key={status} value={status}>{STATUS_LABEL[status]}</DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}

          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash className="mr-2 h-4 w-4" /> Excluir tarefa
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tarefa?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação também exclui as subtarefas e não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onDelete}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

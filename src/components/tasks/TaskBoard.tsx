import { useState } from 'react';
import { Circle, CircleHalf, CheckCircle, type Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { ListChecks } from '@phosphor-icons/react';
import { TaskActionsMenu } from '@/components/tasks/TaskActionsMenu';
import { TaskMetaLine, type SubtaskProgress } from '@/components/tasks/TaskMeta';
import {
  PRIORITY_COLOR, STATUS_LABEL,
  type NoteTaskPriority, type NoteTaskWithNote, type NoteTaskStatus,
} from '@/hooks/useNoteTasks';

const COLUMNS: Array<{ status: NoteTaskStatus; icon: Icon; accent: string }> = [
  { status: 'todo',  icon: Circle,      accent: 'text-muted-foreground' },
  { status: 'doing', icon: CircleHalf,  accent: 'text-amber-700 dark:text-amber-300' },
  { status: 'done',  icon: CheckCircle, accent: 'text-green-600 dark:text-green-400' },
];

/**
 * TaskBoard — quadro Kanban estilo Notion (A fazer / Em andamento / Concluída).
 * Drag HTML5: arrastar carta pra outra coluna muda o status (done sincroniza
 * via trigger no banco). Clicar na carta abre o detalhe.
 */
export function TaskBoard({
  tasks, subtaskProgress, canCreate, canEdit, canDelete, duplicatePendingId,
  onOpenTask, onMoveTask, onDuplicateTask, onDeleteTask, onChangePriority,
}: {
  tasks: NoteTaskWithNote[];
  subtaskProgress: Map<string, SubtaskProgress>;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  duplicatePendingId?: string;
  onOpenTask: (id: string) => void;
  onMoveTask: (task: NoteTaskWithNote, status: NoteTaskStatus) => void;
  onDuplicateTask: (task: NoteTaskWithNote) => void;
  onDeleteTask: (task: NoteTaskWithNote) => void;
  onChangePriority: (task: NoteTaskWithNote, priority: NoteTaskPriority) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<NoteTaskStatus | null>(null);

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Nenhuma tarefa no quadro"
        description="Adicione tarefas no campo acima — elas entram na coluna A fazer."
      />
    );
  }

  const byStatus = (status: NoteTaskStatus) => tasks.filter(t => t.status === status);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
      {COLUMNS.map(({ status, icon: Icon, accent }) => {
        const columnTasks = byStatus(status);
        const isDropTarget = dropColumn === status;
        return (
          <div
            key={status}
            onDragOver={e => {
              if (!canEdit) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropColumn(status);
            }}
            onDragLeave={() => setDropColumn(current => (current === status ? null : current))}
            onDrop={e => {
              if (!canEdit) return;
              e.preventDefault();
              setDropColumn(null);
              const id = e.dataTransfer.getData('text/task-id');
              const task = tasks.find(t => t.id === id);
              if (task && task.status !== status) onMoveTask(task, status);
            }}
            className={cn(
              'rounded-sm border-[1.5px] border-foreground/10 bg-foreground/[0.015] flex flex-col min-h-[200px] transition-colors',
              isDropTarget && 'border-primary/50 bg-primary/[0.04]',
            )}
          >
            <div className="px-3 py-2.5 border-b border-foreground/10 flex items-center gap-2">
              <Icon className={cn('h-4 w-4', accent)} weight={status === 'done' ? 'fill' : 'bold'} />
              <span className="text-xs font-bold uppercase tracking-wider">{STATUS_LABEL[status]}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{columnTasks.length}</span>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-auto">
              {columnTasks.map(task => (
                <BoardCard
                  key={task.id}
                  task={task}
                  subtasks={subtaskProgress.get(task.id)}
                  canCreate={canCreate}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  duplicatePending={duplicatePendingId === task.id}
                  dragging={draggingId === task.id}
                  onDragStart={e => {
                    if (!canEdit) return;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/task-id', task.id);
                    setDraggingId(task.id);
                  }}
                  onDragEnd={() => { setDraggingId(null); setDropColumn(null); }}
                  onClick={() => onOpenTask(task.id)}
                  onDuplicate={() => onDuplicateTask(task)}
                  onDelete={() => onDeleteTask(task)}
                  onChangePriority={priority => onChangePriority(task, priority)}
                  onChangeStatus={nextStatus => onMoveTask(task, nextStatus)}
                />
              ))}
              {columnTasks.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">
                  {isDropTarget ? 'Solte aqui' : 'Vazio — arraste cartas pra cá'}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({
  task, subtasks, canCreate, canEdit, canDelete, duplicatePending, dragging,
  onDragStart, onDragEnd, onClick, onDuplicate, onDelete, onChangePriority,
  onChangeStatus,
}: {
  task: NoteTaskWithNote;
  subtasks?: SubtaskProgress;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  duplicatePending: boolean;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onChangePriority: (priority: NoteTaskPriority) => void;
  onChangeStatus: (status: NoteTaskStatus) => void;
}) {
  const color = PRIORITY_COLOR[task.priority];
  return (
    <div
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'rounded-sm border border-border bg-card border-l-[3px] transition-opacity hover:bg-muted/30',
        color.dot.replace('bg-', 'border-l-'),
        canEdit && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
        task.done && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1 p-2.5">
          <button
            type="button"
            onClick={onClick}
            className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className={cn(
              'block break-words text-sm leading-snug',
              task.done ? 'line-through text-muted-foreground' : 'text-foreground',
            )}>
              {task.text}
            </span>
          </button>
          <TaskMetaLine task={task} subtasks={subtasks} className="mt-1.5" />
        </div>
        <TaskActionsMenu
          task={task}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          duplicatePending={duplicatePending}
          onOpen={onClick}
          onDuplicate={onDuplicate}
          onChangePriority={onChangePriority}
          onChangeStatus={onChangeStatus}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

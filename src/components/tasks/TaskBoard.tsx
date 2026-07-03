import { useState } from 'react';
import { Circle, CircleHalf, CheckCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { ListChecks } from '@phosphor-icons/react';
import { TaskMetaLine, type SubtaskProgress } from '@/components/tasks/TaskMeta';
import {
  PRIORITY_COLOR, STATUS_LABEL,
  type NoteTaskWithNote, type NoteTaskStatus,
} from '@/hooks/useNoteTasks';

const COLUMNS: Array<{ status: NoteTaskStatus; icon: React.ComponentType<any>; accent: string }> = [
  { status: 'todo',  icon: Circle,      accent: 'text-muted-foreground' },
  { status: 'doing', icon: CircleHalf,  accent: 'text-amber-700 dark:text-amber-300' },
  { status: 'done',  icon: CheckCircle, accent: 'text-green-600 dark:text-green-400' },
];

/**
 * TaskBoard — quadro Kanban estilo Notion (A fazer / Em andamento / Concluída).
 * Drag HTML5: arrastar carta pra outra coluna muda o status (done sincroniza
 * via trigger no banco). Clicar na carta abre o detalhe.
 */
export function TaskBoard({ tasks, subtaskProgress, onOpenTask, onMoveTask }: {
  tasks: NoteTaskWithNote[];
  subtaskProgress: Map<string, SubtaskProgress>;
  onOpenTask: (id: string) => void;
  onMoveTask: (task: NoteTaskWithNote, status: NoteTaskStatus) => void;
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
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropColumn(status);
            }}
            onDragLeave={() => setDropColumn(current => (current === status ? null : current))}
            onDrop={e => {
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
                  dragging={draggingId === task.id}
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/task-id', task.id);
                    setDraggingId(task.id);
                  }}
                  onDragEnd={() => { setDraggingId(null); setDropColumn(null); }}
                  onClick={() => onOpenTask(task.id)}
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

function BoardCard({ task, subtasks, dragging, onDragStart, onDragEnd, onClick }: {
  task: NoteTaskWithNote;
  subtasks?: SubtaskProgress;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const color = PRIORITY_COLOR[task.priority];
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        'rounded-sm border border-border bg-card p-2.5 cursor-grab active:cursor-grabbing border-l-[3px] transition-opacity hover:bg-muted/30',
        color.dot.replace('bg-', 'border-l-'),
        dragging && 'opacity-40',
        task.done && 'opacity-60',
      )}
      role="button"
    >
      <p className={cn(
        'text-sm leading-snug break-words',
        task.done ? 'line-through text-muted-foreground' : 'text-foreground',
      )}>
        {task.text}
      </p>
      <TaskMetaLine task={task} subtasks={subtasks} showPriority={false} className="mt-1.5" />
    </div>
  );
}

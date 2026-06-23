import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, CircleNotch as Loader2, Trash as Trash2, ListChecks,
  CaretRight as ChevronRight, File as FileIcon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import {
  useAllNoteTasks, useBulkCreateNoteTasks, useUpdateNoteTask, useDeleteNoteTask,
  PRIORITY_LABEL, PRIORITY_COLOR,
  type NoteTaskPriority,
} from '@/hooks/useNoteTasks';

/**
 * Tarefas — módulo standalone (não vinculado a /notas).
 * Lista TODAS as tarefas (com ou sem nota vinculada).
 * Visual Todoist-like: agrupado por prioridade, lista lisa.
 */
export default function Tarefas() {
  const { data: tasks = [], isLoading } = useAllNoteTasks();
  const updateTask = useUpdateNoteTask();
  const deleteTask = useDeleteNoteTask();
  const bulkCreate = useBulkCreateNoteTasks();

  const [newText, setNewText] = useState('');
  const [newPriority, setNewPriority] = useState<NoteTaskPriority>('media');

  const parsedLines = newText.split('\n').map(t => t.trim()).filter(t => t.length > 0);
  const lineCount = parsedLines.length;

  const handleAdd = () => {
    if (lineCount === 0) return;
    bulkCreate.mutate(
      { note_id: null, texts: parsedLines, priority: newPriority },
      { onSuccess: () => { setNewText(''); setNewPriority('media'); } },
    );
  };

  const openTasks = tasks.filter(t => !t.done);
  const doneTasks = tasks.filter(t => t.done);

  const tasksByPriority = {
    alta:  openTasks.filter(t => t.priority === 'alta'),
    media: openTasks.filter(t => t.priority === 'media'),
    baixa: openTasks.filter(t => t.priority === 'baixa'),
  };

  return (
    <div className="space-y-4 page-enter">
      <EditorialPageHeader
        sectionLabel="WORKSPACE · TAREFAS"
        title="Tarefas"
        description="Lista global de tarefas por prioridade. Crie standalone ou veja as vinculadas às notas."
      />

      <div className="max-w-3xl mx-auto">
        {/* Header: contador */}
        <div className="pb-4 mb-4 border-b border-foreground/10">
          <p className="text-sm text-muted-foreground">
            {openTasks.length === 0 ? 'Sem tarefas abertas' :
              `${openTasks.length} tarefa${openTasks.length === 1 ? '' : 's'} aberta${openTasks.length === 1 ? '' : 's'}`}
            {doneTasks.length > 0 && <> · {doneTasks.length} concluída{doneTasks.length === 1 ? '' : 's'}</>}
          </p>
        </div>

        {/* Adicionar — textarea + select prioridade */}
        <div className="rounded-sm border-[1.5px] border-foreground/10 bg-foreground/[0.02] p-3 space-y-2 mb-6">
          <Textarea
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder={'O que precisa ser feito? (uma tarefa por linha)\n\n⌘+Enter pra salvar tudo'}
            className="min-h-[90px] bg-card resize-y text-sm leading-relaxed"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="ed-eyebrow text-muted-foreground">Prioridade:</span>
            <Select value={newPriority} onValueChange={v => setNewPriority(v as NoteTaskPriority)}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="alta">🔴 Alta</SelectItem>
                <SelectItem value="media">🟡 Média</SelectItem>
                <SelectItem value="baixa">⚪ Baixa</SelectItem>
              </SelectContent>
            </Select>
            {lineCount > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {lineCount} tarefa{lineCount === 1 ? '' : 's'} pronta{lineCount === 1 ? '' : 's'}
              </span>
            )}
            <div className="flex-1" />
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={lineCount === 0 || bulkCreate.isPending}
              className="gap-1.5 h-8"
            >
              {bulkCreate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {lineCount > 1 ? `Adicionar ${lineCount}` : 'Adicionar'}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Nenhuma tarefa criada ainda"
            description="Adicione tarefas no campo acima — uma por linha."
          />
        ) : (
          <>
            <PriorityGroup label="Alta" priority="alta" tasks={tasksByPriority.alta} updateTask={updateTask} deleteTask={deleteTask} defaultOpen />
            <PriorityGroup label="Média" priority="media" tasks={tasksByPriority.media} updateTask={updateTask} deleteTask={deleteTask} defaultOpen />
            <PriorityGroup label="Baixa" priority="baixa" tasks={tasksByPriority.baixa} updateTask={updateTask} deleteTask={deleteTask} defaultOpen />
            {doneTasks.length > 0 && (
              <PriorityGroup label="Concluídas" priority={null} tasks={doneTasks} updateTask={updateTask} deleteTask={deleteTask} defaultOpen={false} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PriorityGroup({
  label, priority, tasks, updateTask, deleteTask, defaultOpen,
}: {
  label: string;
  priority: NoteTaskPriority | null;
  tasks: any[];
  updateTask: ReturnType<typeof useUpdateNoteTask>;
  deleteTask: ReturnType<typeof useDeleteNoteTask>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (tasks.length === 0) return null;

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 py-2"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform text-muted-foreground', open && 'rotate-90')} />
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
        <div className="flex-1 h-px bg-foreground/10 ml-2" />
      </button>
      {open && (
        <div className="divide-y divide-foreground/5">
          {tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => updateTask.mutate({ id: task.id, note_id: task.note_id, data: { done: !task.done } })}
              onChangePriority={(p) => updateTask.mutate({ id: task.id, note_id: task.note_id, data: { priority: p } })}
              onChangeText={(t) => updateTask.mutate({ id: task.id, note_id: task.note_id, data: { text: t } })}
              onDelete={() => deleteTask.mutate({ id: task.id, note_id: task.note_id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, onToggle, onChangePriority, onChangeText, onDelete }: {
  task: any;
  onToggle: () => void;
  onChangePriority: (p: NoteTaskPriority) => void;
  onChangeText: (t: string) => void;
  onDelete: () => void;
}) {
  const color = PRIORITY_COLOR[task.priority];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const linkedNoteTitle = task.notes?.title;

  return (
    <div className={cn('group flex items-center gap-3 py-3', task.done && 'opacity-50')}>
      <Checkbox
        checked={task.done}
        onCheckedChange={onToggle}
        className={cn('h-5 w-5 shrink-0 rounded-full border-2', color.dot.replace('bg-', 'border-'))}
        aria-label={task.done ? 'Desmarcar tarefa' : 'Marcar como concluída'}
      />

      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => !task.done && setEditing(true)}>
        {editing ? (
          <Input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { if (draft.trim() && draft !== task.text) onChangeText(draft.trim()); setEditing(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.currentTarget.blur(); }
              else if (e.key === 'Escape') { setDraft(task.text); setEditing(false); }
            }}
            onClick={e => e.stopPropagation()}
            autoFocus
            className="h-8 text-sm py-0 px-2"
          />
        ) : (
          <>
            <p className={cn(
              'text-sm leading-snug break-words',
              task.done ? 'line-through text-muted-foreground' : 'text-foreground',
            )}>
              {task.text}
            </p>
            {!task.done && (
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={cn(
                  'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider',
                  color.text,
                )}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', color.dot)} />
                  {PRIORITY_LABEL[task.priority]}
                </span>
                {linkedNoteTitle && (
                  <Link
                    to="/notas"
                    onClick={e => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <FileIcon className="h-2.5 w-2.5" />
                    <span className="truncate max-w-[200px]">Em: {linkedNoteTitle}</span>
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Select value={task.priority} onValueChange={(v) => onChangePriority(v as NoteTaskPriority)}>
          <SelectTrigger className="h-7 w-[88px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="alta">🔴 Alta</SelectItem>
            <SelectItem value="media">🟡 Média</SelectItem>
            <SelectItem value="baixa">⚪ Baixa</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => { if (confirm('Excluir tarefa?')) onDelete(); }}
          className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          aria-label="Excluir tarefa"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

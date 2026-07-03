import { useMemo, useState } from 'react';
import {
  Plus, CircleNotch as Loader2, ListChecks, MagnifyingGlass as Search,
  CaretRight as ChevronRight, Rows, CalendarBlank, Kanban, Tag as TagIcon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { normalizeForSearch } from '@/lib/searchUtils';
import { dueDateInfo } from '@/lib/taskDates';
import { TaskMetaLine, DueDatePicker, type SubtaskProgress } from '@/components/tasks/TaskMeta';
import { TaskDetailSheet } from '@/components/tasks/TaskDetailSheet';
import { TaskBoard } from '@/components/tasks/TaskBoard';
import {
  useAllNoteTasks, useBulkCreateNoteTasks, useUpdateNoteTask, useDeleteNoteTask,
  normalizeTags,
  type NoteTaskPriority, type NoteTaskWithNote,
} from '@/hooks/useNoteTasks';

type ViewMode = 'lista' | 'agenda' | 'quadro';
const ALL_TAGS = '__all__';

/**
 * Tarefas — módulo standalone estilo Notion + todolist.
 * Três visões: Lista (grupos por prioridade), Agenda (por vencimento:
 * Atrasadas/Hoje/Próximas) e Quadro (Kanban com drag entre colunas).
 * Clicar numa tarefa abre a "página" dela (descrição markdown, subtarefas,
 * tags, vencimento) num painel lateral.
 */
export default function Tarefas() {
  const { data: tasks = [], isLoading } = useAllNoteTasks();
  const updateTask = useUpdateNoteTask();
  const deleteTask = useDeleteNoteTask();
  const bulkCreate = useBulkCreateNoteTasks();

  const [view, setView] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem('tarefas-view');
      return saved === 'agenda' || saved === 'quadro' ? saved : 'lista';
    } catch { return 'lista'; }
  });
  const changeView = (v: ViewMode) => {
    setView(v);
    try { localStorage.setItem('tarefas-view', v); } catch {}
  };

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string>(ALL_TAGS);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Quick-add
  const [newText, setNewText] = useState('');
  const [newPriority, setNewPriority] = useState<NoteTaskPriority>('media');
  const [newDueDate, setNewDueDate] = useState<string | null>(null);
  const [newTags, setNewTags] = useState('');

  const parsedLines = newText.split('\n').map(t => t.trim()).filter(t => t.length > 0);
  const lineCount = parsedLines.length;

  const handleAdd = () => {
    if (lineCount === 0) return;
    bulkCreate.mutate(
      {
        note_id: null,
        texts: parsedLines,
        priority: newPriority,
        due_date: newDueDate,
        tags: normalizeTags(newTags.split(',')),
      },
      { onSuccess: () => { setNewText(''); setNewPriority('media'); setNewDueDate(null); setNewTags(''); } },
    );
  };

  // ── Derivados ──
  // Subtarefas ficam FORA das visões top-level: só aparecem no detalhe do pai.
  const topLevel = useMemo(() => tasks.filter(t => !t.parent_task_id), [tasks]);

  const subtaskProgress = useMemo(() => {
    const m = new Map<string, SubtaskProgress>();
    for (const t of tasks) {
      if (!t.parent_task_id) continue;
      const cur = m.get(t.parent_task_id) || { total: 0, done: 0 };
      cur.total += 1;
      if (t.done) cur.done += 1;
      m.set(t.parent_task_id, cur);
    }
    return m;
  }, [tasks]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const t of topLevel) for (const tag of t.tags || []) s.add(tag);
    return Array.from(s).sort();
  }, [topLevel]);

  const filtered = useMemo(() => {
    const q = normalizeForSearch(search);
    return topLevel.filter(t => {
      if (tagFilter !== ALL_TAGS && !(t.tags || []).includes(tagFilter)) return false;
      if (!q) return true;
      return normalizeForSearch(t.text).includes(q)
        || normalizeForSearch(t.description || '').includes(q)
        || (t.tags || []).some(tag => normalizeForSearch(tag).includes(q));
    });
  }, [topLevel, search, tagFilter]);

  const selectedTask = useMemo(
    () => tasks.find(t => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId],
  );
  const selectedSubtasks = useMemo(
    () => (selectedTaskId ? tasks.filter(t => t.parent_task_id === selectedTaskId) : []),
    [tasks, selectedTaskId],
  );

  const openTasks = filtered.filter(t => !t.done);
  const doneTasks = filtered.filter(t => t.done);

  const rowProps = {
    subtaskProgress,
    onOpen: (id: string) => setSelectedTaskId(id),
    updateTask,
    deleteTask,
  };

  return (
    <div className="space-y-4 page-enter">
      <EditorialPageHeader
        sectionLabel="WORKSPACE · TAREFAS"
        title="Tarefas"
        description="Lista, agenda por vencimento e quadro Kanban. Clique numa tarefa pra abrir a página dela."
      />

      <div className="max-w-5xl mx-auto space-y-4">
        {/* Toolbar: visões + busca + filtro de tag */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 border border-foreground/10 rounded-sm p-0.5">
            {([
              { key: 'lista' as const, label: 'Lista', icon: Rows },
              { key: 'agenda' as const, label: 'Agenda', icon: CalendarBlank },
              { key: 'quadro' as const, label: 'Quadro', icon: Kanban },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => changeView(key)}
                className={cn(
                  'px-2.5 py-1 rounded-sm text-xs font-bold uppercase tracking-wider gap-1 inline-flex items-center transition-colors',
                  view === key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3 w-3" /> {label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar tarefas..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
          {allTags.length > 0 && (
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="h-8 w-40 text-xs gap-1.5">
                <TagIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TAGS}>Todas as tags</SelectItem>
                {allTags.map(tag => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="flex-1" />
          <p className="text-xs text-muted-foreground tabular-nums">
            {openTasks.length} aberta{openTasks.length === 1 ? '' : 's'}
            {doneTasks.length > 0 && <> · {doneTasks.length} concluída{doneTasks.length === 1 ? '' : 's'}</>}
          </p>
        </div>

        {/* Adicionar — textarea batch + prioridade + vencimento + tags */}
        <div className="rounded-sm border-[1.5px] border-foreground/10 bg-foreground/[0.02] p-3 space-y-2">
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
            className="min-h-[70px] bg-card resize-y text-sm leading-relaxed"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={newPriority} onValueChange={v => setNewPriority(v as NoteTaskPriority)}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="alta">🔴 Alta</SelectItem>
                <SelectItem value="media">🟡 Média</SelectItem>
                <SelectItem value="baixa">⚪ Baixa</SelectItem>
              </SelectContent>
            </Select>
            <DueDatePicker value={newDueDate} onChange={setNewDueDate} compact />
            <div className="relative">
              <TagIcon className="absolute left-2 top-2.5 h-3 w-3 text-muted-foreground" />
              <Input
                value={newTags}
                onChange={e => setNewTags(e.target.value)}
                placeholder="tags, separadas, por vírgula"
                className="h-8 pl-7 w-52 text-xs"
              />
            </div>
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

        {/* Conteúdo por visão */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={search || tagFilter !== ALL_TAGS ? Search : ListChecks}
            title={search || tagFilter !== ALL_TAGS ? 'Nada encontrado' : 'Nenhuma tarefa criada ainda'}
            description={search || tagFilter !== ALL_TAGS
              ? 'Nenhuma tarefa corresponde aos filtros.'
              : 'Adicione tarefas no campo acima — uma por linha.'}
          />
        ) : view === 'quadro' ? (
          <TaskBoard
            tasks={filtered}
            subtaskProgress={subtaskProgress}
            onOpenTask={setSelectedTaskId}
            onMoveTask={(task, status) =>
              updateTask.mutate({ id: task.id, note_id: task.note_id, data: { status } })}
          />
        ) : view === 'agenda' ? (
          <AgendaView openTasks={openTasks} doneTasks={doneTasks} {...rowProps} />
        ) : (
          <ListaView openTasks={openTasks} doneTasks={doneTasks} {...rowProps} />
        )}
      </div>

      {/* Painel de detalhe (página da tarefa) */}
      <TaskDetailSheet
        task={selectedTask}
        subtasks={selectedSubtasks}
        onClose={() => setSelectedTaskId(null)}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Visões
// ────────────────────────────────────────────────────────────────────────

interface RowActions {
  subtaskProgress: Map<string, SubtaskProgress>;
  onOpen: (id: string) => void;
  updateTask: ReturnType<typeof useUpdateNoteTask>;
  deleteTask: ReturnType<typeof useDeleteNoteTask>;
}

function ListaView({ openTasks, doneTasks, ...rowProps }: {
  openTasks: NoteTaskWithNote[];
  doneTasks: NoteTaskWithNote[];
} & RowActions) {
  return (
    <>
      <TaskSection label="Alta" tasks={openTasks.filter(t => t.priority === 'alta')} defaultOpen {...rowProps} />
      <TaskSection label="Média" tasks={openTasks.filter(t => t.priority === 'media')} defaultOpen {...rowProps} />
      <TaskSection label="Baixa" tasks={openTasks.filter(t => t.priority === 'baixa')} defaultOpen {...rowProps} />
      <TaskSection label="Concluídas" tasks={doneTasks} defaultOpen={false} {...rowProps} />
    </>
  );
}

function AgendaView({ openTasks, doneTasks, ...rowProps }: {
  openTasks: NoteTaskWithNote[];
  doneTasks: NoteTaskWithNote[];
} & RowActions) {
  const buckets = useMemo(() => {
    const overdue: NoteTaskWithNote[] = [];
    const today: NoteTaskWithNote[] = [];
    const week: NoteTaskWithNote[] = [];
    const later: NoteTaskWithNote[] = [];
    const noDate: NoteTaskWithNote[] = [];
    for (const t of openTasks) {
      const info = dueDateInfo(t.due_date);
      if (!info) noDate.push(t);
      else if (info.daysFromToday < 0) overdue.push(t);
      else if (info.daysFromToday === 0) today.push(t);
      else if (info.daysFromToday <= 7) week.push(t);
      else later.push(t);
    }
    // Dentro de cada bucket, mais urgente primeiro
    const byDue = (a: NoteTaskWithNote, b: NoteTaskWithNote) =>
      (a.due_date || '').localeCompare(b.due_date || '');
    overdue.sort(byDue); today.sort(byDue); week.sort(byDue); later.sort(byDue);
    return { overdue, today, week, later, noDate };
  }, [openTasks]);

  return (
    <>
      <TaskSection label="Atrasadas" tone="overdue" tasks={buckets.overdue} defaultOpen {...rowProps} />
      <TaskSection label="Hoje" tone="today" tasks={buckets.today} defaultOpen {...rowProps} />
      <TaskSection label="Próximos 7 dias" tasks={buckets.week} defaultOpen {...rowProps} />
      <TaskSection label="Mais tarde" tasks={buckets.later} defaultOpen {...rowProps} />
      <TaskSection label="Sem data" tasks={buckets.noDate} defaultOpen {...rowProps} />
      <TaskSection label="Concluídas" tasks={doneTasks} defaultOpen={false} {...rowProps} />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Seção colapsável + linha de tarefa
// ────────────────────────────────────────────────────────────────────────

function TaskSection({ label, tasks, defaultOpen, tone, subtaskProgress, onOpen, updateTask, deleteTask }: {
  label: string;
  tasks: NoteTaskWithNote[];
  defaultOpen: boolean;
  tone?: 'overdue' | 'today';
} & RowActions) {
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
        <span className={cn(
          'text-sm font-semibold',
          tone === 'overdue' ? 'text-destructive' :
          tone === 'today' ? 'text-amber-700 dark:text-amber-300' : 'text-foreground',
        )}>
          {label}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
        <div className="flex-1 h-px bg-foreground/10 ml-2" />
      </button>
      {open && (
        <div className="divide-y divide-foreground/5">
          {tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              subtasks={subtaskProgress.get(task.id)}
              onOpen={() => onOpen(task.id)}
              onToggle={() => updateTask.mutate({ id: task.id, note_id: task.note_id, data: { done: !task.done } })}
              onChangePriority={(p) => updateTask.mutate({ id: task.id, note_id: task.note_id, data: { priority: p } })}
              onDelete={() => deleteTask.mutate({ id: task.id, note_id: task.note_id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, subtasks, onOpen, onToggle, onChangePriority, onDelete }: {
  task: NoteTaskWithNote;
  subtasks?: SubtaskProgress;
  onOpen: () => void;
  onToggle: () => void;
  onChangePriority: (p: NoteTaskPriority) => void;
  onDelete: () => void;
}) {
  return (
    <div className={cn('group flex items-center gap-3 py-3', task.done && 'opacity-50')}>
      <Checkbox
        checked={task.done}
        onCheckedChange={onToggle}
        className={cn(
          'h-5 w-5 shrink-0 rounded-full border-2',
          PRIORITY_DOT_BORDER[task.priority],
        )}
        aria-label={task.done ? 'Desmarcar tarefa' : 'Marcar como concluída'}
      />

      <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpen}>
        <p className={cn(
          'text-sm leading-snug break-words',
          task.done ? 'line-through text-muted-foreground' : 'text-foreground',
        )}>
          {task.text}
          {task.description && (
            <span className="ml-1.5 text-muted-foreground/60 text-xs align-middle" title="Tem descrição">≡</span>
          )}
        </p>
        {!task.done && <TaskMetaLine task={task} subtasks={subtasks} className="mt-1" />}
      </div>

      <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <Select value={task.priority} onValueChange={(v) => onChangePriority(v as NoteTaskPriority)}>
          <SelectTrigger className="h-7 w-[88px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="alta">🔴 Alta</SelectItem>
            <SelectItem value="media">🟡 Média</SelectItem>
            <SelectItem value="baixa">⚪ Baixa</SelectItem>
          </SelectContent>
        </Select>
        <DeleteConfirmButton onConfirm={onDelete} title="Excluir tarefa?" description="Esta ação não pode ser desfeita." />
      </div>
    </div>
  );
}

const PRIORITY_DOT_BORDER: Record<NoteTaskPriority, string> = {
  alta: 'border-destructive',
  media: 'border-amber-500',
  baixa: 'border-muted-foreground',
};

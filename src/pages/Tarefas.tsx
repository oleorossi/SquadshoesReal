import { useId, useMemo, useState } from 'react';
import {
  CalendarBlank, CaretRight as ChevronRight, CircleHalf,
  CircleNotch as Loader2, Kanban, ListChecks, MagnifyingGlass as Search,
  Rows, Tag as TagIcon, WarningCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { TaskActionsMenu } from '@/components/tasks/TaskActionsMenu';
import { TaskBoard } from '@/components/tasks/TaskBoard';
import { TaskDetailSheet } from '@/components/tasks/TaskDetailSheet';
import { TaskMetaLine, type SubtaskProgress } from '@/components/tasks/TaskMeta';
import { TaskQuickCapture } from '@/components/tasks/TaskQuickCapture';
import { TaskScopeNav } from '@/components/tasks/TaskScopeNav';
import { cn } from '@/lib/utils';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import {
  bucketTasksByDate, countTaskScopes, matchesTaskScope,
  type TaskScope,
} from '@/lib/taskList';
import {
  useAllNoteTasks, useDeleteNoteTask, useDuplicateNoteTask, useUpdateNoteTask,
  type NoteTaskPriority, type NoteTaskStatus, type NoteTaskWithNote,
} from '@/hooks/useNoteTasks';
import { useCan } from '@/hooks/useAccessControl';

type ViewMode = 'lista' | 'agenda' | 'quadro';
const ALL_TAGS = '__all__';

const SCOPE_COPY: Record<TaskScope, { title: string; description: string }> = {
  open: { title: 'Abertas', description: 'Sua fila de execução, ordenada pelo prazo mais urgente.' },
  today: { title: 'Hoje', description: 'O que precisa sair do caminho ainda hoje.' },
  overdue: { title: 'Atrasadas', description: 'Pendências que já passaram do vencimento.' },
  upcoming: { title: 'Próximas', description: 'Tudo que já tem data marcada depois de hoje.' },
  'no-date': { title: 'Sem data', description: 'Pendências capturadas que ainda precisam ser planejadas.' },
  done: { title: 'Concluídas', description: 'Histórico recente do que já foi finalizado.' },
};

/**
 * Central pessoal de tarefas: captura rápida, fila por prazo, agenda e Kanban.
 * A Lista é a experiência principal de to-do; Agenda e Quadro preservam as
 * visões complementares do módulo anterior.
 */
export default function Tarefas() {
  const { data: tasks = [], isLoading, isError, refetch } = useAllNoteTasks();
  const updateTask = useUpdateNoteTask();
  const deleteTask = useDeleteNoteTask();
  const duplicateTask = useDuplicateNoteTask();
  const perm = useCan('/tarefas');

  const [view, setView] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem('tarefas-view');
      return saved === 'agenda' || saved === 'quadro' ? saved : 'lista';
    } catch { return 'lista'; }
  });
  const [scope, setScope] = useState<TaskScope>('open');
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string>(ALL_TAGS);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const changeView = (next: ViewMode) => {
    setView(next);
    try { localStorage.setItem('tarefas-view', next); } catch { /* storage pode estar bloqueado */ }
  };

  const topLevel = useMemo(() => tasks.filter(task => !task.parent_task_id), [tasks]);
  const headlineCounts = useMemo(() => countTaskScopes(topLevel), [topLevel]);
  const subtaskProgress = useMemo(() => {
    const progress = new Map<string, SubtaskProgress>();
    for (const task of tasks) {
      if (!task.parent_task_id) continue;
      const current = progress.get(task.parent_task_id) || { total: 0, done: 0 };
      current.total += 1;
      if (task.done) current.done += 1;
      progress.set(task.parent_task_id, current);
    }
    return progress;
  }, [tasks]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const task of topLevel) for (const tag of task.tags || []) tags.add(tag);
    return Array.from(tags).sort();
  }, [topLevel]);

  const searched = useMemo(() => topLevel.filter(task => {
    if (tagFilter !== ALL_TAGS && !(task.tags || []).includes(tagFilter)) return false;
    return searchMatchesAllTerms(
      search,
      task.text,
      task.description,
      task.notes?.title,
      ...(task.tags || []),
    );
  }), [topLevel, search, tagFilter]);

  const scopeCounts = useMemo(() => countTaskScopes(searched), [searched]);
  const scopedTasks = useMemo(
    () => searched.filter(task => matchesTaskScope(task, scope)),
    [searched, scope],
  );
  const selectedTask = useMemo(
    () => tasks.find(task => task.id === selectedTaskId) || null,
    [tasks, selectedTaskId],
  );
  const selectedSubtasks = useMemo(
    () => selectedTaskId ? tasks.filter(task => task.parent_task_id === selectedTaskId) : [],
    [tasks, selectedTaskId],
  );

  const clearFilters = () => {
    setSearch('');
    setTagFilter(ALL_TAGS);
  };
  const filtersActive = !!search || tagFilter !== ALL_TAGS;

  const toggleTask = (task: NoteTaskWithNote) => {
    if (!perm.canEdit) return;
    const done = !task.done;
    updateTask.mutate({ id: task.id, note_id: task.note_id, data: { done } }, {
      onSuccess: () => toast.success(done ? 'Tarefa concluída' : 'Tarefa reaberta', {
        action: {
          label: 'Desfazer',
          onClick: () => updateTask.mutate({ id: task.id, note_id: task.note_id, data: { done: !done } }),
        },
      }),
    });
  };

  const duplicate = (task: NoteTaskWithNote) => {
    if (!perm.canCreate || duplicateTask.isPending) return;
    duplicateTask.mutate({ id: task.id, note_id: task.note_id }, {
      onSuccess: result => setSelectedTaskId(result.id),
    });
  };

  const rowActions: RowActions = {
    subtaskProgress,
    canCreate: perm.canCreate,
    canEdit: perm.canEdit,
    canDelete: perm.canDelete,
    duplicatePendingId: duplicateTask.isPending ? duplicateTask.variables?.id : undefined,
    onOpen: setSelectedTaskId,
    onToggle: toggleTask,
    onDuplicate: duplicate,
    onChangePriority: (task, priority) => updateTask.mutate({
      id: task.id,
      note_id: task.note_id,
      data: { priority },
    }),
    onChangeStatus: (task, status) => updateTask.mutate({
      id: task.id,
      note_id: task.note_id,
      data: { status },
    }),
    onDelete: task => deleteTask.mutate({ id: task.id, note_id: task.note_id }),
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="WORKSPACE · TAREFAS"
        title="Tarefas"
        description="Capture, planeje e conclua o trabalho numa fila pessoal. Agenda e quadro continuam disponíveis quando você precisar mudar a perspectiva."
        meta={
          <>
            <strong>{headlineCounts.open}</strong> EM ABERTO ·{' '}
            <strong>{headlineCounts.completedToday}</strong> CONCLUÍDAS HOJE
          </>
        }
      />

      <div className="mx-auto max-w-6xl space-y-4">
        <TaskToolbar
          view={view}
          onViewChange={changeView}
          search={search}
          onSearchChange={setSearch}
          resultCount={searched.length}
          totalCount={topLevel.length}
          allTags={allTags}
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
          filtersActive={filtersActive}
          onClearFilters={clearFilters}
          openCount={scopeCounts.open}
          doneCount={scopeCounts.done}
        />

        {view === 'lista' ? (
          <div className="grid items-start gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <TaskScopeNav scope={scope} counts={scopeCounts} onChange={setScope} />
            <main className="min-w-0 space-y-4">
              <div className="flex items-start justify-between gap-4 border-b border-foreground/15 pb-3">
                <div>
                  <p className="ed-eyebrow text-muted-foreground">Minha lista</p>
                  <h2 className="mt-1 text-xl font-semibold">{SCOPE_COPY[scope].title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{SCOPE_COPY[scope].description}</p>
                </div>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{scopedTasks.length}</span>
              </div>
              <TaskQuickCapture canCreate={perm.canCreate} />
              <TaskContentState
                isLoading={isLoading}
                isError={isError}
                onRetry={() => refetch()}
                tasks={scopedTasks}
                filtersActive={filtersActive}
                onClearFilters={clearFilters}
                emptyTitle={emptyTitleForScope(scope)}
                emptyDescription={emptyDescriptionForScope(scope)}
              >
                <TodoListView tasks={scopedTasks} scope={scope} {...rowActions} />
              </TaskContentState>
            </main>
          </div>
        ) : (
          <main className="space-y-4">
            <TaskQuickCapture canCreate={perm.canCreate} />
            <TaskContentState
              isLoading={isLoading}
              isError={isError}
              onRetry={() => refetch()}
              tasks={searched}
              filtersActive={filtersActive}
              onClearFilters={clearFilters}
              emptyTitle="Nenhuma tarefa nesta visão"
              emptyDescription="Crie uma tarefa acima ou limpe os filtros para voltar a ver sua fila."
            >
              {view === 'quadro' ? (
                <TaskBoard
                  tasks={searched}
                  subtaskProgress={subtaskProgress}
                  canCreate={perm.canCreate}
                  canEdit={perm.canEdit}
                  canDelete={perm.canDelete}
                  duplicatePendingId={duplicateTask.isPending ? duplicateTask.variables?.id : undefined}
                  onOpenTask={setSelectedTaskId}
                  onMoveTask={(task, status) => rowActions.onChangeStatus(task, status)}
                  onDuplicateTask={duplicate}
                  onDeleteTask={rowActions.onDelete}
                  onChangePriority={rowActions.onChangePriority}
                />
              ) : (
                <AgendaView tasks={searched} {...rowActions} />
              )}
            </TaskContentState>
          </main>
        )}
      </div>

      <TaskDetailSheet
        task={selectedTask}
        subtasks={selectedSubtasks}
        duplicatePending={duplicateTask.isPending && duplicateTask.variables?.id === selectedTask?.id}
        onDuplicate={selectedTask ? () => duplicate(selectedTask) : undefined}
        onClose={() => setSelectedTaskId(null)}
      />
    </div>
  );
}

interface TaskToolbarProps {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  search: string;
  onSearchChange: (value: string) => void;
  resultCount: number;
  totalCount: number;
  allTags: string[];
  tagFilter: string;
  onTagFilterChange: (tag: string) => void;
  filtersActive: boolean;
  onClearFilters: () => void;
  openCount: number;
  doneCount: number;
}

function TaskToolbar({
  view, onViewChange, search, onSearchChange, resultCount, totalCount,
  allTags, tagFilter, onTagFilterChange, filtersActive, onClearFilters,
  openCount, doneCount,
}: TaskToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-foreground/10 pb-3">
      <div className="flex items-center gap-1 border border-foreground/15 p-0.5" aria-label="Visualização das tarefas">
        {([
          { key: 'lista' as const, label: 'Lista', icon: Rows },
          { key: 'agenda' as const, label: 'Agenda', icon: CalendarBlank },
          { key: 'quadro' as const, label: 'Quadro', icon: Kanban },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onViewChange(key)}
            aria-pressed={view === key}
            className={cn(
              'inline-flex min-h-8 items-center gap-1 px-2.5 text-xs font-bold uppercase tracking-wider transition-colors',
              view === key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder="Buscar tarefa, descrição, nota ou tag…"
        resultCount={resultCount}
        totalCount={totalCount}
        className="min-w-[220px] flex-1 sm:max-w-sm"
        inputClassName="h-9 text-sm"
      />
      {allTags.length > 0 && (
        <Select value={tagFilter} onValueChange={onTagFilterChange}>
          <SelectTrigger className="h-9 w-40 gap-1.5 text-xs">
            <TagIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TAGS}>Todas as tags</SelectItem>
            {allTags.map(tag => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {filtersActive && (
        <Button type="button" variant="ghost" size="sm" className="h-9" onClick={onClearFilters}>
          Limpar filtros
        </Button>
      )}
      <div className="flex-1" />
      <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {openCount} abertas · {doneCount} concluídas
      </p>
    </div>
  );
}

interface RowActions {
  subtaskProgress: Map<string, SubtaskProgress>;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  duplicatePendingId?: string;
  onOpen: (id: string) => void;
  onToggle: (task: NoteTaskWithNote) => void;
  onDuplicate: (task: NoteTaskWithNote) => void;
  onChangePriority: (task: NoteTaskWithNote, priority: NoteTaskPriority) => void;
  onChangeStatus: (task: NoteTaskWithNote, status: NoteTaskStatus) => void;
  onDelete: (task: NoteTaskWithNote) => void;
}

function TodoListView({ tasks, scope, ...rowActions }: {
  tasks: NoteTaskWithNote[];
  scope: TaskScope;
} & RowActions) {
  if (scope === 'done') {
    const completed = [...tasks].sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
    return <TaskSection label="Concluídas" tasks={completed} defaultOpen {...rowActions} />;
  }
  const buckets = bucketTasksByDate(tasks);
  return (
    <div>
      <TaskSection label="Atrasadas" tone="overdue" tasks={buckets.overdue} defaultOpen {...rowActions} />
      <TaskSection label="Hoje" tone="today" tasks={buckets.today} defaultOpen {...rowActions} />
      <TaskSection label="Próximos 7 dias" tasks={buckets.week} defaultOpen {...rowActions} />
      <TaskSection label="Mais tarde" tasks={buckets.later} defaultOpen {...rowActions} />
      <TaskSection label="Sem data" tasks={buckets.noDate} defaultOpen {...rowActions} />
    </div>
  );
}

function AgendaView({ tasks, ...rowActions }: { tasks: NoteTaskWithNote[] } & RowActions) {
  const open = tasks.filter(task => !task.done);
  const done = tasks.filter(task => task.done)
    .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
  const buckets = bucketTasksByDate(open);
  return (
    <div>
      <TaskSection label="Atrasadas" tone="overdue" tasks={buckets.overdue} defaultOpen {...rowActions} />
      <TaskSection label="Hoje" tone="today" tasks={buckets.today} defaultOpen {...rowActions} />
      <TaskSection label="Próximos 7 dias" tasks={buckets.week} defaultOpen {...rowActions} />
      <TaskSection label="Mais tarde" tasks={buckets.later} defaultOpen {...rowActions} />
      <TaskSection label="Sem data" tasks={buckets.noDate} defaultOpen {...rowActions} />
      <TaskSection label="Concluídas" tasks={done} defaultOpen={false} {...rowActions} />
    </div>
  );
}

function TaskSection({
  label, tasks, defaultOpen, tone, subtaskProgress, canCreate, canEdit, canDelete,
  duplicatePendingId, onOpen, onToggle, onDuplicate, onChangePriority,
  onChangeStatus, onDelete,
}: {
  label: string;
  tasks: NoteTaskWithNote[];
  defaultOpen: boolean;
  tone?: 'overdue' | 'today';
} & RowActions) {
  const [open, setOpen] = useState(defaultOpen);
  const sectionId = useId();
  if (tasks.length === 0) return null;

  return (
    <section className="mb-5">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-controls={sectionId}
        className="flex min-h-10 w-full items-center gap-2 py-2 text-left"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
        <span className={cn(
          'text-sm font-semibold',
          tone === 'overdue' ? 'text-destructive' :
          tone === 'today' ? 'text-amber-700 dark:text-amber-300' : 'text-foreground',
        )}>
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{tasks.length}</span>
        <span className="ml-2 h-px flex-1 bg-foreground/10" aria-hidden="true" />
      </button>
      {open && (
        <div id={sectionId} className="divide-y divide-foreground/10 border-y border-foreground/10">
          {tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              subtasks={subtaskProgress.get(task.id)}
              canCreate={canCreate}
              canEdit={canEdit}
              canDelete={canDelete}
              duplicatePending={duplicatePendingId === task.id}
              onOpen={() => onOpen(task.id)}
              onToggle={() => onToggle(task)}
              onDuplicate={() => onDuplicate(task)}
              onChangePriority={priority => onChangePriority(task, priority)}
              onChangeStatus={status => onChangeStatus(task, status)}
              onDelete={() => onDelete(task)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TaskRow({
  task, subtasks, canCreate, canEdit, canDelete, duplicatePending,
  onOpen, onToggle, onDuplicate, onChangePriority, onChangeStatus, onDelete,
}: {
  task: NoteTaskWithNote;
  subtasks?: SubtaskProgress;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  duplicatePending: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onChangePriority: (priority: NoteTaskPriority) => void;
  onChangeStatus: (status: NoteTaskStatus) => void;
  onDelete: () => void;
}) {
  return (
    <div className={cn(
      'group flex min-h-[64px] items-center gap-1 transition-colors hover:bg-foreground/[0.025]',
      task.done && 'bg-muted/20',
    )}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center">
        <Checkbox
          checked={task.done}
          disabled={!canEdit}
          onCheckedChange={onToggle}
          className={cn('h-5 w-5 rounded-full border-2', PRIORITY_DOT_BORDER[task.priority])}
          aria-label={task.done ? `Reabrir tarefa: ${task.text}` : `Concluir tarefa: ${task.text}`}
        />
      </div>

      <div className="min-w-0 flex-1 py-2.5">
        <button type="button" onClick={onOpen} className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <span className={cn(
            'block break-words text-sm leading-snug',
            task.done ? 'line-through text-muted-foreground' : 'text-foreground',
          )}>
            {task.text}
            {task.description && <span className="ml-1.5 align-middle text-xs text-muted-foreground" title="Tem descrição">≡</span>}
          </span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          {task.status === 'doing' && !task.done && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              <CircleHalf className="h-3 w-3" weight="fill" /> Em andamento
            </span>
          )}
          {!task.done && <TaskMetaLine task={task} subtasks={subtasks} />}
        </div>
      </div>

      <TaskActionsMenu
        task={task}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        duplicatePending={duplicatePending}
        onOpen={onOpen}
        onDuplicate={onDuplicate}
        onChangePriority={onChangePriority}
        onChangeStatus={onChangeStatus}
        onDelete={onDelete}
      />
    </div>
  );
}

function TaskContentState({
  isLoading, isError, onRetry, tasks, filtersActive, onClearFilters,
  emptyTitle, emptyDescription, children,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  tasks: NoteTaskWithNote[];
  filtersActive: boolean;
  onClearFilters: () => void;
  emptyTitle: string;
  emptyDescription: string;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError) {
    return (
      <EmptyState
        icon={WarningCircle}
        title="Não foi possível carregar as tarefas"
        description="A conexão falhou. Seu rascunho continua no campo acima."
        action={<Button variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button>}
      />
    );
  }
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={filtersActive ? Search : ListChecks}
        title={filtersActive ? 'Nenhuma tarefa corresponde aos filtros' : emptyTitle}
        description={filtersActive ? 'Limpe a busca e as tags para recuperar a fila completa.' : emptyDescription}
        action={filtersActive ? <Button variant="outline" size="sm" onClick={onClearFilters}>Limpar filtros</Button> : undefined}
      />
    );
  }
  return <>{children}</>;
}

function emptyTitleForScope(scope: TaskScope) {
  if (scope === 'open') return 'Tudo em dia';
  if (scope === 'today') return 'Nada previsto para hoje';
  if (scope === 'overdue') return 'Nenhuma tarefa atrasada';
  if (scope === 'upcoming') return 'Nenhuma tarefa planejada';
  if (scope === 'no-date') return 'Todas as tarefas estão planejadas';
  return 'Nenhuma tarefa concluída';
}

function emptyDescriptionForScope(scope: TaskScope) {
  if (scope === 'open') return 'Sua fila está vazia. Capture a próxima pendência no campo acima.';
  if (scope === 'today') return 'Use um vencimento para colocar uma tarefa no foco de hoje.';
  if (scope === 'overdue') return 'Não há nada fora do prazo neste momento.';
  if (scope === 'upcoming') return 'As tarefas com vencimento futuro aparecerão aqui.';
  if (scope === 'no-date') return 'Nenhuma pendência está aguardando uma data.';
  return 'As tarefas finalizadas aparecerão aqui.';
}

const PRIORITY_DOT_BORDER: Record<NoteTaskPriority, string> = {
  alta: 'border-destructive',
  media: 'border-amber-500',
  baixa: 'border-muted-foreground',
};

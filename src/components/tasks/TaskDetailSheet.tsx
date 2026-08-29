import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Plus, X, Eye, Code, Copy, File as FileIcon, Tag as TagIcon,
  CircleNotch as Loader2, Circle,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { useCan } from '@/hooks/useAccessControl';
import { cn } from '@/lib/utils';
import { DueDatePicker } from '@/components/tasks/TaskMeta';
import {
  useCreateNoteTask, useUpdateNoteTask, useDeleteNoteTask, normalizeTags,
  STATUS_LABEL,
  type NoteTask, type NoteTaskWithNote, type NoteTaskPriority, type NoteTaskStatus,
} from '@/hooks/useNoteTasks';

/**
 * TaskDetailSheet — "página" da tarefa estilo Notion, num Sheet lateral.
 * Título e descrição (markdown) com auto-save debounced; status, prioridade,
 * vencimento e tags salvam na hora; subtarefas como checklist com progresso.
 */
export function TaskDetailSheet({ task, subtasks, duplicatePending, onDuplicate, onClose }: {
  task: NoteTaskWithNote | null;
  subtasks: NoteTask[];
  duplicatePending?: boolean;
  onDuplicate?: () => void;
  onClose: () => void;
}) {
  const updateTask = useUpdateNoteTask();
  const deleteTask = useDeleteNoteTask();
  const createTask = useCreateNoteTask();
  // Gates de ação da área Tarefas (/tarefas). Admin e sem-granular sempre passam.
  const perm = useCan('/tarefas');

  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [descMode, setDescMode] = useState<'edit' | 'preview'>('preview');
  const [tagInput, setTagInput] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descriptionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset dos drafts quando troca de tarefa
  useEffect(() => {
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    if (descriptionSaveTimer.current) clearTimeout(descriptionSaveTimer.current);
    if (task) {
      setDraftTitle(task.text);
      setDraftDescription(task.description || '');
      setDescMode(task.description || !perm.canEdit ? 'preview' : 'edit');
      setTagInput('');
      setNewSubtask('');
    }
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null;

  const save = (data: Parameters<typeof updateTask.mutate>[0]['data']) =>
    perm.canEdit && updateTask.mutate({ id: task.id, note_id: task.note_id, data });

  const scheduleTitleSave = (text: string) => {
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    titleSaveTimer.current = setTimeout(() => save({ text }), 700);
  };

  const scheduleDescriptionSave = (description: string) => {
    if (descriptionSaveTimer.current) clearTimeout(descriptionSaveTimer.current);
    descriptionSaveTimer.current = setTimeout(() => save({ description }), 700);
  };

  const addTag = () => {
    const next = normalizeTags([...(task.tags || []), tagInput]);
    if (next.length !== (task.tags || []).length) save({ tags: next });
    setTagInput('');
  };

  const removeTag = (tag: string) =>
    save({ tags: (task.tags || []).filter(t => t !== tag) });

  const addSubtask = () => {
    const text = newSubtask.trim();
    if (!text) return;
    // Subtarefas nascem com note_id NULL — só existem dentro do pai
    createTask.mutate(
      { parent_task_id: task.id, text, priority: task.priority },
      { onSuccess: () => setNewSubtask('') },
    );
  };

  const doneSubtasks = subtasks.filter(s => s.done).length;

  return (
    <Sheet open={!!task} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-foreground/10 space-y-3">
          <SheetDescription className="sr-only">Detalhe da tarefa</SheetDescription>
          {/* Título editável com checkbox grande */}
          <div className="flex items-start gap-3">
            <Checkbox
              checked={task.done}
              disabled={!perm.canEdit}
              onCheckedChange={() => save({ done: !task.done })}
              className="h-5 w-5 mt-1.5 shrink-0 rounded-full border-2"
              aria-label={task.done ? 'Desmarcar tarefa' : 'Marcar como concluída'}
            />
            <SheetTitle className="flex-1 min-w-0">
              <Textarea
                value={draftTitle}
                disabled={!perm.canEdit}
                onChange={e => {
                  setDraftTitle(e.target.value);
                  if (e.target.value.trim()) scheduleTitleSave(e.target.value.trim());
                }}
                placeholder="Título da tarefa"
                rows={1}
                className={cn(
                  'min-h-0 resize-none border-0 px-0 py-1 text-lg font-bold leading-snug focus-visible:ring-0 bg-transparent',
                  task.done && 'line-through text-muted-foreground',
                )}
              />
            </SheetTitle>
          </div>

          {/* Metadados: status / prioridade / vencimento */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Select disabled={!perm.canEdit} value={task.status} onValueChange={v => save({ status: v as NoteTaskStatus })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todo">○ {STATUS_LABEL.todo}</SelectItem>
                <SelectItem value="doing">◐ {STATUS_LABEL.doing}</SelectItem>
                <SelectItem value="done">● {STATUS_LABEL.done}</SelectItem>
              </SelectContent>
            </Select>
            <Select disabled={!perm.canEdit} value={task.priority} onValueChange={v => save({ priority: v as NoteTaskPriority })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="alta"><span className="inline-flex items-center gap-1.5"><Circle weight="fill" className="h-3 w-3 text-red-600 dark:text-red-400" aria-hidden /> Alta</span></SelectItem>
                <SelectItem value="media"><span className="inline-flex items-center gap-1.5"><Circle weight="fill" className="h-3 w-3 text-amber-500" aria-hidden /> Média</span></SelectItem>
                <SelectItem value="baixa"><span className="inline-flex items-center gap-1.5"><Circle className="h-3 w-3 text-muted-foreground" aria-hidden /> Baixa</span></SelectItem>
              </SelectContent>
            </Select>
            <DueDatePicker disabled={!perm.canEdit} value={task.due_date} onChange={due => save({ due_date: due })} />
          </div>

          {/* Tags */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(task.tags || []).map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-sm border border-border bg-muted/40 text-[11px] text-muted-foreground"
              >
                <TagIcon className="h-3 w-3" />{tag}
                {perm.canEdit && (
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="hover:text-destructive transition-colors"
                    aria-label={`Remover tag ${tag}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
            {perm.canEdit && (
              <Input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && tagInput.trim()) { e.preventDefault(); addTag(); }
                  else if (e.key === 'Backspace' && !tagInput && (task.tags || []).length > 0) {
                    removeTag(task.tags[task.tags.length - 1]);
                  }
                }}
                onBlur={() => { if (tagInput.trim()) addTag(); }}
                placeholder="+ tag"
                className="h-6 w-24 text-[11px] px-2 border-dashed"
              />
            )}
          </div>

          {task.notes?.title && (
            <Link
              to="/notas"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <FileIcon className="h-3.5 w-3.5" />
              Vinculada à nota: <span className="font-medium">{task.notes.title}</span>
            </Link>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
          {/* Descrição markdown com toggle edit/preview */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="ed-eyebrow text-muted-foreground">Descrição</span>
              <div className="flex-1" />
              <div className="flex items-center gap-0.5 border border-foreground/10 rounded-sm p-0.5">
                {perm.canEdit && (
                  <button
                    type="button"
                    onClick={() => setDescMode('edit')}
                    className={cn(
                      'px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 transition-colors',
                      descMode === 'edit' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Code className="h-3 w-3" /> Editar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDescMode('preview')}
                  className={cn(
                    'px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 transition-colors',
                    descMode === 'preview' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Eye className="h-3 w-3" /> Ver
                </button>
              </div>
              {updateTask.isPending && (
                <span className="text-muted-foreground text-[11px] inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> salvando…
                </span>
              )}
            </div>
            {descMode === 'edit' && perm.canEdit ? (
              <Textarea
                value={draftDescription}
                onChange={e => {
                  setDraftDescription(e.target.value);
                  scheduleDescriptionSave(e.target.value);
                }}
                placeholder={'Detalhe a tarefa em markdown…\n\n- listas\n- [ ] checklists\n- **negrito**, links, tabelas'}
                className="min-h-[140px] font-mono text-sm leading-relaxed bg-foreground/[0.02]"
              />
            ) : (
              <div
                className="min-h-[60px] rounded-sm px-3 py-2 bg-foreground/[0.015] cursor-text hover:bg-foreground/[0.03] transition-colors"
                onClick={() => { if (perm.canEdit) setDescMode('edit'); }}
                onKeyDown={event => {
                  if (perm.canEdit && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    setDescMode('edit');
                  }
                }}
                role={perm.canEdit ? 'button' : undefined}
                tabIndex={perm.canEdit ? 0 : undefined}
                title={perm.canEdit ? 'Clique pra editar' : undefined}
              >
                <article className="note-markdown prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {draftDescription || (perm.canEdit ? '*Sem descrição. Clique pra escrever.*' : '*Sem descrição.*')}
                  </ReactMarkdown>
                </article>
              </div>
            )}
          </section>

          {/* Subtarefas */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="ed-eyebrow text-muted-foreground">Subtarefas</span>
              {subtasks.length > 0 && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {doneSubtasks}/{subtasks.length}
                </span>
              )}
            </div>
            {subtasks.length > 0 && (
              <Progress value={(doneSubtasks / subtasks.length) * 100} className="h-1 mb-3" />
            )}
            <div className="divide-y divide-foreground/5">
              {subtasks.map(sub => (
                <SubtaskRow
                  key={sub.id}
                  subtask={sub}
                  canEdit={perm.canEdit}
                  onToggle={() => updateTask.mutate({ id: sub.id, note_id: sub.note_id, data: { done: !sub.done } })}
                  onChangeText={(t) => updateTask.mutate({ id: sub.id, note_id: sub.note_id, data: { text: t } })}
                  onDelete={() => deleteTask.mutate({ id: sub.id, note_id: sub.note_id })}
                />
              ))}
            </div>
            {perm.canEdit && (
            <div className="flex items-center gap-2 mt-2">
              <Input
                value={newSubtask}
                onChange={e => setNewSubtask(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
                placeholder="+ Adicionar subtarefa (Enter)"
                className="h-8 text-sm flex-1"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1"
                onClick={addSubtask}
                disabled={!newSubtask.trim() || createTask.isPending}
                aria-label="Adicionar subtarefa"
              >
                {createTask.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              </Button>
            </div>
            )}
          </section>
        </div>

        {/* Footer: timestamps + excluir */}
        <div className="px-6 py-3 border-t border-foreground/10 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>Criada {format(new Date(task.created_at), "dd MMM yyyy 'às' HH:mm", { locale: ptBR })}</span>
          {task.completed_at && (
            <span>· Concluída {format(new Date(task.completed_at), 'dd MMM yyyy', { locale: ptBR })}</span>
          )}
          <div className="flex-1" />
          {perm.canCreate && onDuplicate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={onDuplicate}
              disabled={duplicatePending}
            >
              {duplicatePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
              {duplicatePending ? 'Duplicando…' : 'Duplicar'}
            </Button>
          )}
          {perm.canDelete && (
          <DeleteConfirmButton
            onConfirm={() => { deleteTask.mutate({ id: task.id, note_id: task.note_id }); onClose(); }}
            title="Excluir tarefa?"
            description={subtasks.length > 0
              ? `A tarefa e suas ${subtasks.length} subtarefa${subtasks.length === 1 ? '' : 's'} serão excluídas.`
              : 'Esta ação não pode ser desfeita.'}
          />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SubtaskRow({ subtask, canEdit, onToggle, onChangeText, onDelete }: {
  subtask: NoteTask;
  canEdit: boolean;
  onToggle: () => void;
  onChangeText: (t: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(subtask.text);
  return (
    <div className={cn('group flex items-center gap-2.5 py-2', subtask.done && 'bg-muted/20')}>
      <Checkbox
        checked={subtask.done}
        disabled={!canEdit}
        onCheckedChange={onToggle}
        className="h-4 w-4 shrink-0 rounded-full border-2"
        aria-label={subtask.done ? 'Desmarcar subtarefa' : 'Concluir subtarefa'}
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { if (draft.trim() && draft !== subtask.text) onChangeText(draft.trim()); setEditing(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') { setDraft(subtask.text); setEditing(false); }
            }}
            onClick={e => e.stopPropagation()}
            autoFocus
            className="h-7 text-sm py-0 px-2"
          />
        ) : (
          <button
            type="button"
            disabled={!canEdit || subtask.done}
            onClick={() => setEditing(true)}
            className={cn(
              'block w-full break-words text-left text-sm leading-snug disabled:cursor-default',
              subtask.done ? 'line-through text-muted-foreground' : 'text-foreground',
            )}
            aria-label={`Editar subtarefa: ${subtask.text}`}
          >
            {subtask.text}
          </button>
        )}
      </div>
      {canEdit && <button
        type="button"
        onClick={onDelete}
        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
        aria-label="Excluir subtarefa"
      >
        <X className="h-3.5 w-3.5" />
      </button>}
    </div>
  );
}

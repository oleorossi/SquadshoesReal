import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Tarefas do workspace (/tarefas e aba Tarefas em /notas).
 * Auto-ordenadas por prioridade (alta → média → baixa); dentro da MESMA
 * prioridade, a mais NOVA fica no topo (tiebreaker created_at DESC).
 * Migration 20260531170000_note_tasks_table +
 * 20260703120000_note_tasks_notion_todolist (due_date, tags, subtarefas,
 * status Kanban, descrição markdown).
 */

export type NoteTaskPriority = 'alta' | 'media' | 'baixa';
export type NoteTaskStatus = 'todo' | 'doing' | 'done';

export interface NoteTask {
  id: string;
  note_id: string | null;
  text: string;
  description: string;
  priority: NoteTaskPriority;
  status: NoteTaskStatus;
  done: boolean;
  due_date: string | null;      // 'YYYY-MM-DD'
  tags: string[];
  parent_task_id: string | null; // preenchido = subtarefa
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Task com título da nota vinculada (retorno de useAllNoteTasks). */
export type NoteTaskWithNote = NoteTask & { notes?: { title: string } | null };

// Mapa de ordenação: alta=1, media=2, baixa=3
const PRIORITY_ORDER: Record<NoteTaskPriority, number> = {
  alta: 1,
  media: 2,
  baixa: 3,
};

/** Ordena (done ASC, priority ASC, created_at DESC) — padrão das listas. */
export function sortTasks<T extends NoteTask>(tasks: T[]): T[] {
  return tasks.slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const dp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (dp !== 0) return dp;
    // Mesma prioridade: a mais NOVA primeiro (created_at DESC)
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
}

/**
 * Lista TODAS as tarefas (globais), com título da nota vinculada quando houver.
 * Inclui subtarefas (parent_task_id ≠ null) — as visões top-level devem
 * filtrar por parent_task_id === null.
 * Usado pela rota /tarefas (módulo standalone).
 */
export function useAllNoteTasks() {
  return useQuery({
    queryKey: ['all_note_tasks'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('note_tasks')
        .select('*, notes(title)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return sortTasks((data || []) as NoteTaskWithNote[]);
    },
    staleTime: 30_000,
  });
}

/** Lista as tarefas de uma nota (sem subtarefas — elas têm note_id NULL). */
export function useNoteTasks(noteId: string | null | undefined) {
  return useQuery({
    queryKey: ['note_tasks', noteId],
    enabled: !!noteId,
    queryFn: async () => {
      if (!noteId) return [] as NoteTask[];
      const { data, error } = await (supabase as any)
        .from('note_tasks')
        .select('*')
        .eq('note_id', noteId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return sortTasks((data || []) as NoteTask[]);
    },
    staleTime: 30_000,
  });
}

/** Campos aceitos na criação de uma tarefa. */
export interface CreateNoteTaskInput {
  note_id?: string | null;
  text: string;
  priority?: NoteTaskPriority;
  due_date?: string | null;
  tags?: string[];
  parent_task_id?: string | null;
  description?: string;
}

export function useCreateNoteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateNoteTaskInput) => {
      const { data, error } = await (supabase as any)
        .from('note_tasks')
        .insert({
          note_id: input.note_id ?? null,
          text: input.text.trim(),
          priority: input.priority || 'media',
          due_date: input.due_date ?? null,
          tags: normalizeTags(input.tags),
          parent_task_id: input.parent_task_id ?? null,
          description: input.description ?? '',
        })
        .select()
        .single();
      if (error) throw error;
      return data as NoteTask;
    },
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['note_tasks', task.note_id] });
      qc.invalidateQueries({ queryKey: ['all_note_tasks'] });
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao criar tarefa'),
  });
}

/**
 * Cria múltiplas tarefas de uma vez (mesmos metadados). Útil pro user
 * digitar várias linhas e salvar tudo em batch.
 * Retorna o array criado (em ordem do input).
 */
export function useBulkCreateNoteTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      note_id?: string | null;
      texts: string[];
      priority?: NoteTaskPriority;
      due_date?: string | null;
      tags?: string[];
    }) => {
      const cleaned = input.texts.map(t => t.trim()).filter(t => t.length > 0);
      if (cleaned.length === 0) throw new Error('Digite pelo menos uma tarefa.');
      const rows = cleaned.map(text => ({
        note_id: input.note_id ?? null,
        text,
        priority: input.priority || 'media',
        due_date: input.due_date ?? null,
        tags: normalizeTags(input.tags),
      }));
      const { data, error } = await (supabase as any)
        .from('note_tasks')
        .insert(rows)
        .select();
      if (error) throw error;
      return (data || []) as NoteTask[];
    },
    onSuccess: (tasks) => {
      const noteId = tasks[0]?.note_id;
      if (noteId) qc.invalidateQueries({ queryKey: ['note_tasks', noteId] });
      qc.invalidateQueries({ queryKey: ['all_note_tasks'] });
      toast.success(`${tasks.length} tarefa${tasks.length === 1 ? '' : 's'} adicionada${tasks.length === 1 ? '' : 's'}`);
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao criar tarefas'),
  });
}

/** Campos editáveis via useUpdateNoteTask. */
export type UpdateNoteTaskData = Partial<Pick<NoteTask,
  'text' | 'priority' | 'done' | 'status' | 'description' | 'due_date' | 'tags'
>>;

export function useUpdateNoteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note_id, data }: {
      id: string;
      note_id: string | null;
      data: UpdateNoteTaskData;
    }) => {
      const payload = { ...data };
      if (payload.tags) payload.tags = normalizeTags(payload.tags);
      const { error } = await (supabase as any).from('note_tasks').update(payload).eq('id', id);
      if (error) throw error;
      return { id, note_id };
    },
    onSuccess: ({ note_id }) => {
      if (note_id) qc.invalidateQueries({ queryKey: ['note_tasks', note_id] });
      qc.invalidateQueries({ queryKey: ['all_note_tasks'] });
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao atualizar tarefa'),
  });
}

export function useDeleteNoteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note_id }: { id: string; note_id: string | null }) => {
      const { error } = await (supabase as any).from('note_tasks').delete().eq('id', id);
      if (error) throw error;
      return note_id;
    },
    onSuccess: (note_id) => {
      if (note_id) qc.invalidateQueries({ queryKey: ['note_tasks', note_id] });
      qc.invalidateQueries({ queryKey: ['all_note_tasks'] });
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao excluir tarefa'),
  });
}

/** Normaliza tags: trim, lowercase, sem vazias/duplicadas. */
export function normalizeTags(tags: string[] | undefined | null): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase().replace(/^#/, '');
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

/** Labels e cores pra cada prioridade. */
export const PRIORITY_LABEL: Record<NoteTaskPriority, string> = {
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};

export const PRIORITY_COLOR: Record<NoteTaskPriority, { dot: string; badge: string; text: string }> = {
  alta:  { dot: 'bg-destructive',  badge: 'bg-destructive/10 text-destructive border-destructive/30',  text: 'text-destructive' },
  media: { dot: 'bg-amber-500',    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30', text: 'text-amber-700 dark:text-amber-300' },
  baixa: { dot: 'bg-muted-foreground', badge: 'bg-muted text-muted-foreground border-border', text: 'text-muted-foreground' },
};

export const STATUS_LABEL: Record<NoteTaskStatus, string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  done: 'Concluída',
};

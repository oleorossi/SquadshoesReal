import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Tarefas estruturadas vinculadas a uma nota (em /notas).
 * Auto-ordenadas por prioridade (alta → média → baixa), tiebreaker created_at.
 * Migration 20260531170000_note_tasks_table.
 */

export type NoteTaskPriority = 'alta' | 'media' | 'baixa';

export interface NoteTask {
  id: string;
  note_id: string;
  text: string;
  priority: NoteTaskPriority;
  done: boolean;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Mapa de ordenação: alta=1, media=2, baixa=3
const PRIORITY_ORDER: Record<NoteTaskPriority, number> = {
  alta: 1,
  media: 2,
  baixa: 3,
};

/** Lista todas as tarefas de uma nota, auto-ordenadas por prioridade. */
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
      // Ordena no client por (done ASC, priority ASC, created_at ASC):
      //   - Não-feitas primeiro (done=false)
      //   - Dentro dos não-feitos, alta antes de média antes de baixa
      //   - Feitas vão pro final (ainda agrupadas por prioridade)
      return ((data || []) as NoteTask[]).slice().sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const dp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (dp !== 0) return dp;
        return (a.created_at || '').localeCompare(b.created_at || '');
      });
    },
    staleTime: 30_000,
  });
}

export function useCreateNoteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { note_id: string; text: string; priority?: NoteTaskPriority }) => {
      const { data, error } = await (supabase as any)
        .from('note_tasks')
        .insert({
          note_id: input.note_id,
          text: input.text.trim(),
          priority: input.priority || 'media',
        })
        .select()
        .single();
      if (error) throw error;
      return data as NoteTask;
    },
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['note_tasks', task.note_id] });
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao criar tarefa'),
  });
}

export function useUpdateNoteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note_id, data }: {
      id: string;
      note_id: string;
      data: Partial<Pick<NoteTask, 'text' | 'priority' | 'done'>>;
    }) => {
      const { error } = await (supabase as any).from('note_tasks').update(data).eq('id', id);
      if (error) throw error;
      return { id, note_id };
    },
    onSuccess: ({ note_id }) => {
      qc.invalidateQueries({ queryKey: ['note_tasks', note_id] });
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao atualizar tarefa'),
  });
}

export function useDeleteNoteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note_id }: { id: string; note_id: string }) => {
      const { error } = await (supabase as any).from('note_tasks').delete().eq('id', id);
      if (error) throw error;
      return note_id;
    },
    onSuccess: (note_id) => {
      qc.invalidateQueries({ queryKey: ['note_tasks', note_id] });
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao excluir tarefa'),
  });
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

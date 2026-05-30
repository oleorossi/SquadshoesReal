import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ── Tipos ────────────────────────────────────────────────────────────────
export interface NoteFolder {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  folder_id: string | null;
  title: string;
  content: string;
  icon: string | null;
  pinned: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

// ── Pastas ───────────────────────────────────────────────────────────────
export function useNoteFolders() {
  return useQuery({
    queryKey: ['note_folders'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('note_folders')
        .select('*')
        .order('position')
        .order('name');
      if (error) throw error;
      return (data || []) as NoteFolder[];
    },
    staleTime: 60_000,
  });
}

export function useUpsertFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (f: { id?: string; name: string; parent_id?: string | null }) => {
      const name = f.name.trim();
      if (!name) throw new Error('Nome da pasta não pode ser vazio.');
      if (f.id) {
        const { error } = await (supabase as any).from('note_folders').update({ name, parent_id: f.parent_id ?? null }).eq('id', f.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('note_folders').insert({ name, parent_id: f.parent_id ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['note_folders'] });
      toast.success('Pasta salva.');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Notas dentro da pasta viram "sem pasta" (ON DELETE SET NULL no FK).
      const { error } = await (supabase as any).from('note_folders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['note_folders'] });
      qc.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Pasta removida. Notas movidas para "Sem pasta".');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ── Notas ────────────────────────────────────────────────────────────────
export function useNotes() {
  return useQuery({
    queryKey: ['notes'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('notes')
        .select('*')
        .order('pinned', { ascending: false })
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Note[];
    },
    staleTime: 30_000,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { folder_id?: string | null; title?: string } = {}) => {
      const { data, error } = await (supabase as any)
        .from('notes')
        .insert({ folder_id: input.folder_id ?? null, title: input.title ?? 'Nova nota', content: '' })
        .select()
        .single();
      if (error) throw error;
      return data as Note;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Pick<Note, 'title' | 'content' | 'icon' | 'pinned' | 'folder_id'>> }) => {
      const { error } = await (supabase as any).from('notes').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('notes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Nota removida.');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

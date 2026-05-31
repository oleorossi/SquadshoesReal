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
  parent_id: string | null;  // 2026-05-30: hierarquia Notion-like (sub-notas)
  title: string;
  content: string;
  icon: string | null;
  pinned: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Note enriquecida com filhos (montada client-side a partir do flat array). */
export interface NoteTreeNode extends Note {
  children: NoteTreeNode[];
  depth: number;
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
    mutationFn: async (input: { folder_id?: string | null; parent_id?: string | null; title?: string } = {}) => {
      const { data, error } = await (supabase as any)
        .from('notes')
        .insert({
          folder_id: input.folder_id ?? null,
          parent_id: input.parent_id ?? null,
          title: input.title ?? 'Nova nota',
          content: '',
        })
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
    mutationFn: async ({ id, data }: { id: string; data: Partial<Pick<Note, 'title' | 'content' | 'icon' | 'pinned' | 'folder_id' | 'parent_id' | 'position'>> }) => {
      const { error } = await (supabase as any).from('notes').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Monta uma árvore (root → children) a partir do array flat de notes.
 * Filtra opcionalmente por folder_id. Pinned vão pro topo de cada nível.
 */
export function buildNoteTree(notes: Note[], folderId: string | null | undefined): NoteTreeNode[] {
  // Filtra pelo escopo da pasta (ou todas se folderId === undefined)
  const scoped = folderId === undefined
    ? notes
    : notes.filter(n => folderId === null ? !n.folder_id : n.folder_id === folderId);

  // Map id → node enriquecido
  const map = new Map<string, NoteTreeNode>();
  scoped.forEach(n => map.set(n.id, { ...n, children: [], depth: 0 }));

  // Vincula filhos aos pais; nodes sem pai (ou cujo pai está fora do escopo) viram roots
  const roots: NoteTreeNode[] = [];
  map.forEach(node => {
    if (node.parent_id && map.has(node.parent_id)) {
      const parent = map.get(node.parent_id)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Recompute depth recursivamente (parent pode ter ganho depth depois do filho)
  const setDepth = (node: NoteTreeNode, d: number) => {
    node.depth = d;
    node.children.forEach(c => setDepth(c, d + 1));
  };
  roots.forEach(r => setDepth(r, 0));

  // Sort: pinned primeiro, depois updated_at desc
  const sort = (arr: NoteTreeNode[]) => {
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    });
    arr.forEach(n => sort(n.children));
  };
  sort(roots);

  return roots;
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

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Plus, FolderSimple as Folder, FolderPlus, File as FileIcon, MagnifyingGlass as Search,
  Trash as Trash2, PushPin, PushPinSlash, Eye, Code,
  CircleNotch as Loader2, Table as TableIcon,
  TextB, TextItalic, TextH, ListBullets, ListNumbers, CheckSquare,
  Link as LinkIcon, Code as CodeIcon, Quotes,
  CaretRight as ChevronRight, CaretDown as ChevronDown,
  DotsThreeVertical as MoreVertical,
  Image as ImageIcon,
  SidebarSimple,
  Columns,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { normalizeForSearch } from '@/lib/searchUtils';
import {
  useNoteFolders, useNotes, useCreateNote, useUpdateNote, useDeleteNote,
  useUpsertFolder, useDeleteFolder, buildNoteTree,
  type Note, type NoteTreeNode,
} from '@/hooks/useNotes';

const NO_FOLDER = '__none__';

// Modelo pronto pra "valores de mercadoria por fornecedor" — tabela GFM.
const SUPPLIER_TEMPLATE = `## Tabela de preços

| Mercadoria | Unidade | Preço | Atualizado |
|------------|---------|------:|------------|
| Couro sintético | m² | R$ 0,00 | ${new Date().toLocaleDateString('pt-BR')} |
| Solado | par | R$ 0,00 | ${new Date().toLocaleDateString('pt-BR')} |

**Contato:**

**Prazo de entrega:**

**Observações:**`;

// ────────────────────────────────────────────────────────────────────────
// Toolbar de formatação markdown — Notion-feel: clica → injeta sintaxe
// ────────────────────────────────────────────────────────────────────────
interface ToolbarAction {
  icon: React.ComponentType<any>;
  label: string;
  shortcut?: string;
  apply: (value: string, selStart: number, selEnd: number) => { next: string; cursorAt: number };
}

const wrapSelection = (left: string, right: string = left, placeholder = '') =>
  (value: string, selStart: number, selEnd: number) => {
    const selected = value.slice(selStart, selEnd) || placeholder;
    const next = value.slice(0, selStart) + left + selected + right + value.slice(selEnd);
    const cursorAt = selStart + left.length + selected.length;
    return { next, cursorAt };
  };

const insertLinePrefix = (prefix: string) =>
  (value: string, selStart: number, _selEnd: number) => {
    // Encontra início da linha atual
    const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    const cursorAt = selStart + prefix.length;
    return { next, cursorAt };
  };

const TOOLBAR: ToolbarAction[] = [
  { icon: TextB,        label: 'Negrito',           shortcut: '⌘B', apply: wrapSelection('**', '**', 'texto') },
  { icon: TextItalic,   label: 'Itálico',           shortcut: '⌘I', apply: wrapSelection('_', '_', 'texto') },
  { icon: TextH,        label: 'Título',                            apply: insertLinePrefix('## ') },
  { icon: ListBullets,  label: 'Lista',                             apply: insertLinePrefix('- ') },
  { icon: ListNumbers,  label: 'Lista numerada',                    apply: insertLinePrefix('1. ') },
  { icon: CheckSquare,  label: 'Tarefa',                            apply: insertLinePrefix('- [ ] ') },
  { icon: Quotes,       label: 'Citação',                           apply: insertLinePrefix('> ') },
  { icon: CodeIcon,     label: 'Código inline',                     apply: wrapSelection('`', '`', 'código') },
  { icon: LinkIcon,     label: 'Link',              shortcut: '⌘K', apply: wrapSelection('[', '](url)', 'texto') },
];

// ────────────────────────────────────────────────────────────────────────
// Página principal
// ────────────────────────────────────────────────────────────────────────
export default function Notes() {
  const { data: folders = [] } = useNoteFolders();
  const { data: notes = [], isLoading } = useNotes();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const upsertFolder = useUpsertFolder();
  const deleteFolder = useDeleteFolder();

  const [activeFolderId, setActiveFolderId] = useState<string | null>(null); // null = todas
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'edit' | 'split' | 'preview'>('edit');
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  // Sidebar collapsed = só editor visível (modo "focar na nota").
  // Persistido em localStorage pra preservar entre sessões.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('notes-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('notes-sidebar-collapsed', String(next)); } catch {}
      return next;
    });
  };

  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageDropTarget, setImageDropTarget] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => notes.find(n => n.id === selectedId) || null, [notes, selectedId]);

  useEffect(() => {
    if (selected) {
      setDraftTitle(selected.title);
      setDraftContent(selected.content);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tree de notas filtrada pelo escopo (pasta + busca) ──
  const noteTree = useMemo<NoteTreeNode[]>(() => {
    const q = normalizeForSearch(search);
    const fid = activeFolderId === NO_FOLDER ? null : (activeFolderId ?? undefined);

    if (q) {
      // Busca: ignora hierarquia, mostra flat
      const flat = notes.filter(n =>
        normalizeForSearch(n.title).includes(q) || normalizeForSearch(n.content).includes(q),
      );
      const scoped = activeFolderId === undefined || activeFolderId === null
        ? flat
        : flat.filter(n => activeFolderId === NO_FOLDER ? !n.folder_id : n.folder_id === activeFolderId);
      return scoped.map(n => ({ ...n, children: [], depth: 0 }));
    }
    return buildNoteTree(notes, fid);
  }, [notes, activeFolderId, search]);

  const countByFolder = useMemo(() => {
    const m = new Map<string, number>();
    let noFolder = 0;
    for (const n of notes) {
      if (n.folder_id) m.set(n.folder_id, (m.get(n.folder_id) || 0) + 1);
      else noFolder++;
    }
    return { m, noFolder };
  }, [notes]);

  // ── Save debounced ──
  const scheduleSave = useCallback((patch: { title?: string; content?: string }) => {
    if (!selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateNote.mutate({ id: selectedId, data: patch });
    }, 700);
  }, [selectedId, updateNote]);

  // ── Criar nota (root ou sub) ──
  const handleNewNote = async (parentId?: string) => {
    const folder = activeFolderId && activeFolderId !== NO_FOLDER ? activeFolderId : null;
    const note = await createNote.mutateAsync({ folder_id: folder, parent_id: parentId ?? null });
    setSelectedId(note.id);
    setMode('edit');
    if (parentId) {
      setExpandedNotes(prev => new Set(prev).add(parentId));
    }
  };

  const insertTemplate = () => {
    const next = (draftContent ? draftContent + '\n\n' : '') + SUPPLIER_TEMPLATE;
    setDraftContent(next);
    scheduleSave({ content: next });
  };

  const togglePin = (note: Note) => updateNote.mutate({ id: note.id, data: { pinned: !note.pinned } });

  const toggleExpand = (id: string) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Upload de imagem (3 caminhos: botão, drag-drop, paste) ──
  const uploadImageFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (arr.length === 0) return;
    if (!selectedId) {
      toast.error('Selecione ou crie uma nota antes de enviar imagem');
      return;
    }

    setUploadingImage(true);
    try {
      const inserts: string[] = [];
      for (const file of arr) {
        // Validação simples: ≤ 10MB (bucket também tem limit no DB)
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`"${file.name}" excede 10 MB e foi pulada`);
          continue;
        }

        // Path: notes/<noteId>/<timestamp>-<slug>.<ext>
        const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
        const safeName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 40);
        const path = `notes/${selectedId}/${Date.now()}-${safeName || 'img'}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from('note-images')
          .upload(path, file, { cacheControl: '3600', upsert: false });
        if (upErr) {
          toast.error(`Falha no upload de "${file.name}": ${upErr.message}`);
          continue;
        }

        const { data: pub } = supabase.storage.from('note-images').getPublicUrl(path);
        if (pub?.publicUrl) {
          inserts.push(`![${safeName || 'imagem'}](${pub.publicUrl})`);
        }
      }

      if (inserts.length === 0) return;

      // Insere todas as imagens no cursor (uma por linha)
      const ta = editorRef.current;
      const block = inserts.join('\n') + '\n';
      let next: string;
      let cursorAt: number;
      if (ta) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        // Quebra de linha antes se o cursor não está no início da linha
        const needsLeadingBreak = start > 0 && draftContent[start - 1] !== '\n';
        const prefix = needsLeadingBreak ? '\n' : '';
        next = draftContent.slice(0, start) + prefix + block + draftContent.slice(end);
        cursorAt = start + prefix.length + block.length;
      } else {
        next = draftContent + (draftContent && !draftContent.endsWith('\n') ? '\n' : '') + block;
        cursorAt = next.length;
      }
      setDraftContent(next);
      scheduleSave({ content: next });
      requestAnimationFrame(() => {
        if (ta) {
          ta.focus();
          ta.setSelectionRange(cursorAt, cursorAt);
        }
      });
      toast.success(`${inserts.length} imagem(ns) inseridas`);
    } finally {
      setUploadingImage(false);
    }
  }, [selectedId, draftContent, scheduleSave]);

  const handleImageButton = () => fileInputRef.current?.click();

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void uploadImageFiles(e.target.files);
      e.target.value = ''; // permite re-selecionar o mesmo arquivo
    }
  };

  // Drag-drop de arquivos no editor
  const handleEditorDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (Array.from(e.dataTransfer.items).some(i => i.kind === 'file')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setImageDropTarget(true);
    }
  };
  const handleEditorDragLeave = () => setImageDropTarget(false);
  const handleEditorDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    setImageDropTarget(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      e.preventDefault();
      void uploadImageFiles(files);
    }
  };

  // Paste de imagem (Cmd+V de print, copy de imagem do browser, etc.)
  const handleEditorPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      void uploadImageFiles(imageFiles);
    }
    // Sem imagem no clipboard? Deixa o paste de texto seguir normal.
  };

  // ── Toolbar markdown ──
  const applyToolbar = (action: ToolbarAction) => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const { next, cursorAt } = action.apply(draftContent, start, end);
    setDraftContent(next);
    scheduleSave({ content: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(cursorAt, cursorAt);
    });
  };

  // Atalhos teclado (cmd+B/I/K)
  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const action =
      e.key.toLowerCase() === 'b' ? TOOLBAR[0] :
      e.key.toLowerCase() === 'i' ? TOOLBAR[1] :
      e.key.toLowerCase() === 'k' ? TOOLBAR[8] : null;
    if (action) {
      e.preventDefault();
      applyToolbar(action);
    }
  };

  // ── Drag-drop (HTML5) ──
  const handleDragStart = (e: React.DragEvent, noteId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/note-id', noteId);
    setDraggingNoteId(noteId);
  };

  const handleDragEnd = () => setDraggingNoteId(null);

  const handleDropAsChild = (e: React.DragEvent, targetParentId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData('text/note-id');
    if (!draggedId || draggedId === targetParentId) return;
    // Bloqueia drop em descendente (criaria ciclo)
    if (targetParentId && isDescendantOf(notes, draggedId, targetParentId)) return;
    updateNote.mutate({ id: draggedId, data: { parent_id: targetParentId } });
    setDraggingNoteId(null);
    if (targetParentId) setExpandedNotes(prev => new Set(prev).add(targetParentId));
  };

  return (
    <div className="space-y-4 page-enter">
      <EditorialPageHeader
        sectionLabel="WORKSPACE · NOTAS"
        title="Notas"
        description="Páginas hierárquicas com markdown. Cmd+B/I/K, arraste pra reorganizar."
        live
      />

      <div className="grid grid-cols-12 gap-0 surface-sharp overflow-hidden" style={{ minHeight: 'calc(100vh - 220px)' }}>

        {/* ═══════════════ COL 1 · PASTAS (esconde quando sidebar collapsed) ═══════════════ */}
        {!sidebarCollapsed && (
        <aside
          className="col-span-12 md:col-span-2 border-r border-foreground/10 bg-foreground/[0.015]"
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        >
          <div className="px-3 py-2.5 border-b border-foreground/10 flex items-center justify-between">
            <span className="ed-eyebrow">Pastas</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => { setFolderName(''); setFolderDialogOpen(true); }}
              aria-label="Nova pasta"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="py-1.5">
            <FolderRow
              label="Todas"
              count={notes.length}
              active={activeFolderId === null}
              onClick={() => setActiveFolderId(null)}
              icon={<FileIcon className="h-3.5 w-3.5" />}
            />
            <FolderRow
              label="Sem pasta"
              count={countByFolder.noFolder}
              active={activeFolderId === NO_FOLDER}
              onClick={() => setActiveFolderId(NO_FOLDER)}
              icon={<Folder className="h-3.5 w-3.5" />}
            />
            <div className="my-1.5 mx-3 border-t border-foreground/10" />
            {folders.map(f => (
              <FolderRow
                key={f.id}
                label={f.name}
                count={countByFolder.m.get(f.id) || 0}
                active={activeFolderId === f.id}
                onClick={() => setActiveFolderId(f.id)}
                icon={<Folder className="h-3.5 w-3.5" />}
                onDelete={() => deleteFolder.mutate(f.id)}
              />
            ))}
          </div>
        </aside>
        )}

        {/* ═══════════════ COL 2 · TREE DE NOTAS (esconde quando sidebar collapsed) ═══════════════ */}
        {!sidebarCollapsed && (
        <aside className="col-span-12 md:col-span-3 border-r border-foreground/10 flex flex-col">
          <div className="p-3 border-b border-foreground/10 space-y-2.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar nas notas..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
            <Button
              onClick={() => handleNewNote()}
              size="sm"
              className="w-full gap-1.5 h-8"
              disabled={createNote.isPending}
              variant="editorial-outline"
            >
              <Plus className="h-3.5 w-3.5" /> Nova página
            </Button>
          </div>
          <div className="flex-1 overflow-auto py-1">
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : noteTree.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-12 px-3">
                {search ? 'Nada encontrado.' : 'Nenhuma página aqui. Clique em "Nova página".'}
              </p>
            ) : (
              <div
                className="py-1"
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={e => handleDropAsChild(e, null)}
              >
                {noteTree.map(node => (
                  <NoteTreeRow
                    key={node.id}
                    node={node}
                    selectedId={selectedId}
                    expandedIds={expandedNotes}
                    draggingId={draggingNoteId}
                    onSelect={(id) => { setSelectedId(id); setMode('edit'); }}
                    onToggle={toggleExpand}
                    onAddChild={(parentId) => handleNewNote(parentId)}
                    onPin={togglePin}
                    onDelete={(id) => { deleteNote.mutate(id); if (selectedId === id) setSelectedId(null); }}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDropAsChild={handleDropAsChild}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>
        )}

        {/* ═══════════════ COL 3 · EDITOR (expande pra 12 quando sidebar collapsed) ═══════════════ */}
        <main className={cn(
          'col-span-12 flex flex-col',
          sidebarCollapsed ? 'md:col-span-12' : 'md:col-span-7',
        )}>
          {!selected ? (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon={FileIcon}
                title="Selecione ou crie uma página"
                description='Markdown completo: # títulos, - listas, [ ] tarefas, | tabelas. Cmd+B/I/K na hora certa.'
              />
            </div>
          ) : (
            <>
              {/* Toolbar superior — título + modo + ações de página */}
              <div className="px-5 py-3 border-b border-foreground/10 flex items-center gap-2 flex-wrap">
                {/* Botão toggle sidebar — esconde pastas + tree pra focar na nota */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={toggleSidebar}
                      aria-label={sidebarCollapsed ? 'Mostrar menu' : 'Esconder menu'}
                    >
                      <SidebarSimple className={cn('h-4 w-4', sidebarCollapsed && 'rotate-180')} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{sidebarCollapsed ? 'Mostrar pastas e árvore' : 'Focar na nota (esconder menu)'}</TooltipContent>
                </Tooltip>
                <Input
                  value={draftTitle}
                  onChange={e => { setDraftTitle(e.target.value); scheduleSave({ title: e.target.value }); }}
                  placeholder="Sem título"
                  className="h-9 font-mono text-base font-bold flex-1 min-w-[200px] border-0 px-0 focus-visible:ring-0 bg-transparent placeholder:text-muted-foreground/40"
                />
                <div className="flex items-center gap-1 border border-foreground/10 rounded-sm p-0.5">
                  <button
                    onClick={() => setMode('edit')}
                    className={cn(
                      'px-2.5 py-1 rounded-sm text-xs font-bold uppercase tracking-wider gap-1 inline-flex items-center transition-colors',
                      mode === 'edit' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Code className="h-3 w-3" /> Edit
                  </button>
                  <button
                    onClick={() => setMode('split')}
                    className={cn(
                      'px-2.5 py-1 rounded-sm text-xs font-bold uppercase tracking-wider gap-1 inline-flex items-center transition-colors',
                      mode === 'split' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                    )}
                    title="Editor + preview lado-a-lado"
                  >
                    <Columns className="h-3 w-3" /> Split
                  </button>
                  <button
                    onClick={() => setMode('preview')}
                    className={cn(
                      'px-2.5 py-1 rounded-sm text-xs font-bold uppercase tracking-wider gap-1 inline-flex items-center transition-colors',
                      mode === 'preview' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Eye className="h-3 w-3" /> Preview
                  </button>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => togglePin(selected)} aria-label="Fixar">
                      {selected.pinned ? <PushPinSlash className="h-4 w-4 text-amber-500" /> : <PushPin className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{selected.pinned ? 'Desfixar' : 'Fixar página'}</TooltipContent>
                </Tooltip>
                <DeleteConfirmButton
                  onConfirm={() => { deleteNote.mutate(selected.id); setSelectedId(null); }}
                  size="icon"
                />
              </div>

              {/* Toolbar markdown — visível em edit e split */}
              {(mode === 'edit' || mode === 'split') && (
                <div className="px-5 py-2 border-b border-foreground/10 flex items-center gap-1 flex-wrap bg-foreground/[0.02]">
                  {TOOLBAR.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Tooltip key={action.label}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => applyToolbar(action)}
                            className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                            aria-label={action.label}
                          >
                            <Icon className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {action.label}{action.shortcut && <span className="ml-2 text-muted-foreground">{action.shortcut}</span>}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                  <div className="w-px h-5 bg-foreground/10 mx-1" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleImageButton}
                        disabled={uploadingImage}
                        className="h-7 px-2 inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors font-medium disabled:opacity-50"
                      >
                        {uploadingImage ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ImageIcon className="h-3.5 w-3.5" />
                        )}
                        Imagem
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Inserir imagem · também aceita arrastar arquivo ou colar (⌘V) no editor
                    </TooltipContent>
                  </Tooltip>
                  <button
                    type="button"
                    onClick={insertTemplate}
                    className="h-7 px-2 inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors font-medium"
                    title="Inserir tabela de preços (template)"
                  >
                    <TableIcon className="h-3.5 w-3.5" /> Tabela
                  </button>
                  <div className="flex-1" />
                  {(updateNote.isPending || uploadingImage) && (
                    <span className="text-muted-foreground text-xs inline-flex items-center gap-1.5 px-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {uploadingImage ? 'enviando imagem…' : 'salvando…'}
                    </span>
                  )}
                </div>
              )}

              {/* Input file oculto — usado pelo botão "Imagem" da toolbar */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml"
                multiple
                onChange={handleFileInput}
                className="hidden"
              />

              {/* Conteúdo: editor, split (lado-a-lado) ou preview */}
              <div className={cn(
                'flex-1 overflow-hidden relative',
                mode === 'split' ? 'grid grid-cols-2 divide-x divide-foreground/10' : '',
              )}>
                {/* Editor (visível em edit e split) */}
                {(mode === 'edit' || mode === 'split') && (
                  <div className="relative overflow-auto px-8 py-6">
                    <Textarea
                      ref={editorRef}
                      value={draftContent}
                      onChange={e => { setDraftContent(e.target.value); scheduleSave({ content: e.target.value }); }}
                      onKeyDown={onEditorKeyDown}
                      onDragOver={handleEditorDragOver}
                      onDragLeave={handleEditorDragLeave}
                      onDrop={handleEditorDrop}
                      onPaste={handleEditorPaste}
                      placeholder="Comece a escrever... (arraste imagens ou cole com ⌘V)"
                      className="min-h-full font-mono text-sm leading-relaxed resize-none border-0 px-0 focus-visible:ring-0 bg-transparent"
                    />
                    {imageDropTarget && (
                      <div className="absolute inset-4 pointer-events-none border-2 border-dashed border-primary bg-primary/5 rounded-sm flex items-center justify-center">
                        <div className="text-center">
                          <ImageIcon className="h-8 w-8 mx-auto text-primary mb-2" weight="duotone" />
                          <p className="ed-eyebrow text-primary">Solte para inserir imagem</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Preview (visível em preview e split) */}
                {(mode === 'preview' || mode === 'split') && (
                  <div className="overflow-auto px-8 py-6 bg-foreground/[0.015]">
                    <article className="note-markdown prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {draftContent || '*Nota vazia.*'}
                      </ReactMarkdown>
                    </article>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Dialog nova pasta */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova pasta</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              value={folderName}
              onChange={e => setFolderName(e.target.value)}
              placeholder="Ex.: Fornecedores"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && folderName.trim()) {
                  upsertFolder.mutate({ name: folderName });
                  setFolderDialogOpen(false);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)}>Cancelar</Button>
            <Button disabled={!folderName.trim()} onClick={() => { upsertFolder.mutate({ name: folderName }); setFolderDialogOpen(false); }}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** Verifica se ancestorId está na cadeia de pais de descendantId (impede ciclo no drag). */
function isDescendantOf(notes: Note[], ancestorId: string, descendantId: string): boolean {
  let current: Note | undefined = notes.find(n => n.id === descendantId);
  while (current?.parent_id) {
    if (current.parent_id === ancestorId) return true;
    current = notes.find(n => n.id === current!.parent_id);
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────
// Componente: linha de pasta na coluna 1
// ────────────────────────────────────────────────────────────────────────
function FolderRow({ label, count, active, onClick, icon, onDelete }: {
  label: string; count: number; active: boolean; onClick: () => void;
  icon: React.ReactNode; onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer transition-colors border-l-2',
        active
          ? 'border-l-foreground bg-foreground/5 text-foreground font-semibold'
          : 'border-l-transparent text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground',
      )}
      onClick={onClick}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate flex-1">{label}</span>
      <Badge variant="outline" className="h-4 px-1 text-[10px] tabular-nums shrink-0">{count}</Badge>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Excluir a pasta "${label}"? As notas dentro dela vão para "Sem pasta".`)) onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
          aria-label={`Excluir pasta ${label}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Componente: linha recursiva da árvore de notas
// ────────────────────────────────────────────────────────────────────────
interface NoteTreeRowProps {
  node: NoteTreeNode;
  selectedId: string | null;
  expandedIds: Set<string>;
  draggingId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onPin: (note: Note) => void;
  onDelete: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDropAsChild: (e: React.DragEvent, parentId: string) => void;
}

function NoteTreeRow({
  node, selectedId, expandedIds, draggingId,
  onSelect, onToggle, onAddChild, onPin, onDelete,
  onDragStart, onDragEnd, onDropAsChild,
}: NoteTreeRowProps) {
  const hasChildren = node.children.length > 0;
  const expanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const isDragging = draggingId === node.id;
  const [dropTarget, setDropTarget] = useState(false);

  return (
    <>
      <div
        draggable
        onDragStart={(e) => onDragStart(e, node.id)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDropTarget(true); }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(e) => { setDropTarget(false); onDropAsChild(e, node.id); }}
        className={cn(
          'group flex items-center gap-1 px-2 py-1 cursor-pointer transition-colors text-sm border-l-2',
          isSelected
            ? 'border-l-primary bg-primary/[0.06] text-foreground font-semibold'
            : 'border-l-transparent hover:bg-foreground/[0.03]',
          isDragging && 'opacity-40',
          dropTarget && !isDragging && 'bg-primary/10 border-l-primary',
        )}
        style={{ paddingLeft: `${8 + node.depth * 14}px` }}
        onClick={() => onSelect(node.id)}
      >
        {/* Toggle */}
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
            className="h-4 w-4 shrink-0 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={expanded ? 'Recolher' : 'Expandir'}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}

        {/* Icon + título */}
        <span className="text-xs shrink-0">{node.icon || '📄'}</span>
        <span className="truncate flex-1">
          {node.pinned && <PushPin weight="fill" className="inline h-2.5 w-2.5 text-amber-500 mr-0.5" />}
          {node.title || 'Sem título'}
        </span>

        {/* Ações inline */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
                className="h-5 w-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-foreground/10"
                aria-label="Adicionar sub-página"
              >
                <Plus className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Sub-página</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="h-5 w-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-foreground/10"
                aria-label="Mais ações"
              >
                <MoreVertical className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => onPin(node)}>
                {node.pinned ? <PushPinSlash className="h-3.5 w-3.5 mr-2" /> : <PushPin className="h-3.5 w-3.5 mr-2" />}
                {node.pinned ? 'Desfixar' : 'Fixar no topo'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAddChild(node.id)}>
                <Plus className="h-3.5 w-3.5 mr-2" /> Nova sub-página
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (confirm(`Excluir "${node.title || 'Sem título'}" e todas as sub-páginas?`)) {
                    onDelete(node.id);
                  }
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Filhos */}
      {hasChildren && expanded && node.children.map(child => (
        <NoteTreeRow
          key={child.id}
          node={child}
          selectedId={selectedId}
          expandedIds={expandedIds}
          draggingId={draggingId}
          onSelect={onSelect}
          onToggle={onToggle}
          onAddChild={onAddChild}
          onPin={onPin}
          onDelete={onDelete}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDropAsChild={onDropAsChild}
        />
      ))}
    </>
  );
}

import { useMemo, useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Plus, FolderSimple as Folder, FolderPlus, File as FileIcon, MagnifyingGlass as Search,
  Trash as Trash2, PushPin, PushPinSlash, PencilSimple as Pencil, Eye, Code,
  CircleNotch as Loader2, Table as TableIcon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { normalizeForSearch } from '@/lib/searchUtils';
import {
  useNoteFolders, useNotes, useCreateNote, useUpdateNote, useDeleteNote,
  useUpsertFolder, useDeleteFolder, type Note,
} from '@/hooks/useNotes';

const NO_FOLDER = '__none__';

// Modelo pronto pra "valores de mercadoria por fornecedor" — tabela GFM.
const SUPPLIER_TEMPLATE = `# Tabela de preços — Fornecedor

| Mercadoria | Unidade | Preço | Atualizado |
|------------|---------|------:|------------|
| Couro sintético | m² | R$ 0,00 | ${new Date().toLocaleDateString('pt-BR')} |
| Solado | par | R$ 0,00 | ${new Date().toLocaleDateString('pt-BR')} |

**Contato:** \n**Prazo de entrega:** \n**Observações:**
`;

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
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState('');

  // Buffer local de edição (salva no blur / debounce) pra não bater no banco a cada tecla.
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = useMemo(() => notes.find(n => n.id === selectedId) || null, [notes, selectedId]);

  // Sincroniza buffer quando troca de nota selecionada.
  useEffect(() => {
    if (selected) {
      setDraftTitle(selected.title);
      setDraftContent(selected.content);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let list = notes;
    if (activeFolderId === NO_FOLDER) list = list.filter(n => !n.folder_id);
    else if (activeFolderId) list = list.filter(n => n.folder_id === activeFolderId);
    const q = normalizeForSearch(search);
    if (q) list = list.filter(n =>
      normalizeForSearch(n.title).includes(q) || normalizeForSearch(n.content).includes(q));
    return list;
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

  const scheduleSave = (patch: { title?: string; content?: string }) => {
    if (!selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateNote.mutate({ id: selectedId, data: patch });
    }, 700);
  };

  const handleNewNote = async () => {
    const folder = activeFolderId && activeFolderId !== NO_FOLDER ? activeFolderId : null;
    const note = await createNote.mutateAsync({ folder_id: folder });
    setSelectedId(note.id);
    setMode('edit');
  };

  const insertTemplate = () => {
    const next = (draftContent ? draftContent + '\n\n' : '') + SUPPLIER_TEMPLATE;
    setDraftContent(next);
    scheduleSave({ content: next });
  };

  const togglePin = (note: Note) => updateNote.mutate({ id: note.id, data: { pinned: !note.pinned } });

  return (
    <div className="space-y-4 page-enter">
      <EditorialPageHeader
        sectionLabel="COMERCIAL · NOTAS"
        title="Notas"
        description="Anotações da equipe — fornecedores, preços, processos. Suporta tabelas e formatação (markdown)."
      />

      <div className="grid grid-cols-12 gap-4">
        {/* ── Coluna 1: pastas ── */}
        <div className="col-span-12 md:col-span-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pastas</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setFolderName(''); setFolderDialogOpen(true); }} aria-label="Nova pasta">
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-0.5">
            <FolderRow label="Todas as notas" count={notes.length} active={activeFolderId === null} onClick={() => setActiveFolderId(null)} icon={<FileIcon className="h-4 w-4" />} />
            <FolderRow label="Sem pasta" count={countByFolder.noFolder} active={activeFolderId === NO_FOLDER} onClick={() => setActiveFolderId(NO_FOLDER)} icon={<Folder className="h-4 w-4" />} />
            {folders.map(f => (
              <FolderRow
                key={f.id}
                label={f.name}
                count={countByFolder.m.get(f.id) || 0}
                active={activeFolderId === f.id}
                onClick={() => setActiveFolderId(f.id)}
                icon={<Folder className="h-4 w-4" />}
                onDelete={() => deleteFolder.mutate(f.id)}
              />
            ))}
          </div>
        </div>

        {/* ── Coluna 2: lista de notas ── */}
        <div className="col-span-12 md:col-span-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Buscar notas..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-8" />
          </div>
          <Button onClick={handleNewNote} size="sm" className="w-full gap-1.5" disabled={createNote.isPending}>
            <Plus className="h-4 w-4" /> Nova nota
          </Button>
          <div className="space-y-1 max-h-[60vh] overflow-auto">
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">Nenhuma nota aqui.</p>
            ) : filtered.map(n => (
              <button
                key={n.id}
                onClick={() => { setSelectedId(n.id); setMode('edit'); }}
                className={cn(
                  'w-full text-left rounded-md border px-3 py-2 transition-colors',
                  selectedId === n.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
                )}
              >
                <div className="flex items-center gap-1.5">
                  {n.pinned && <PushPin weight="fill" className="h-3 w-3 text-amber-500 shrink-0" />}
                  <span className="text-sm font-medium truncate">{n.icon ? `${n.icon} ` : ''}{n.title || 'Sem título'}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {n.content.replace(/[#*|>`-]/g, '').trim().slice(0, 60) || 'Vazia'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(n.updated_at).toLocaleDateString('pt-BR')}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* ── Coluna 3: editor ── */}
        <div className="col-span-12 md:col-span-6">
          {!selected ? (
            <Panel flush>
              <EmptyState icon={FileIcon} title="Selecione ou crie uma nota" description="Escreva em markdown — títulos com #, listas com -, e tabelas com | para valores de fornecedor." />
            </Panel>
          ) : (
            <div className="space-y-3">
              {/* Toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  value={draftTitle}
                  onChange={e => { setDraftTitle(e.target.value); scheduleSave({ title: e.target.value }); }}
                  placeholder="Título da nota"
                  className="h-9 font-semibold flex-1 min-w-[180px]"
                />
                <div className="flex gap-1 bg-muted rounded-md p-1">
                  <button onClick={() => setMode('edit')} className={cn('px-2.5 py-1 rounded text-xs font-medium gap-1 inline-flex items-center', mode === 'edit' ? 'bg-background shadow text-foreground' : 'text-muted-foreground')}>
                    <Code className="h-3.5 w-3.5" /> Editar
                  </button>
                  <button onClick={() => setMode('preview')} className={cn('px-2.5 py-1 rounded text-xs font-medium gap-1 inline-flex items-center', mode === 'preview' ? 'bg-background shadow text-foreground' : 'text-muted-foreground')}>
                    <Eye className="h-3.5 w-3.5" /> Visualizar
                  </button>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => togglePin(selected)} aria-label="Fixar">
                  {selected.pinned ? <PushPinSlash className="h-4 w-4" /> : <PushPin className="h-4 w-4" />}
                </Button>
                <DeleteConfirmButton onConfirm={() => { deleteNote.mutate(selected.id); setSelectedId(null); }} size="icon" />
              </div>

              {/* Linha de ações secundárias */}
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={insertTemplate}>
                  <TableIcon className="h-3.5 w-3.5" /> Inserir tabela de preços
                </Button>
                <Select
                  value={selected.folder_id ?? NO_FOLDER}
                  onValueChange={(v) => updateNote.mutate({ id: selected.id, data: { folder_id: v === NO_FOLDER ? null : v } })}
                >
                  <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="Pasta" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FOLDER}>Sem pasta</SelectItem>
                    {folders.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {updateNote.isPending && <span className="text-muted-foreground inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> salvando…</span>}
              </div>

              {mode === 'edit' ? (
                <Textarea
                  value={draftContent}
                  onChange={e => { setDraftContent(e.target.value); scheduleSave({ content: e.target.value }); }}
                  placeholder={'Escreva aqui...\n\n# Título\n- item\n\n| Coluna | Valor |\n|--------|------:|\n| Item   | R$ 0  |'}
                  className="min-h-[55vh] font-mono text-sm leading-relaxed"
                />
              ) : (
                <Panel>
                  <article className="note-markdown prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{draftContent || '*Nota vazia.*'}</ReactMarkdown>
                  </article>
                </Panel>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dialog nova pasta */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova pasta</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="Ex.: Fornecedores" autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && folderName.trim()) { upsertFolder.mutate({ name: folderName }); setFolderDialogOpen(false); } }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)}>Cancelar</Button>
            <Button disabled={!folderName.trim()} onClick={() => { upsertFolder.mutate({ name: folderName }); setFolderDialogOpen(false); }}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FolderRow({ label, count, active, onClick, icon, onDelete }: {
  label: string; count: number; active: boolean; onClick: () => void;
  icon: React.ReactNode; onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm cursor-pointer transition-colors',
        active ? 'bg-primary/10 text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
      )}
      onClick={onClick}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate flex-1">{label}</span>
      <Badge variant="outline" className="h-4 px-1 text-[10px] tabular-nums shrink-0">{count}</Badge>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); if (confirm(`Excluir a pasta "${label}"? As notas dentro dela vão para "Sem pasta".`)) onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
          aria-label={`Excluir pasta ${label}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

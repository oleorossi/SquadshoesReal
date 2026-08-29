import { useEffect, useRef, useState } from 'react';
import {
  Circle, CircleNotch as Loader2, Faders, Plus, Tag as TagIcon, X,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DueDatePicker } from '@/components/tasks/TaskMeta';
import {
  normalizeTags, useBulkCreateNoteTasks, type NoteTaskPriority,
} from '@/hooks/useNoteTasks';

interface TaskQuickCaptureProps {
  canCreate: boolean;
}

export function TaskQuickCapture({ canCreate }: TaskQuickCaptureProps) {
  const bulkCreate = useBulkCreateNoteTasks();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [newText, setNewText] = useState('');
  const [newPriority, setNewPriority] = useState<NoteTaskPriority>('media');
  const [newDueDate, setNewDueDate] = useState<string | null>(null);
  const [newTags, setNewTags] = useState('');

  useEffect(() => {
    const focusCapture = (event: KeyboardEvent) => {
      if (!canCreate || event.key.toLowerCase() !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      setExpanded(true);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', focusCapture);
    return () => window.removeEventListener('keydown', focusCapture);
  }, [canCreate]);

  if (!canCreate) {
    return (
      <div className="border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        Este acesso é somente leitura. Você pode consultar e abrir as tarefas existentes.
      </div>
    );
  }

  const parsedLines = newText.split('\n').map(text => text.trim()).filter(Boolean);
  const lineCount = parsedLines.length;

  const reset = () => {
    setNewText('');
    setNewPriority('media');
    setNewDueDate(null);
    setNewTags('');
    setExpanded(false);
  };

  const handleAdd = () => {
    if (lineCount === 0 || bulkCreate.isPending) return;
    bulkCreate.mutate({
      note_id: null,
      texts: parsedLines,
      priority: newPriority,
      due_date: newDueDate,
      tags: normalizeTags(newTags.split(',')),
    }, { onSuccess: reset });
  };

  return (
    <section className="border-[1.5px] border-foreground/15 bg-card" aria-label="Captura rápida de tarefas">
      <div className="flex items-start gap-2 p-2.5">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-primary/25 bg-primary/5 text-primary" aria-hidden="true">
          <Plus className="h-4 w-4" weight="bold" />
        </div>
        <label className="sr-only" htmlFor="task-quick-capture">Nova tarefa</label>
        <Textarea
          id="task-quick-capture"
          ref={inputRef}
          value={newText}
          onFocus={() => setExpanded(true)}
          onChange={event => setNewText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              handleAdd();
            }
            if (event.key === 'Escape' && !newText) setExpanded(false);
          }}
          rows={1}
          placeholder="Digite uma tarefa e pressione Enter"
          className="min-h-9 max-h-32 resize-none border-0 bg-transparent px-1 py-2 text-sm leading-5 focus-visible:ring-0"
        />
        <Button
          type="button"
          size="sm"
          className="h-9 shrink-0 gap-1.5"
          onClick={handleAdd}
          disabled={lineCount === 0 || bulkCreate.isPending}
        >
          {bulkCreate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span className="hidden sm:inline">{lineCount > 1 ? `Adicionar ${lineCount}` : 'Adicionar'}</span>
        </Button>
      </div>

      {expanded ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-foreground/10 bg-foreground/[0.015] px-3 py-2">
          <Select value={newPriority} onValueChange={value => setNewPriority(value as NoteTaskPriority)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="alta"><span className="inline-flex items-center gap-1.5"><Circle weight="fill" className="h-2.5 w-2.5 text-destructive" />Alta</span></SelectItem>
              <SelectItem value="media"><span className="inline-flex items-center gap-1.5"><Circle weight="fill" className="h-2.5 w-2.5 text-amber-500" />Média</span></SelectItem>
              <SelectItem value="baixa"><span className="inline-flex items-center gap-1.5"><Circle weight="fill" className="h-2.5 w-2.5 text-muted-foreground" />Baixa</span></SelectItem>
            </SelectContent>
          </Select>
          <DueDatePicker value={newDueDate} onChange={setNewDueDate} compact />
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <TagIcon className="absolute left-2.5 top-2.5 h-3 w-3 text-muted-foreground" aria-hidden="true" />
            <Input
              value={newTags}
              onChange={event => setNewTags(event.target.value)}
              placeholder="tags, separadas, por vírgula"
              aria-label="Tags da nova tarefa"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <span className="text-[11px] text-muted-foreground">
            Enter salva · Shift+Enter quebra linha · <kbd className="font-mono">N</kbd> foca aqui
          </span>
          <div className="flex-1" />
          {lineCount > 1 && <span className="text-xs font-medium tabular-nums">{lineCount} tarefas</span>}
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpanded(false)} aria-label="Recolher detalhes da nova tarefa">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setExpanded(true); inputRef.current?.focus(); }}
          className="flex w-full items-center gap-1.5 border-t border-foreground/10 px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          <Faders className="h-3.5 w-3.5" /> Adicionar prioridade, prazo ou tags
        </button>
      )}
    </section>
  );
}

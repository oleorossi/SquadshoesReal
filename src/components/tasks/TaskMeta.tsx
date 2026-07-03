import { Link } from 'react-router-dom';
import {
  CalendarBlank, Tag as TagIcon, TreeStructure, File as FileIcon, X,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { dueDateInfo, DUE_TONE_CLASS, fromDueDateString, toDueDateString } from '@/lib/taskDates';
import { PRIORITY_COLOR, PRIORITY_LABEL, type NoteTaskWithNote } from '@/hooks/useNoteTasks';

/** Contagem de subtarefas por tarefa-pai. */
export interface SubtaskProgress { total: number; done: number }

/**
 * Linha de metadados da tarefa (badges inline): prioridade, vencimento,
 * tags, progresso de subtarefas e nota vinculada. Usada na lista e no quadro.
 */
export function TaskMetaLine({ task, subtasks, showPriority = true, className }: {
  task: NoteTaskWithNote;
  subtasks?: SubtaskProgress;
  showPriority?: boolean;
  className?: string;
}) {
  const color = PRIORITY_COLOR[task.priority];
  const due = dueDateInfo(task.due_date);
  const linkedNoteTitle = task.notes?.title;

  return (
    <div className={cn('flex items-center gap-2.5 flex-wrap', className)}>
      {showPriority && (
        <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider', color.text)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', color.dot)} />
          {PRIORITY_LABEL[task.priority]}
        </span>
      )}
      {due && (
        <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', DUE_TONE_CLASS[due.tone])}>
          <CalendarBlank className="h-3 w-3" weight={due.tone === 'overdue' ? 'fill' : 'regular'} />
          {due.label}
        </span>
      )}
      {subtasks && subtasks.total > 0 && (
        <span className={cn(
          'inline-flex items-center gap-1 text-[11px] tabular-nums',
          subtasks.done === subtasks.total ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
        )}>
          <TreeStructure className="h-3 w-3" />
          {subtasks.done}/{subtasks.total}
        </span>
      )}
      {(task.tags || []).map(tag => (
        <span key={tag} className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
          <TagIcon className="h-3 w-3" />{tag}
        </span>
      ))}
      {linkedNoteTitle && (
        <Link
          to="/notas"
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <FileIcon className="h-3 w-3" />
          <span className="truncate max-w-[180px]">{linkedNoteTitle}</span>
        </Link>
      )}
    </div>
  );
}

/**
 * Seletor de vencimento — botão que abre Popover com Calendar (pt-BR não
 * necessário no picker, dias numéricos) + atalhos Hoje/Amanhã e limpar.
 */
export function DueDatePicker({ value, onChange, compact }: {
  value: string | null;
  onChange: (due: string | null) => void;
  compact?: boolean;
}) {
  const due = dueDateInfo(value);
  const selected = fromDueDateString(value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-8 gap-1.5 text-xs font-normal justify-start',
            compact ? 'w-auto' : 'w-full',
            due ? DUE_TONE_CLASS[due.tone] : 'text-muted-foreground',
          )}
        >
          <CalendarBlank className="h-3.5 w-3.5" />
          {due ? due.label : 'Vencimento'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex items-center gap-1 p-2 border-b border-border">
          <Button
            type="button" variant="ghost" size="sm" className="h-7 text-xs flex-1"
            onClick={() => onChange(toDueDateString(new Date()))}
          >
            Hoje
          </Button>
          <Button
            type="button" variant="ghost" size="sm" className="h-7 text-xs flex-1"
            onClick={() => {
              const t = new Date(); t.setDate(t.getDate() + 1);
              onChange(toDueDateString(t));
            }}
          >
            Amanhã
          </Button>
          {value && (
            <Button
              type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
              onClick={() => onChange(null)}
              aria-label="Remover vencimento"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => onChange(d ? toDueDateString(d) : null)}
        />
      </PopoverContent>
    </Popover>
  );
}

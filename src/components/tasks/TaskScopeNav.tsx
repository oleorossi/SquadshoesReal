import {
  CalendarBlank, CalendarDots, CheckCircle, ListChecks, Tray, WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { TaskScope, TaskScopeCounts } from '@/lib/taskList';

const SCOPES: Array<{
  value: TaskScope;
  label: string;
  icon: Icon;
  count: keyof Pick<TaskScopeCounts, 'open' | 'today' | 'overdue' | 'upcoming' | 'noDate' | 'done'>;
}> = [
  { value: 'open', label: 'Abertas', icon: ListChecks, count: 'open' },
  { value: 'today', label: 'Hoje', icon: CalendarBlank, count: 'today' },
  { value: 'overdue', label: 'Atrasadas', icon: WarningCircle, count: 'overdue' },
  { value: 'upcoming', label: 'Próximas', icon: CalendarDots, count: 'upcoming' },
  { value: 'no-date', label: 'Sem data', icon: Tray, count: 'noDate' },
  { value: 'done', label: 'Concluídas', icon: CheckCircle, count: 'done' },
];

interface TaskScopeNavProps {
  scope: TaskScope;
  counts: TaskScopeCounts;
  onChange: (scope: TaskScope) => void;
}

export function TaskScopeNav({ scope, counts, onChange }: TaskScopeNavProps) {
  return (
    <aside className="border-[1.5px] border-foreground/15 bg-card md:sticky md:top-4">
      <div className="border-b-[1.5px] border-foreground/15 px-3 py-3">
        <p className="ed-eyebrow text-muted-foreground">Pulso do turno</p>
        <div className="mt-3 grid grid-cols-3 gap-0 divide-x divide-foreground/10">
          <PulseValue value={counts.overdue} label="atrasadas" tone={counts.overdue > 0 ? 'danger' : 'muted'} />
          <PulseValue value={counts.today} label="hoje" tone={counts.today > 0 ? 'today' : 'muted'} />
          <PulseValue value={counts.completedToday} label="feitas hoje" tone="success" />
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto p-1.5 md:flex-col" aria-label="Escopo das tarefas">
        {SCOPES.map(item => {
          const Icon = item.icon;
          const selected = scope === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              aria-current={selected ? 'page' : undefined}
              className={cn(
                'group flex min-h-10 min-w-max items-center gap-2 border-l-2 px-2.5 py-2 text-sm transition-colors md:w-full',
                selected
                  ? 'border-l-primary bg-primary/5 font-semibold text-foreground'
                  : 'border-l-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground',
              )}
            >
              <Icon className={cn('h-4 w-4', selected && 'text-primary')} weight={selected ? 'bold' : 'regular'} />
              <span>{item.label}</span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                {counts[item.count]}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function PulseValue({ value, label, tone }: {
  value: number;
  label: string;
  tone: 'danger' | 'today' | 'success' | 'muted';
}) {
  return (
    <div className="px-2 text-center first:pl-0 last:pr-0">
      <strong className={cn(
        'block font-mono text-lg leading-none tabular-nums',
        tone === 'danger' && 'text-destructive',
        tone === 'today' && 'text-amber-700 dark:text-amber-300',
        tone === 'success' && 'text-green-700 dark:text-green-400',
        tone === 'muted' && 'text-muted-foreground',
      )}>
        {value}
      </strong>
      <span className="mt-1 block text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

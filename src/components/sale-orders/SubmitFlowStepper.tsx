import { Fragment } from 'react';
import { Calendar, Package, Footprints, Activity, ChevronRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SubmitStep = 'min_billing' | 'material' | 'sole' | 'capacity';

const STEPS: { key: SubmitStep; icon: React.ComponentType<any>; label: string }[] = [
  { key: 'min_billing', icon: Calendar,    label: 'Data Mín. Fat.' },
  { key: 'material',    icon: Package,     label: 'Materiais' },
  { key: 'sole',        icon: Footprints,  label: 'Solados' },
  { key: 'capacity',    icon: Activity,    label: 'Capacidade' },
];

export function SubmitFlowStepper({ current }: { current: SubmitStep }) {
  const idx = STEPS.findIndex(s => s.key === current);
  const total = STEPS.length;

  return (
    <div className="mb-3 -mt-1 space-y-1.5">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        Etapa {idx + 1} de {total} · Verificações antes de salvar
      </p>
      <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
        {STEPS.map((s, i) => {
          const isPast = i < idx;
          const isActive = i === idx;
          const Icon = s.icon;
          return (
            <Fragment key={s.key}>
              <div
                className={cn(
                  'flex items-center gap-1 sm:gap-1.5 px-1.5 py-1 rounded text-[10px] font-medium border whitespace-nowrap',
                  isActive  && 'bg-primary text-primary-foreground border-primary',
                  isPast    && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
                  !isActive && !isPast && 'bg-muted text-muted-foreground border-border/50',
                )}
              >
                {isPast ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                <span className="hidden sm:inline">{s.label}</span>
                <span className="sm:hidden">{i + 1}</span>
              </div>
              {i < STEPS.length - 1 && (
                <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

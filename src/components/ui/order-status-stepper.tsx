import { Check, Clock, CheckCircle2, Factory, Truck, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

const STAGES = [
  { key: 'Pendente', label: 'Pendente', icon: Clock },
  { key: 'Aprovado', label: 'Aprovado', icon: CheckCircle2 },
  { key: 'Em Produção', label: 'Em Produção', icon: Factory },
  { key: 'Pronto', label: 'Pronto', icon: Truck },
  { key: 'Faturado', label: 'Faturado', icon: FileText },
] as const;

interface Props {
  currentStatus?: string;
  className?: string;
}

export function OrderStatusStepper({ currentStatus = 'Pendente', className }: Props) {
  const currentIdx = STAGES.findIndex(s => s.key === currentStatus);
  const safeIdx = currentIdx === -1 ? 0 : currentIdx;

  return (
    <div className={cn('flex items-center w-full overflow-x-auto py-2', className)}>
      {STAGES.map((stage, idx) => {
        const Icon = stage.icon;
        const isDone = idx < safeIdx;
        const isActive = idx === safeIdx;
        return (
          <div key={stage.key} className="flex items-center flex-1 min-w-[100px]">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center border-2 transition-colors',
                  isDone && 'bg-primary border-primary text-primary-foreground',
                  isActive && 'bg-primary/10 border-primary text-primary ring-4 ring-primary/15',
                  !isDone && !isActive && 'bg-muted border-muted-foreground/20 text-muted-foreground'
                )}
              >
                {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span
                className={cn(
                  'text-[10px] uppercase font-semibold tracking-wide whitespace-nowrap',
                  isActive && 'text-primary',
                  isDone && 'text-foreground',
                  !isDone && !isActive && 'text-muted-foreground'
                )}
              >
                {stage.label}
              </span>
            </div>
            {idx < STAGES.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-0.5 mx-2 transition-colors',
                  idx < safeIdx ? 'bg-primary' : 'bg-muted-foreground/20'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

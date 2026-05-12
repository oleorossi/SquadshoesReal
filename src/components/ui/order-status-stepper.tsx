import { Check, Clock, CheckCircle as CheckCircle2, Factory, Truck, FileText, FileX } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const STAGES = [
  { key: 'Pendente', label: 'Pendente', icon: Clock },
  { key: 'Aprovado', label: 'Aprovado', icon: CheckCircle2 },
  { key: 'Em Produção', label: 'Em Produção', icon: Factory },
  { key: 'Pronto', label: 'Pronto', icon: Truck },
  { key: 'Faturado', label: 'Faturado', icon: FileText },
] as const;

// Fluxo paralelo pra PVs informais (nfe_required=false): pula Faturado e termina
// em "Finalizado s/ NF". Quando current=Finalizado s/ NF, renderiza um stepper
// próprio que destaca em âmbar.
const INFORMAL_STAGES = [
  { key: 'Pendente', label: 'Pendente', icon: Clock },
  { key: 'Aprovado', label: 'Aprovado', icon: CheckCircle2 },
  { key: 'Em Produção', label: 'Em Produção', icon: Factory },
  { key: 'Finalizado s/ NF', label: 'Sem NF', icon: FileX },
] as const;

interface Props {
  currentStatus?: string;
  className?: string;
}

export function OrderStatusStepper({ currentStatus = 'Pendente', className }: Props) {
  const isInformal = currentStatus === 'Finalizado s/ NF';
  const stages = isInformal ? INFORMAL_STAGES : STAGES;
  const currentIdx = stages.findIndex(s => s.key === currentStatus);
  const safeIdx = currentIdx === -1 ? 0 : currentIdx;

  // Cor do passo ativo: âmbar quando o fluxo é informal.
  const activeBg = isInformal ? 'bg-amber-500/10 border-amber-500 text-amber-700 ring-amber-500/15' : 'bg-primary/10 border-primary text-primary ring-primary/15';
  const doneBg = isInformal ? 'bg-amber-500 border-amber-500 text-white' : 'bg-primary border-primary text-primary-foreground';
  const activeText = isInformal ? 'text-amber-700 dark:text-amber-300' : 'text-primary';
  const lineDone = isInformal ? 'bg-amber-500' : 'bg-primary';

  return (
    <div className={cn('flex items-center w-full overflow-x-auto py-2', className)}>
      {stages.map((stage, idx) => {
        const Icon = stage.icon;
        const isDone = idx < safeIdx;
        const isActive = idx === safeIdx;
        return (
          <div key={stage.key} className="flex items-center flex-1 min-w-[100px]">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center border-2 transition-colors',
                  isDone && doneBg,
                  isActive && cn(activeBg, 'ring-4'),
                  !isDone && !isActive && 'bg-muted border-muted-foreground/20 text-muted-foreground'
                )}
              >
                {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span
                className={cn(
                  'text-[10px] uppercase font-semibold tracking-wide whitespace-nowrap',
                  isActive && activeText,
                  isDone && 'text-foreground',
                  !isDone && !isActive && 'text-muted-foreground'
                )}
              >
                {stage.label}
              </span>
            </div>
            {idx < stages.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-0.5 mx-2 transition-colors',
                  idx < safeIdx ? lineDone : 'bg-muted-foreground/20'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

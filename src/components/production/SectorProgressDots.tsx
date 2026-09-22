import { cn } from '@/lib/utils';

interface SectorProgressDotsProps {
  completed: number;
  inProgress?: number;
  total: number;
  className?: string;
}

/**
 * Mini-barra de progresso de setores (Ordens / lista de PVs).
 * Cada dot = um setor; verde = concluído, amarelo = em andamento, cinza = pendente.
 */
export function SectorProgressDots({
  completed,
  inProgress = 0,
  total,
  className,
}: SectorProgressDotsProps) {
  if (total === 0) return null;
  const pct = Math.round((completed / total) * 100);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={`${completed} de ${total} setores concluídos (${pct}%)`}
    >
      <span className="inline-flex gap-0.5">
        {Array.from({ length: total }).map((_, i) => {
          const isDone = i < completed;
          const isActive = !isDone && i < completed + inProgress;
          return (
            <span
              key={i}
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full transition-colors',
                isDone && 'bg-success',
                isActive && 'bg-warning ring-1 ring-warning/30',
                !isDone && !isActive && 'bg-muted-foreground/25',
              )}
            />
          );
        })}
      </span>
      <span className="text-xs font-mono text-muted-foreground tabular-nums">
        {completed}/{total}
      </span>
    </span>
  );
}

import { ArrowRight } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface StrapIdentityTrailProps {
  typeName?: string | null;
  measureName?: string | null;
  baseName?: string | null;
  colorName?: string | null;
  compact?: boolean;
  className?: string;
}

const STEPS = [
  { key: 'type', label: 'Família' },
  { key: 'measure', label: 'Medida' },
  { key: 'base', label: 'Napa-base' },
  { key: 'color', label: 'Cor' },
] as const;

export function StrapIdentityTrail({
  typeName,
  measureName,
  baseName,
  colorName,
  compact = false,
  className,
}: StrapIdentityTrailProps) {
  const values = {
    type: typeName,
    measure: measureName,
    base: baseName,
    color: colorName,
  };

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-2 sm:flex sm:items-stretch sm:gap-1.5',
        className,
      )}
      aria-label="Identidade da tira: família, medida, napa-base e cor"
    >
      {STEPS.map((step, index) => (
        <div key={step.key} className="contents sm:flex sm:min-w-0 sm:flex-1 sm:items-center sm:gap-1.5">
          <div
            className={cn(
              'min-w-0 rounded-md border border-border bg-card',
              compact ? 'px-2.5 py-2' : 'px-3 py-2.5',
            )}
          >
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              {step.label}
            </p>
            <p className={cn('truncate font-semibold text-foreground', compact ? 'text-xs' : 'text-sm')}>
              {values[step.key] || 'A definir'}
            </p>
          </div>
          {index < STEPS.length - 1 && (
            <ArrowRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/60 sm:block" aria-hidden />
          )}
        </div>
      ))}
    </div>
  );
}

import { Factory, Stack as Layers, Rows, Palette } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { sectorLabel } from '@/lib/categoryFromGroup';

interface MaterialClassificationRailProps {
  sector?: string | null;
  family?: string | null;
  group?: string | null;
  variant?: string | null;
  className?: string;
  compact?: boolean;
}

/**
 * Trilha visual única da classificação do material. Ela reaparece no editor do
 * grupo e no item individual para que Setor, Família, Grupo e Variante nunca
 * pareçam sinônimos.
 */
export function MaterialClassificationRail({
  sector,
  family,
  group,
  variant,
  className,
  compact = false,
}: MaterialClassificationRailProps) {
  const steps = [
    { label: 'Setor / aplicação', value: sectorLabel(sector), icon: Factory, missing: !sector },
    { label: 'Família técnica', value: family || 'Sem família', icon: Layers, missing: !family },
    { label: 'Grupo / linha', value: group || '—', icon: Rows, missing: !group },
    ...(variant !== undefined
      ? [{ label: 'Item / variante', value: variant || 'Sem cor', icon: Palette, missing: !variant }]
      : []),
  ];

  return (
    <nav
      aria-label="Classificação industrial do material"
      className={cn('border-y border-foreground/15 bg-muted/20', compact ? 'px-3 py-2' : 'px-3 py-3 sm:px-4', className)}
    >
      <p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-primary">
        Rota do material
      </p>
      <ol className={cn('grid gap-2', steps.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.label} className="relative min-w-0">
              <div className={cn(
                'flex min-h-12 items-center gap-2.5 border-l-2 bg-background px-3 py-2',
                step.missing ? 'border-foreground/20 text-muted-foreground' : 'border-primary text-foreground',
              )}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-foreground/15 bg-muted/30">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                    {index + 1}. {step.label}
                  </span>
                  <span className={cn('mt-0.5 block truncate text-xs font-semibold', step.missing && 'font-normal')}>
                    {step.value}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

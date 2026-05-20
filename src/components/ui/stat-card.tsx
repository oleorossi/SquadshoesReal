/**
 * StatCard — card de métrica do design system "Novidade Editorial".
 *
 * Substitui o padrão antigo `<Card><p className="text-2xl font-bold">`.
 * Visual editorial: rule preta no topo, eyebrow ALL-CAPS, número em
 * JetBrains Mono tabular, delta opcional com tom semântico.
 *
 * Chrome 100% via design tokens (bg-card, border-border, text-foreground,
 * text-muted-foreground). `tone` colore só o número.
 */
import { ReactNode, ComponentType } from 'react';
import { TrendUp, TrendDown } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'primary' | 'success' | 'warning' | 'destructive';

interface StatCardProps {
  /** Eyebrow ALL-CAPS (ex: "Faturamento Total"). */
  label: string;
  /** Valor principal — renderiza em mono tabular. */
  value: ReactNode;
  /** Sufixo curto ao lado do valor (ex: "pares", "%"). */
  unit?: string;
  /** Legenda curta abaixo do valor (ex: "limite agregado"). */
  hint?: string;
  /** Variação (ex: "+8%"). */
  delta?: string;
  /** Tom do delta — controla cor + ícone de seta. */
  deltaTone?: 'up' | 'down' | 'neutral';
  /** Texto após o delta (ex: "vs ontem"). */
  deltaLabel?: string;
  /** Ícone Phosphor opcional, canto superior direito. */
  icon?: ComponentType<{ className?: string }>;
  /** Colore o número principal. */
  tone?: Tone;
  /** Torna o card clicável. */
  onClick?: () => void;
  className?: string;
}

const TONE_VALUE: Record<Tone, string> = {
  default: 'text-foreground',
  primary: 'text-primary',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  destructive: 'text-destructive',
};

export function StatCard({
  label, value, unit, hint, delta, deltaTone = 'neutral', deltaLabel,
  icon: Icon, tone = 'default', onClick, className,
}: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative bg-card border border-border rounded-lg overflow-hidden',
        'transition-all duration-200',
        onClick && 'cursor-pointer hover:border-foreground/40 hover:-translate-y-0.5',
        className,
      )}
    >
      {/* rule editorial no topo */}
      <div className="h-[2px] bg-foreground" aria-hidden="true" />
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <span className="eyebrow truncate">{label}</span>
          {Icon && (
            <span className="shrink-0 h-7 w-7 -mt-0.5 flex items-center justify-center bg-muted text-muted-foreground rounded-md">
              <Icon className="h-4 w-4" />
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className={cn('mono text-3xl font-bold leading-none', TONE_VALUE[tone])}>
            {value}
          </span>
          {unit && <span className="text-xs text-muted-foreground font-medium">{unit}</span>}
        </div>
        {(delta || hint) && (
          <div className="flex items-center gap-2 text-xs">
            {delta && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 font-semibold',
                  deltaTone === 'up' && 'text-emerald-600',
                  deltaTone === 'down' && 'text-destructive',
                  deltaTone === 'neutral' && 'text-muted-foreground',
                )}
              >
                {deltaTone === 'up' && <TrendUp className="h-3 w-3" />}
                {deltaTone === 'down' && <TrendDown className="h-3 w-3" />}
                {delta}
                {deltaLabel && <span className="text-muted-foreground font-normal ml-0.5">{deltaLabel}</span>}
              </span>
            )}
            {hint && <span className="text-muted-foreground truncate ml-auto">{hint}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * StatGrid — wrapper de KPIs. Usa o grid fluido `.grid-kpi-fluid`
 * (auto-fit minmax 140px) definido no index.css.
 */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid-kpi-fluid', className)}>{children}</div>;
}

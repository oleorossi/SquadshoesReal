/**
 * StatCard — card de métrica do design system "Novidade Editorial".
 *
 * Visual editorial: rule preta no topo, eyebrow ALL-CAPS, número em ANTON via
 * <StatNumber> (proporção CENTRALIZADA e adaptativa — não trunca), ícone em
 * caixa 32px, delta opcional com tom semântico.
 *
 * Chrome 100% via design tokens. `tone` colore só o número.
 */
import { ReactNode, ComponentType } from 'react';
import { TrendUp, TrendDown } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { StatNumber, type StatTone } from './stat-number';

interface StatCardProps {
  /** Eyebrow ALL-CAPS (ex: "Faturamento Total"). */
  label: string;
  /** Valor principal. */
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
  tone?: StatTone;
  /** Torna o card clicável. */
  onClick?: () => void;
  className?: string;
}

export function StatCard({
  label, value, unit, hint, delta, deltaTone = 'neutral', deltaLabel,
  icon: Icon, tone = 'default', onClick, className,
}: StatCardProps) {
  return (
    <div
      onClick={onClick}
      // Acessibilidade: quando clicável, o card vira botão de verdade pra
      // teclado/leitor de tela (Enter/Espaço ativam, foco visível via ring).
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      className={cn(
        'group relative bg-card border border-border rounded-lg overflow-hidden',
        'transition-all duration-200',
        onClick && 'cursor-pointer hover:border-foreground/40 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      {/* rule editorial no topo */}
      <div className="h-[2px] bg-foreground" aria-hidden="true" />
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <span className="eyebrow leading-snug break-words min-w-0" title={label}>{label}</span>
          {Icon && (
            <span className="shrink-0 h-8 w-8 -mt-0.5 flex items-center justify-center bg-muted text-muted-foreground rounded-lg">
              <Icon className="h-4 w-4" />
            </span>
          )}
        </div>
        <StatNumber value={value} unit={unit} tone={tone} />
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

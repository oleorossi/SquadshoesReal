/**
 * StatCard — card de métrica do design system "Novidade Editorial".
 *
 * Substitui o padrão antigo `<Card><p className="text-2xl font-bold">`.
 * Visual editorial: rule preta no topo, eyebrow ALL-CAPS, número em
 * ANTON (display condensed — identidade Industrial Editorial Pro), delta
 * opcional com tom semântico.
 *
 * Chrome 100% via design tokens (bg-card, border-border, text-foreground,
 * text-muted-foreground). `tone` colore só o número.
 */
import { ReactNode, ComponentType, useLayoutEffect, useRef, useState } from 'react';
import { TrendUp, TrendDown } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { adaptiveNumberFontSize } from '@/lib/adaptiveFontSize';

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
  // Número em Anton que ENCOLHE pra caber (sem truncar) — diretriz adaptiveFontSize
  // do sistema: KPI de largura fixa + valor dinâmico (ex.: R$ 1.234.567,89). Valor
  // curto fica grandão (38px); valor longo reduz até caber, sempre completo.
  const rowRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(38);
  const valueStr = typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  useLayoutEffect(() => {
    if (valueStr == null) { setFontPx(38); return; }
    const el = rowRef.current;
    if (!el) return;
    const calc = () => setFontPx(adaptiveNumberFontSize(valueStr, {
      maxWidthPx: Math.max(56, el.clientWidth - (unit ? 32 : 2)), baseFontPx: 38, minFontPx: 18,
    }));
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [valueStr, unit]);
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
          <span className="eyebrow leading-snug break-words min-w-0" title={label}>{label}</span>
          {Icon && (
            <span className="shrink-0 h-7 w-7 -mt-0.5 flex items-center justify-center bg-muted text-muted-foreground rounded-md">
              <Icon className="h-4 w-4" />
            </span>
          )}
        </div>
        <div ref={rowRef} className="flex items-baseline gap-1.5 min-w-0">
          <span
            className={cn('font-display leading-[0.9] tracking-tight tabular-nums truncate', TONE_VALUE[tone])}
            style={{ fontSize: fontPx }}
            title={typeof value === 'string' ? value : undefined}
          >
            {value}
          </span>
          {unit && <span className="text-sm text-muted-foreground font-semibold shrink-0 mb-0.5">{unit}</span>}
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

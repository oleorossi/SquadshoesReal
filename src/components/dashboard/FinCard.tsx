import { Icon as LucideIcon, ArrowUpRight, ArrowDownRight, Minus } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface FinCardProps {
  label: string;
  value: string;
  sub?: string;
  subColor?: 'up' | 'down' | 'warning' | 'muted';
  subIcon?: LucideIcon;
  highlight?: boolean;
  trendIcon?: LucideIcon;
}

const SUB_COLORS = {
  up:      'text-green-600',
  down:    'text-destructive',
  warning: 'text-amber-600',
  muted:   'text-muted-foreground',
};

const TREND_ICONS = {
  up:      ArrowUpRight,
  down:    ArrowDownRight,
  warning: Minus,
  muted:   Minus,
};

export function FinCard({
  label, value, sub, subColor = 'muted', subIcon: SubIcon, highlight, trendIcon: TrendIcon,
}: FinCardProps) {
  const subCls = SUB_COLORS[subColor];
  const DefaultTrend = TREND_ICONS[subColor];

  if (highlight) {
    return (
      <div className={cn(
        'relative rounded-xl border border-primary/30 overflow-hidden select-none',
        'shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200',
      )}>
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary to-primary/80" />
        <div className="relative px-4 py-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-primary-foreground/70">
              {label}
            </span>
            {TrendIcon && <TrendIcon className="w-3.5 h-3.5 text-primary-foreground/60" />}
          </div>
          <div className="text-[24px] font-extrabold font-mono leading-none tracking-tight tabular-nums text-primary-foreground">
            {value}
          </div>
          {sub && (
            <div className="text-[11px] font-medium text-primary-foreground/60">{sub}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'bg-card border border-border rounded-xl overflow-hidden select-none',
      'shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200',
    )}>
      <div className="px-4 py-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </span>
          {TrendIcon && <TrendIcon className={cn('w-3.5 h-3.5', subCls)} />}
        </div>
        <div className="text-[24px] font-extrabold font-mono leading-none tracking-tight tabular-nums text-foreground">
          {value}
        </div>
        {sub && (
          <div className={cn('flex items-center gap-1 text-[11px] font-medium', subCls)}>
            {SubIcon ? <SubIcon className="w-3 h-3 shrink-0" /> : <DefaultTrend className="w-3 h-3 shrink-0" />}
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

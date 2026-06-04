import { Icon as LucideIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { StatNumber } from '@/components/ui/stat-number';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  subtitle?: string;
  variant?: 'default' | 'warning' | 'success' | 'destructive';
}

const variantStyles = {
  default: 'border-border',
  warning: 'border-warning/30 bg-warning/5',
  success: 'border-success/30 bg-success/5',
  destructive: 'border-destructive/30 bg-destructive/5',
};

const iconVariantStyles = {
  default: 'bg-primary/10 text-primary',
  warning: 'bg-warning/15 text-warning',
  success: 'bg-success/15 text-success',
  destructive: 'bg-destructive/15 text-destructive',
};

export function StatsCard({ title, value, icon: Icon, subtitle, variant = 'default' }: StatsCardProps) {
  return (
    <div className={cn(
      'rounded-lg border bg-card p-5 transition-all duration-200 hover:shadow-card-hover',
      variantStyles[variant]
    )}
    style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <p className="eyebrow leading-snug break-words" title={title}>{title}</p>
          <StatNumber value={value} />
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className={cn('shrink-0 h-8 w-8 rounded-lg flex items-center justify-center', iconVariantStyles[variant])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

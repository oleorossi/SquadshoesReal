import { Icon as LucideIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { StatNumber } from './stat-number';

interface StatusCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  type?: 'success' | 'danger' | 'warning' | 'info';
}

const typeStyles = {
  success: 'border-success/20 bg-success/5 text-success',
  danger: 'border-destructive/20 bg-destructive/5 text-destructive',
  warning: 'border-warning/20 bg-warning/5 text-warning',
  info: 'border-primary/20 bg-primary/5 text-primary',
};

export function StatusCard({ title, value, icon: Icon, trend, type = 'info' }: StatusCardProps) {
  return (
    <div className={cn(
      'p-5 rounded-2xl border shadow-sm transition-all hover:shadow-md',
      typeStyles[type]
    )}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">{title}</p>
          <div className="mt-1"><StatNumber value={value} className="text-current" /></div>
        </div>
        <div className="shrink-0 h-8 w-8 rounded-lg bg-background/50 backdrop-blur-sm flex items-center justify-center">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {trend && (
        <p className="mt-3 text-xs font-bold flex items-center gap-1">
          <span className="bg-background/40 px-1.5 py-0.5 rounded-full">{trend}</span>
        </p>
      )}
    </div>
  );
}

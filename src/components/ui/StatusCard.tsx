import { Icon as LucideIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

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
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{title}</p>
          <h3 className="text-2xl font-black mt-1 font-mono tracking-tighter">{value}</h3>
        </div>
        <div className="p-2 bg-background/50 rounded-lg backdrop-blur-sm">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {trend && (
        <p className="mt-3 text-[10px] font-bold flex items-center gap-1">
          <span className="bg-background/40 px-1.5 py-0.5 rounded-full">{trend}</span>
        </p>
      )}
    </div>
  );
}

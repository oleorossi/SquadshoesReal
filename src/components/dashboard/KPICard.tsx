import { cn } from '@/lib/utils';
import { ArrowUpRight, ArrowDownRight } from '@phosphor-icons/react';
import { useState } from 'react';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: string;
  variant?: 'default' | 'warning' | 'success' | 'destructive';
  onClick?: () => void;
}

const variantConfig: Record<string, {
  border: string;
  iconBg: string;
  iconColor: string;
  valueColor: string;
}> = {
  default:     { border: 'border-t-border',         iconBg: 'bg-muted',              iconColor: 'text-muted-foreground', valueColor: 'text-foreground' },
  success:     { border: 'border-t-green-500',       iconBg: 'bg-green-500/10',       iconColor: 'text-green-600',        valueColor: 'text-foreground' },
  warning:     { border: 'border-t-amber-500',       iconBg: 'bg-amber-500/10',       iconColor: 'text-amber-600',        valueColor: 'text-amber-600' },
  destructive: { border: 'border-t-destructive',     iconBg: 'bg-destructive/10',     iconColor: 'text-destructive',      valueColor: 'text-destructive' },
};

 export function KPICard({
   title, label, value, subtitle, sub, icon: Icon, trend, trendLabel, status, variant = 'default', onClick,
 }: any) {
   // Normalizing props between KPICard and KpiCard
   const displayTitle = title || label;
   const displaySubtitle = subtitle || sub;
   
   // Map status to variant if needed
   let activeVariant = variant;
   if (status === 'good') activeVariant = 'success';
   if (status === 'danger') activeVariant = 'destructive';
   if (status === 'warning') activeVariant = 'warning';
   if (status === 'info') activeVariant = 'default';
 
   const cfg = variantConfig[activeVariant] ?? variantConfig.default;

  const [hov, setHov] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className={cn(
        'bg-card p-4 rounded-xl border border-border flex flex-col gap-3 slash-top',
        'transition-all duration-300 cursor-pointer select-none relative overflow-hidden group',
        hov ? 'shadow-card-hover -translate-y-1' : 'shadow-card'
      )}
    >
      {activeVariant !== 'default' && (
        <div className={cn(
          "absolute top-0 left-0 w-full h-1 transition-colors",
          activeVariant === 'success' ? "bg-success" :
          activeVariant === 'warning' ? "bg-warning" :
          activeVariant === 'destructive' ? "bg-destructive" : "bg-primary"
        )} />
      )}
      {/* Label + Icon */}
      <div className="flex items-start justify-between gap-2">
         <span className="eyebrow leading-snug pr-1 break-words" title={displayTitle}>{displayTitle}</span>
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110',
          cfg.iconBg, cfg.iconColor
        )}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      {/* Value — Anton (display) com tabular-nums, escala editorial */}
      <div className={cn('display text-[34px] tabular-nums', cfg.valueColor)}>
        {value}
      </div>

       {/* Subtitle / trend */}
       {(displaySubtitle || trendLabel) && (
         <div className="flex items-center gap-1">
           {trend === 'up'   && <ArrowUpRight   className="h-3 w-3 text-green-500 shrink-0" />}
           {trend === 'down' && <ArrowDownRight  className="h-3 w-3 text-destructive shrink-0" />}
           <span className="text-xs text-muted-foreground truncate">
             {trendLabel || displaySubtitle}
           </span>
         </div>
       )}
    </div>
  );
}

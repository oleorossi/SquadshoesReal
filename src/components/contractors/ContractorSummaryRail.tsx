import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type MetricTone = 'default' | 'success' | 'warning' | 'destructive';

interface RailMetric {
  label: string;
  value: ReactNode;
  hint: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: MetricTone;
  onClick?: () => void;
}

interface ContractorSummaryRailProps {
  lead: RailMetric & { progress?: number; meta?: ReactNode };
  metrics: [RailMetric, RailMetric, RailMetric, RailMetric];
  ariaLabel: string;
}

const toneClass: Record<MetricTone, string> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
};

function MetricCell({ metric }: { metric: RailMetric }) {
  const Icon = metric.icon;
  const interactive = !!metric.onClick;
  const className = cn(
    'flex min-h-28 min-w-0 flex-col justify-between border-t border-border p-4 text-left xl:border-l xl:border-t-0',
    interactive && 'transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
  );
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{metric.label}</span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="mt-4">
        <p className={cn('ed-display text-3xl leading-none tabular-nums', toneClass[metric.tone || 'default'])}>{metric.value}</p>
        <p className="mt-2 text-xs text-muted-foreground">{metric.hint}</p>
      </div>
    </>
  );

  if (interactive) return <button type="button" onClick={metric.onClick} className={className}>{content}</button>;
  return <div className={className}>{content}</div>;
}

/**
 * Faixa de leitura rápida compartilhada pelas cinco áreas de Terceirizados.
 * O primeiro bloco é a tese da aba; os quatro seguintes detalham o fluxo.
 */
export function ContractorSummaryRail({ lead, metrics, ariaLabel }: ContractorSummaryRailProps) {
  const LeadIcon = lead.icon;
  const leadInteractive = !!lead.onClick;
  const progress = Math.min(100, Math.max(0, lead.progress ?? 0));
  const leadClassName = cn(
    'col-span-2 flex min-h-36 flex-col justify-between bg-foreground p-5 text-left text-background xl:col-span-1',
    leadInteractive && 'transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-background',
  );
  const leadContent = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-background/65">{lead.label}</span>
        {LeadIcon && <LeadIcon className="h-5 w-5 text-background/70" />}
      </div>
      <div className="mt-5 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="ed-display text-5xl leading-none tabular-nums">{lead.value}</p>
          <p className="mt-2 text-xs text-background/70">{lead.hint}</p>
        </div>
        {lead.meta && <span className="max-w-[11rem] text-right font-mono text-[11px] leading-relaxed text-background/75">{lead.meta}</span>}
      </div>
      {lead.progress !== undefined && (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-background/20" aria-label={`${Math.round(progress)}%`}>
          <div className="h-full rounded-full bg-background" style={{ width: `${progress}%` }} />
        </div>
      )}
    </>
  );

  return (
    <section aria-label={ariaLabel} className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-2 xl:grid-cols-[1.35fr_repeat(4,minmax(0,1fr))]">
        {leadInteractive
          ? <button type="button" onClick={lead.onClick} className={leadClassName}>{leadContent}</button>
          : <div className={leadClassName}>{leadContent}</div>}
        {metrics.map((metric) => <MetricCell key={metric.label} metric={metric} />)}
      </div>
    </section>
  );
}

import { cn } from '@/lib/utils';

interface SalesOperationsRailProps {
  scopeLabel: string;
  orderCount: number;
  pairs: number;
  drafts: number;
  approved: number;
  inProduction: number;
  deadlineRisk: number;
  total?: string;
  className?: string;
}

interface MetricProps {
  label: string;
  value: string | number;
  note: string;
  tone?: 'default' | 'warning' | 'critical' | 'production';
}

function Metric({ label, value, note, tone = 'default' }: MetricProps) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <dt className="eyebrow truncate">{label}</dt>
      <dd className={cn(
        'mt-1 truncate font-mono text-xl font-bold leading-none tabular-nums sm:text-2xl',
        tone === 'warning' && 'text-amber-700 dark:text-amber-400',
        tone === 'critical' && 'text-destructive',
        tone === 'production' && 'text-blue-700 dark:text-blue-300',
      )} title={String(value)}>
        {value}
      </dd>
      <dd className="mt-1 truncate text-[10px] text-muted-foreground">{note}</dd>
    </div>
  );
}

/**
 * Régua operacional dos pedidos visíveis. Substitui os cards independentes:
 * quantidade, volume, fila e risco pertencem ao mesmo lote de trabalho.
 */
export default function SalesOperationsRail({
  scopeLabel,
  orderCount,
  pairs,
  drafts,
  approved,
  inProduction,
  deadlineRisk,
  total,
  className,
}: SalesOperationsRailProps) {
  const other = Math.max(0, orderCount - drafts - approved - inProduction);
  const segments = [
    { key: 'drafts', value: drafts, className: 'bg-amber-500', label: 'Rascunhos' },
    { key: 'approved', value: approved, className: 'bg-emerald-500', label: 'Aprovados' },
    { key: 'production', value: inProduction, className: 'bg-blue-500', label: 'Em produção' },
    { key: 'other', value: other, className: 'bg-muted-foreground/35', label: 'Outros status' },
  ].filter((segment) => segment.value > 0);

  return (
    <section
      className={cn('overflow-hidden rounded-lg border border-border bg-card shadow-sm', className)}
      aria-label={`Carga operacional: ${scopeLabel}`}
    >
      <div className="grid lg:grid-cols-[minmax(13rem,1.15fr)_minmax(0,4fr)]">
        <div className="flex min-h-24 items-end justify-between gap-4 bg-foreground px-4 py-3 text-background sm:px-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-background/55">{scopeLabel}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-4xl leading-none tabular-nums sm:text-5xl">{orderCount}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-background/65">pedidos</span>
            </p>
          </div>
          <p className="pb-1 text-right font-mono text-xs text-background/65">
            {pairs.toLocaleString('pt-BR')}<br />pares
          </p>
        </div>

        <dl className={cn(
          'grid grid-cols-2 divide-x divide-y divide-border lg:col-start-2 lg:row-start-1 lg:divide-y-0',
          total ? 'sm:grid-cols-5' : 'sm:grid-cols-4',
        )}>
          <Metric label="Rascunhos" value={drafts} note="aguardando liberação" tone="warning" />
          <Metric label="Aprovados" value={approved} note="prontos para produzir" />
          <Metric label="Em produção" value={inProduction} note="no chão de fábrica" tone="production" />
          <Metric
            label="Prazo crítico"
            value={deadlineRisk}
            note={deadlineRisk === 1 ? 'pedido exige decisão' : 'pedidos exigem decisão'}
            tone={deadlineRisk > 0 ? 'critical' : 'default'}
          />
          {total && <Metric label="Valor visível" value={total} note="na seleção atual" />}
        </dl>
      </div>

      <div className="flex h-1.5 w-full bg-muted" aria-hidden="true">
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={segment.className}
            style={{ flexGrow: segment.value, flexBasis: 0 }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-4 py-1.5 text-[10px] text-muted-foreground">
        {segments.map((segment) => (
          <span key={segment.key} className="inline-flex items-center gap-1.5">
            <span className={cn('h-1.5 w-3', segment.className)} aria-hidden="true" />
            {segment.label} <strong className="font-mono text-foreground">{segment.value}</strong>
          </span>
        ))}
        <span className="ml-auto hidden font-mono uppercase tracking-wider sm:inline">régua da carga visível</span>
      </div>
    </section>
  );
}

export function SalesOperationsRailSkeleton() {
  return (
    <div className="h-[7.75rem] animate-pulse overflow-hidden rounded-lg border bg-muted/40" aria-label="Carregando resumo dos pedidos">
      <div className="h-full w-1/4 bg-muted" />
    </div>
  );
}

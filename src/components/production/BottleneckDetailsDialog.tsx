import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Warning as AlertTriangle, Pulse as Activity, ArrowRight, Gauge, Hash } from '@phosphor-icons/react';
import type { BottleneckInfo } from '@/lib/sectorBottleneck';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderNumber?: string;
  referenceName?: string;
  bottleneck: BottleneckInfo | null;
}

const SEVERITY_STYLES = {
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  warning: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30',
  critical: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
} as const;

const SEVERITY_LABEL = {
  ok: 'No prazo',
  warning: 'Atenção',
  critical: 'Crítico',
} as const;

function StatRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-mono font-semibold ${
          highlight ? 'text-primary' : 'text-foreground'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function BottleneckDetailsDialog({
  open,
  onOpenChange,
  orderNumber,
  referenceName,
  bottleneck,
}: Props) {
  if (!bottleneck) return null;
  const next = bottleneck.nextStage;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Análise de gargalo
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-xs">
            {orderNumber && (
              <span className="font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                <Hash className="h-3 w-3" />
                {orderNumber}
              </span>
            )}
            {referenceName && <span className="truncate">{referenceName}</span>}
          </DialogDescription>
        </DialogHeader>

        {/* SETOR ATUAL */}
        <section className={`rounded-lg border p-3 ${SEVERITY_STYLES[bottleneck.severity]}`}>
          <header className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wide font-bold">Setor atual</span>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-background/60">
              {SEVERITY_LABEL[bottleneck.severity]}
            </span>
          </header>
          {bottleneck.capacityPerDay > 0 ? (
            <div className="space-y-0.5">
              <StatRow label="Dias decorridos" value={`${bottleneck.elapsedDays}d úteis`} />
              <StatRow
                label="Dias esperados"
                value={`${bottleneck.expectedDays}d úteis`}
                highlight
              />
              <StatRow
                label="Atraso"
                value={
                  bottleneck.daysOver > 0
                    ? `+${bottleneck.daysOver}d`
                    : 'Dentro do prazo'
                }
              />
              <StatRow
                label="Capacidade do setor"
                value={`${bottleneck.capacityPerDay} pares/dia`}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Setor sem capacidade configurada na ficha técnica.
            </p>
          )}
        </section>

        {/* PRÓXIMO SETOR — estimativa por fila */}
        {next && (
          <section className={`rounded-lg border p-3 ${SEVERITY_STYLES[next.severity]}`}>
            <header className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ArrowRight className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wide font-bold">
                  Próximo: {next.sectorName}
                </span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-background/60">
                {SEVERITY_LABEL[next.severity]}
              </span>
            </header>
            <div className="space-y-0.5">
              <StatRow label="Pares na fila" value={`${next.queuedPairs}p`} />
              <StatRow
                label="Dias para iniciar"
                value={`~${next.queueDays}d úteis`}
                highlight
              />
              <StatRow
                label="Tempo da própria OP"
                value={`${next.ownProcessingDays}d (${next.ownPairs}p)`}
              />
              <StatRow
                label="Capacidade do setor"
                value={`${next.capacityPerDay} pares/dia`}
              />
            </div>
          </section>
        )}

        {!next && (
          <p className="text-xs text-muted-foreground italic flex items-center gap-1.5 px-1">
            <Gauge className="h-3 w-3" />
            Esta é a última etapa do fluxo desta OP.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
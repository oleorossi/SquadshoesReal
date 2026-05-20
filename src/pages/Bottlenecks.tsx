import { useState, useMemo } from 'react';
import {
  Warning as AlertTriangle, Pen, Hand, Scissors, Stack as Layers,
  Calendar, Buildings, Package as Boxes,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import {
  useSectorBottlenecks, useActiveBottlenecks, SECTOR_LABEL, SectorKey,
  type SectorBottleneck,
} from '@/hooks/useSectorBottlenecks';
import { BulkAssignServiceOrderDialog } from '@/components/bottlenecks/BulkAssignServiceOrderDialog';
import { cn } from '@/lib/utils';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

const SECTOR_ICON: Record<SectorKey, React.ElementType> = {
  costura: Pen,
  mesa: Hand,
  corte_palmilha: Scissors,
  corte_forracao: Layers,
};

const SEVERITY_STYLE = {
  critical: {
    badge: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400',
    border: 'border-l-red-500',
    icon: 'text-red-600',
  },
  warning: {
    badge: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
    border: 'border-l-amber-500',
    icon: 'text-amber-600',
  },
  ok: {
    badge: 'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400',
    border: 'border-l-green-500',
    icon: 'text-green-600',
  },
} as const;

function formatWeekLabel(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const fmt = (x: Date) => x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${fmt(d)} – ${fmt(end)}`;
}

export default function BottlenecksPage() {
  const { data: all = [], isLoading } = useSectorBottlenecks();
  const { data: active = [] } = useActiveBottlenecks();

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBottleneck, setBulkBottleneck] = useState<SectorBottleneck | null>(null);

  const openBulkDialog = (b: SectorBottleneck) => {
    setBulkBottleneck(b);
    setBulkOpen(true);
  };

  // KPI da página: gargalos críticos vs warnings
  const summary = useMemo(() => ({
    critical: active.filter(b => b.severity === 'critical').length,
    warning: active.filter(b => b.severity === 'warning').length,
    totalOps: active.reduce((sum, b) => sum + b.ops_count, 0),
    totalPairs: active.reduce((sum, b) => sum + b.total_pairs_planned, 0),
  }), [active]);

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground text-sm">Calculando gargalos...</div>;
  }

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · GARGALOS"
        title="Monitoramento de Gargalos"
        description={'Setores que estão sobrecarregados em alguma semana. Use o botão "Gerar OS" para transferir OPs específicas pra uma costureira terceirizada antes que atrase a Montagem.'}
      />

      {/* KPI cards */}
      <StatGrid>
        <StatCard
          label="Críticos"
          value={summary.critical}
          icon={AlertTriangle}
          tone={summary.critical > 0 ? 'destructive' : 'default'}
          hint="utilização ≥ 150%"
        />
        <StatCard
          label="Atenção"
          value={summary.warning}
          icon={AlertTriangle}
          tone={summary.warning > 0 ? 'warning' : 'default'}
          hint="utilização 100–149%"
        />
        <StatCard
          label="OPs em gargalo"
          value={summary.totalOps}
          icon={Boxes}
          hint="total agregado"
        />
        <StatCard
          label="Pares planejados"
          value={summary.totalPairs.toLocaleString('pt-BR')}
          icon={Boxes}
          hint="nas semanas com gargalo"
        />
      </StatGrid>

      {/* Lista de gargalos ativos */}
      {active.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Nenhum gargalo detectado"
          description="As semanas próximas estão dentro da capacidade dos setores monitorados."
        />
      ) : (
        <div className="space-y-4">
          {active.map(b => {
            const Icon = SECTOR_ICON[b.sector];
            const style = SEVERITY_STYLE[b.severity];
            return (
              <Panel
                key={`${b.sector}-${b.week_start}`}
                className={cn('border-l-4', style.border)}
                title={
                  <span className="flex items-center gap-3">
                    <span className="bg-muted p-2 rounded-lg">
                      <Icon className={cn('h-5 w-5', style.icon)} />
                    </span>
                    <span>{SECTOR_LABEL[b.sector]} · Semana {formatWeekLabel(b.week_start)}</span>
                  </span>
                }
                subtitle={
                  `${b.ops_count} OPs acumuladas · ${b.total_pairs_planned.toLocaleString('pt-BR')} pares planejados · capacidade total da semana: ${b.total_capacity_week.toLocaleString('pt-BR')} pares`
                }
                actions={
                  <>
                    <Badge variant="outline" className={cn(style.badge, 'text-xs')}>
                      {b.utilization_pct}% utilizado
                    </Badge>
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs gap-1"
                      onClick={() => openBulkDialog(b)}
                    >
                      <Buildings className="h-3 w-3" />
                      Encaminhar todas
                    </Button>
                  </>
                }
              >
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                        <TableHead>OP</TableHead>
                        <TableHead>Modelo / Cor</TableHead>
                        <TableHead className="text-right">Pares</TableHead>
                        <TableHead className="text-right">Pares/dia</TableHead>
                        <TableHead>Entrega</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {b.contributing_orders.map(o => (
                        <TableRow key={o.order_id}>
                          <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                          <TableCell className="text-xs">
                            {o.sheet_name || '—'}
                            {o.color && <span className="text-muted-foreground"> · {o.color}</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{o.quantity}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{o.pairs_per_day}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <Calendar className="inline h-3 w-3 mr-1" />
                            {new Date(o.planned_delivery + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
              </Panel>
            );
          })}
        </div>
      )}

      {/* Tabela geral (todos os setores × semanas, incluindo não-gargalo) */}
      {all.length > 0 && (
        <Panel title="Carga por setor × semana (todos)" flush>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead>Setor</TableHead>
                  <TableHead>Semana</TableHead>
                  <TableHead className="text-right">OPs</TableHead>
                  <TableHead className="text-right">Pares</TableHead>
                  <TableHead className="text-right">Capacidade</TableHead>
                  <TableHead className="text-right">Utilização</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {all.map(b => {
                  const style = SEVERITY_STYLE[b.severity];
                  return (
                    <TableRow key={`${b.sector}-${b.week_start}`}>
                      <TableCell className="text-xs">{SECTOR_LABEL[b.sector]}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatWeekLabel(b.week_start)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{b.ops_count}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{b.total_pairs_planned.toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{b.total_capacity_week.toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={cn(style.badge, 'text-xs')}>{b.utilization_pct}%</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
        </Panel>
      )}

      {bulkBottleneck && (
        <BulkAssignServiceOrderDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          sector={bulkBottleneck.sector}
          weekStart={bulkBottleneck.week_start}
          contributingOrders={bulkBottleneck.contributing_orders}
        />
      )}
    </div>
  );
}

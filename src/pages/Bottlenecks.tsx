import { useState, useMemo } from 'react';
import {
  Warning as AlertTriangle, Pen, Hand, Scissors, Stack as Layers,
  ArrowRight, Calendar, Buildings, Package as Boxes,
} from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import {
  useSectorBottlenecks, useActiveBottlenecks, SECTOR_LABEL, SectorKey,
  type SectorBottleneck, type ContributingOrder,
} from '@/hooks/useSectorBottlenecks';
import { GenerateServiceOrderDialog } from '@/components/bottlenecks/GenerateServiceOrderDialog';
import { BulkAssignServiceOrderDialog } from '@/components/bottlenecks/BulkAssignServiceOrderDialog';
import { cn } from '@/lib/utils';

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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ContributingOrder | null>(null);
  const [selectedSector, setSelectedSector] = useState<SectorKey>('costura');
  const [selectedWeek, setSelectedWeek] = useState<string>('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBottleneck, setBulkBottleneck] = useState<SectorBottleneck | null>(null);

  const openDialog = (b: SectorBottleneck, order: ContributingOrder) => {
    setSelectedOrder(order);
    setSelectedSector(b.sector);
    setSelectedWeek(b.week_start);
    setDialogOpen(true);
  };

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
      <div>
        <h2 className="display text-xl tracking-tight">Monitoramento de Gargalos</h2>
        <p className="text-sm text-muted-foreground">
          Setores que estão sobrecarregados em alguma semana. Use o botão "Gerar OS"
          para transferir OPs específicas pra uma costureira terceirizada antes que
          atrase a Montagem.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className={cn('border-l-4', summary.critical > 0 ? 'border-l-red-500' : 'border-l-green-500')}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Críticos</span>
              <AlertTriangle className={cn('h-4 w-4', summary.critical > 0 ? 'text-red-600' : 'text-muted-foreground')} />
            </div>
            <div className="display text-2xl tabular-nums font-mono">{summary.critical}</div>
            <p className="text-[10px] text-muted-foreground">utilização &gt; 150%</p>
          </CardContent>
        </Card>
        <Card className={cn('border-l-4', summary.warning > 0 ? 'border-l-amber-500' : 'border-l-green-500')}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Atenção</span>
              <AlertTriangle className={cn('h-4 w-4', summary.warning > 0 ? 'text-amber-600' : 'text-muted-foreground')} />
            </div>
            <div className="display text-2xl tabular-nums font-mono">{summary.warning}</div>
            <p className="text-[10px] text-muted-foreground">100% &lt; util &lt; 150%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">OPs em gargalo</span>
              <Boxes className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="display text-2xl tabular-nums font-mono">{summary.totalOps}</div>
            <p className="text-[10px] text-muted-foreground">total agregado</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pares planejados</span>
              <Boxes className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="display text-2xl tabular-nums font-mono">{summary.totalPairs.toLocaleString('pt-BR')}</div>
            <p className="text-[10px] text-muted-foreground">nas semanas com gargalo</p>
          </CardContent>
        </Card>
      </div>

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
              <Card key={`${b.sector}-${b.week_start}`} className={cn('border-l-4', style.border)}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="bg-muted p-2 rounded-lg">
                        <Icon className={cn('h-5 w-5', style.icon)} />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          {SECTOR_LABEL[b.sector]} · Semana {formatWeekLabel(b.week_start)}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {b.ops_count} OPs acumuladas · {b.total_pairs_planned.toLocaleString('pt-BR')} pares planejados ·
                          capacidade total da semana: {b.total_capacity_week.toLocaleString('pt-BR')} pares
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={cn(style.badge, 'text-[11px]')}>
                        {b.utilization_pct}% utilizado
                      </Badge>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-[11px] gap-1"
                        onClick={() => openBulkDialog(b)}
                      >
                        <Buildings className="h-3 w-3" />
                        Encaminhar todas
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>OP</TableHead>
                        <TableHead>Modelo / Cor</TableHead>
                        <TableHead className="text-right">Pares</TableHead>
                        <TableHead className="text-right">Pares/dia</TableHead>
                        <TableHead>Entrega</TableHead>
                        <TableHead className="text-right">Ação</TableHead>
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
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => openDialog(b, o)}
                            >
                              <Buildings className="h-3 w-3 mr-1" />
                              Gerar OS
                              <ArrowRight className="h-3 w-3 ml-1" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Tabela geral (todos os setores × semanas, incluindo não-gargalo) */}
      {all.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Carga por setor × semana (todos)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
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
                        <Badge variant="outline" className={cn(style.badge, 'text-[10px]')}>{b.utilization_pct}%</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <GenerateServiceOrderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        contributingOrder={selectedOrder}
        sector={selectedSector}
        weekStart={selectedWeek}
      />

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

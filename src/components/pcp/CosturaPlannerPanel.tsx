import { useState, useMemo } from 'react';
import { Panel } from '@/components/ui/panel';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Scissors,
  Factory,
  Warning as AlertTriangle,
  CheckCircle,
  Buildings,
  ChartBar,
  ArrowRight,
  Calendar,
} from '@phosphor-icons/react';
import {
  useCosturaCapacityPlan,
  useCosturaBacklog,
  useCosturaDispatchPlan,
  CosturaCapacityDay,
  DispatchOverflowDay,
  DispatchContributingOrder,
} from '@/hooks/useCosturaPlanner';
import { useProductionSettings } from '@/hooks/useProductionSettings';
import { useTableRealtime } from '@/hooks/useTableRealtime';
import { BulkAssignServiceOrderDialog } from '@/components/bottlenecks/BulkAssignServiceOrderDialog';
import { ContributingOrder } from '@/hooks/useSectorBottlenecks';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function formatDateFull(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

function statusColor(s: CosturaCapacityDay['status']): string {
  if (s === 'overflow') return 'bg-red-500';
  if (s === 'warning') return 'bg-amber-500';
  if (s === 'weekend') return 'bg-muted';
  return 'bg-emerald-500';
}

export default function CosturaPlannerPanel() {
  const { data: capacityPlan = [], isLoading: loadingPlan } = useCosturaCapacityPlan();
  const { data: backlog = [], isLoading: loadingBacklog } = useCosturaBacklog();
  const { data: dispatchPlan, isLoading: loadingDispatch } = useCosturaDispatchPlan(30);
  const { data: settings } = useProductionSettings();

  // Realtime: orders/order_stages/service_orders mudam o backlog e o capacity
  // plan. Notifications usadas pelo sino do header reagem em INSERT.
  useTableRealtime([
    { table: 'orders', invalidate: [['costura_backlog_30d'], ['costura_capacity_plan'], ['costura_dispatch_plan', 30]] },
    { table: 'order_stages', invalidate: [['costura_backlog_30d'], ['costura_capacity_plan'], ['costura_dispatch_plan', 30]] },
    { table: 'service_orders', invalidate: [['costura_backlog_30d'], ['costura_capacity_plan'], ['costura_dispatch_plan', 30]] },
    { table: 'production_settings', invalidate: [['production_settings'], ['costura_capacity_plan']] },
  ], { channelName: 'costura-planner' });

  const [selectedDay, setSelectedDay] = useState<DispatchOverflowDay | null>(null);

  const businessDays = useMemo(() => capacityPlan.filter(d => !d.is_weekend), [capacityPlan]);

  const stats = useMemo(() => {
    const totalPairs = businessDays.reduce((s, d) => s + d.sum_pairs_internal + d.sum_pairs_outsourced, 0);
    const totalCapacity = businessDays.reduce((s, d) => s + d.capacity_total, 0);
    const overflowDays = businessDays.filter(d => d.status === 'overflow').length;
    const warningDays = businessDays.filter(d => d.status === 'warning').length;
    const occupation = totalCapacity > 0 ? Math.round((totalPairs / totalCapacity) * 100) : 0;
    return { totalPairs, totalCapacity, overflowDays, warningDays, occupation };
  }, [businessDays]);

  const noMaterialBacklog = useMemo(
    () => backlog.filter(b => !b.material_ready),
    [backlog],
  );

  const maxBarHeight = useMemo(() => {
    const maxLoad = Math.max(
      ...businessDays.map(d => d.sum_pairs_internal + d.sum_pairs_outsourced),
      settings?.costura_pairs_per_day_total ?? 1500,
    );
    return Math.ceil(maxLoad * 1.1);
  }, [businessDays, settings]);

  const overflowDays = dispatchPlan?.overflow_days ?? [];

  const toContributingOrders = (orders: DispatchContributingOrder[]): ContributingOrder[] => {
    return orders.map(o => ({
      order_id: o.order_id,
      order_number: o.order_number ?? '—',
      sale_order_id: o.sale_order_id,
      sheet_name: o.sheet_name,
      color: o.color,
      quantity: o.quantity,
      planned_delivery: o.planned_delivery ?? o.needed_date,
      pairs_per_day: 0,
    }));
  };

  return (
    <div className="space-y-5">
      <Panel
        eyebrow="PCP · COSTURA"
        title="Planner de Costura"
        subtitle="Análise rolling de 30 dias — capacidade interna vs. demanda, com sugestão de batch pra terceirização."
        icon={Scissors}
      >
        <StatGrid columns={4}>
          <StatCard
            label="Demanda 30d"
            value={stats.totalPairs.toLocaleString('pt-BR')}
            hint="pares planejados"
            icon={Factory}
          />
          <StatCard
            label="Capacidade 30d"
            value={stats.totalCapacity.toLocaleString('pt-BR')}
            hint={settings ? `${settings.costura_pairs_per_day_total}/dia` : '—'}
            icon={ChartBar}
          />
          <StatCard
            label="Ocupação média"
            value={`${stats.occupation}%`}
            tone={stats.occupation >= 100 ? 'destructive' : stats.occupation >= 90 ? 'warning' : 'success'}
            icon={ChartBar}
          />
          <StatCard
            label="Dias críticos"
            value={stats.overflowDays}
            hint={stats.warningDays > 0 ? `+${stats.warningDays} alerta` : 'todos OK'}
            tone={stats.overflowDays > 0 ? 'destructive' : 'success'}
            icon={AlertTriangle}
          />
        </StatGrid>
      </Panel>

      <Panel
        eyebrow="OCUPAÇÃO DIÁRIA"
        title="Próximos 30 dias úteis"
        subtitle="Verde = ok · Amarelo = alerta · Vermelho = overflow. Linha tracejada = capacidade da fábrica."
        icon={ChartBar}
      >
        {loadingPlan ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
        ) : businessDays.length === 0 ? (
          <EmptyState icon={Calendar} title="Sem dias úteis no horizonte" />
        ) : (
          <div className="space-y-2">
            <div className="relative flex items-end gap-1 h-48 pb-6 pt-2 border-b border-border/40">
              {businessDays.map(d => {
                const total = d.sum_pairs_internal + d.sum_pairs_outsourced;
                const internalH = (d.sum_pairs_internal / maxBarHeight) * 100;
                const outsourcedH = (d.sum_pairs_outsourced / maxBarHeight) * 100;
                const capacityLineTop = 100 - (d.capacity_total / maxBarHeight) * 100;
                return (
                  <div
                    key={d.day}
                    className="flex-1 min-w-[16px] relative flex flex-col justify-end group cursor-default"
                    title={`${formatDateFull(d.day)} — ${total} pares (${d.occupation_pct}%)`}
                  >
                    {d.sum_pairs_outsourced > 0 && (
                      <div
                        className="bg-blue-500/70 w-full"
                        style={{ height: `${outsourcedH}%` }}
                      />
                    )}
                    <div
                      className={`w-full ${statusColor(d.status)}`}
                      style={{ height: `${internalH}%` }}
                    />
                    <div
                      className="absolute left-0 right-0 border-t border-dashed border-foreground/50"
                      style={{ top: `${capacityLineTop}%` }}
                    />
                    <div className="absolute -bottom-5 left-0 right-0 text-[9px] text-center text-muted-foreground font-mono">
                      {formatDate(d.day).slice(0, 5)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 bg-emerald-500 rounded-sm" /> OK
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 bg-amber-500 rounded-sm" /> Alerta
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 bg-red-500 rounded-sm" /> Overflow
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 bg-blue-500/70 rounded-sm" /> Já em terceiros
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-px border-t border-dashed border-foreground/50" /> Capacidade
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        eyebrow="EXCEDENTE DETECTADO"
        title={`${overflowDays.length} dia(s) em overflow`}
        subtitle="OPs sugeridas por dia — FIFO por deadline do PV. Excedente = soma dos pares de OPs candidatas pra terceirização."
        icon={AlertTriangle}
      >
        {loadingDispatch ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Calculando plano...</div>
        ) : overflowDays.length === 0 ? (
          <EmptyState
            icon={CheckCircle}
            title="Sem overflow nos próximos 30 dias"
            description="Toda a demanda de Costura cabe na capacidade interna da fábrica."
          />
        ) : (
          <div className="space-y-3">
            {overflowDays.map(day => (
              <div
                key={day.day}
                className="rounded-md border border-red-500/30 bg-red-500/5 p-3"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-red-600" />
                      {formatDateFull(day.day)}
                      <Badge variant="destructive" className="h-5 text-xs">
                        +{day.overflow_pairs} pares
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {day.contributing_orders.length} OP(s) candidata(s) cobrindo {day.covered_pairs} pares
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setSelectedDay(day)}
                    className="gap-1.5"
                    disabled={day.contributing_orders.length === 0}
                  >
                    <Buildings className="h-3.5 w-3.5" />
                    Enviar pra terceirizada
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {day.contributing_orders.length > 0 && (
                  <div className="mt-3 rounded-md border border-border bg-card max-h-40 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left p-2">OP</th>
                          <th className="text-left p-2">PV</th>
                          <th className="text-left p-2">Modelo · Cor</th>
                          <th className="text-right p-2">Pares</th>
                          <th className="text-right p-2">Deadline PV</th>
                          <th className="text-center p-2">Material</th>
                        </tr>
                      </thead>
                      <tbody>
                        {day.contributing_orders.slice(0, 10).map(o => (
                          <tr key={o.order_id} className="border-t border-border/40">
                            <td className="p-2 font-mono">{o.order_number || '—'}</td>
                            <td className="p-2 font-mono text-muted-foreground">{o.sale_order_number || '—'}</td>
                            <td className="p-2">
                              {o.sheet_name || '—'}{o.color ? ` · ${o.color}` : ''}
                            </td>
                            <td className="p-2 text-right tabular-nums">{o.quantity}</td>
                            <td className="p-2 text-right text-muted-foreground">
                              {formatDate(o.sale_order_deadline)}
                            </td>
                            <td className="p-2 text-center">
                              {o.material_ready ? (
                                <CheckCircle className="h-3.5 w-3.5 text-emerald-600 inline" />
                              ) : (
                                <span className="text-amber-600 text-[10px] uppercase font-bold">falta</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {day.contributing_orders.length > 10 && (
                          <tr>
                            <td colSpan={6} className="p-2 text-center text-xs text-muted-foreground italic">
                              … e mais {day.contributing_orders.length - 10} OP(s)
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {noMaterialBacklog.length > 0 && (
        <Panel
          eyebrow="MATERIAL FALTANDO"
          title={`${noMaterialBacklog.length} OP(s) aguardando material pra Costura`}
          subtitle="OPs nos próximos 30 dias sem reserva de material confirmada. Verifique ordens de compra."
          icon={AlertTriangle}
        >
          {loadingBacklog ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Carregando...</div>
          ) : (
            <div className="rounded-md border border-border bg-card max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2">PV</th>
                    <th className="text-left p-2">Cor</th>
                    <th className="text-right p-2">Pares</th>
                    <th className="text-right p-2">Quando entra</th>
                  </tr>
                </thead>
                <tbody>
                  {noMaterialBacklog.slice(0, 30).map(b => (
                    <tr key={b.order_id} className="border-t border-border/40">
                      <td className="p-2 font-mono text-muted-foreground">{b.sale_order_number || '—'}</td>
                      <td className="p-2">{b.color || '—'}</td>
                      <td className="p-2 text-right tabular-nums">{b.quantity}</td>
                      <td className="p-2 text-right text-muted-foreground">{formatDate(b.needed_date)}</td>
                    </tr>
                  ))}
                  {noMaterialBacklog.length > 30 && (
                    <tr>
                      <td colSpan={4} className="p-2 text-center text-xs text-muted-foreground italic">
                        … e mais {noMaterialBacklog.length - 30} OP(s)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {selectedDay && (
        <BulkAssignServiceOrderDialog
          open={!!selectedDay}
          onOpenChange={(v) => { if (!v) setSelectedDay(null); }}
          sector="costura"
          weekStart={selectedDay.week_iso}
          contributingOrders={toContributingOrders(selectedDay.contributing_orders)}
        />
      )}
    </div>
  );
}

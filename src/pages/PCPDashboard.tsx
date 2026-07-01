import { useMemo } from 'react';
import { ChartBar as BarChart3, TrendUp as TrendingUp, Clock, Warning as AlertTriangle, Factory, Package, CheckCircle as CheckCircle2, XCircle } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Badge } from '@/components/ui/badge';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { useOrders } from '@/hooks/useOrders';
import { useAllOrderStages } from '@/hooks/useOrderStages';
import { useAllQualityRecords } from '@/hooks/useQualityRecords';
import { useAllReservations } from '@/hooks/useReservations';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { differenceInHours, parseISO } from 'date-fns';
import { DISPLAY_SECTORS, SECTOR_LABELS, normalizeSector } from '@/lib/sectors';

const CHART_COLORS = ['#0EA5E9', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6'];

const CustomTooltip = ({ active, payload, label, formatter }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background/95 border border-border p-3 rounded-lg shadow-lg backdrop-blur-sm min-w-[120px]">
        {label && <p className="text-xs font-bold mb-1.5 text-muted-foreground">{label}</p>}
        <div className="space-y-1">
          {payload.map((item: any, index: number) => (
            <div key={index} className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color || item.fill }} />
              <p className="text-xs font-medium">
                <span className="text-muted-foreground">{item.name}:</span>{" "}
                {formatter ? formatter(item.value) : item.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

// Setores na ordem canônica do fluxo (fonte única em src/lib/sectors.ts) + Expedição.
// Antes a lista era hard-coded com "Mesa" (renomeado p/ Aviamento) e SEM "Costura",
// então o WIP de Aviamento aparecia zerado e o de Costura sumia do gráfico.
const SECTORS = [...DISPLAY_SECTORS.map(s => s.label), SECTOR_LABELS.expedicao];

export default function PCPDashboard() {
  const { data: orders = [] } = useOrders();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  const { data: qualityRecords = [] } = useAllQualityRecords();
  const { data: reservations = [] } = useAllReservations();

  const productionOrders = useMemo(() =>
    orders.filter(o => {
      const s = (o.status || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return s === 'em producao' || s === 'producao' || s === 'em_producao';
    }),
    [orders]
  );

  // WIP by sector — quantity_processed é fonte confiável desde a migration 20260902120000 (backfill + finalize preenche).
  const wipBySector = useMemo(() => {
    const orderIds = new Set(productionOrders.map(o => o.id));
    return SECTORS.map(sector => {
      const stages = allStages.filter(s => orderIds.has(s.order_id) && normalizeSector(s.stage_name) === normalizeSector(sector));
      const pending = stages.filter(s => s.status === 'pendente').reduce((sum, s) => sum + s.quantity_total, 0);
      const inProgress = stages.filter(s => s.status === 'em_andamento').reduce((sum, s) => sum + (s.quantity_total - s.quantity_processed), 0);
      const done = stages.filter(s => s.status === 'concluido').reduce((sum, s) => sum + s.quantity_processed, 0);
      return { sector, pending, inProgress, done, total: pending + inProgress };
    });
  }, [allStages, productionOrders]);

  // Yield (rendimento)
  const yieldStats = useMemo(() => {
    const orderIds = new Set(productionOrders.map(o => o.id));
    const finishedStages = allStages.filter(s => orderIds.has(s.order_id) && s.status === 'concluido');
    const totalPlanned = finishedStages.reduce((s, st) => s + st.quantity_total, 0);
    const totalProcessed = finishedStages.reduce((s, st) => s + st.quantity_processed, 0);
    return { planned: totalPlanned, produced: totalProcessed, rate: totalPlanned > 0 ? (totalProcessed / totalPlanned * 100) : 0 };
  }, [allStages, productionOrders]);

  // Defect rate
  const defectStats = useMemo(() => {
    const totalDefects = qualityRecords.filter(q => (q as any).record_type === 'defect').reduce((s, q) => s + ((q as any).quantity || 0), 0);
    const totalProduced = yieldStats.produced;
    return { total: totalDefects, rate: totalProduced > 0 ? (totalDefects / totalProduced * 100) : 0 };
  }, [qualityRecords, yieldStats]);

  // Lead time médio
  const avgLeadTime = useMemo(() => {
    const completed = orders.filter(o => {
      const s = (o.status || '').toLowerCase();
      return s.includes('conclu') || s.includes('finaliz') || s === 'completed';
    });
    if (completed.length === 0) return 0;
    const times = completed.map(o => {
      const start = o.planned_start || o.created_at;
      const end = (o as any).last_sector_finished_at || o.updated_at;
      return differenceInHours(parseISO(end), parseISO(start));
    }).filter(t => t > 0);
    return times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  }, [orders]);

  // Material availability
  const materialStats = useMemo(() => {
    const pending = reservations.filter(r => (r as any).status === 'reserved').length;
    const consumed = reservations.filter(r => (r as any).status === 'consumed').length;
    return { pending, consumed, total: pending + consumed };
  }, [reservations]);

  // Apontamento (adoção do sinal real — keystone): % das OPs em produção cuja
  // etapa corrente está apontada como em_andamento COM started_at. Mede se o chão
  // registra o início; sem isso gargalo/atraso/lead-time real ficam cegos.
  const apontamento = useMemo(() => {
    const ids = new Set(productionOrders.map(o => o.id));
    const byOrder = new Map<string, typeof allStages>();
    for (const s of allStages) {
      if (!ids.has(s.order_id)) continue;
      const arr = byOrder.get(s.order_id);
      if (arr) arr.push(s); else byOrder.set(s.order_id, [s]);
    }
    let total = 0, apontadas = 0;
    for (const sts of byOrder.values()) {
      const current = [...sts].filter(s => s.status !== 'concluido').sort((a, b) => a.stage_order - b.stage_order)[0];
      if (!current) continue;
      total++;
      if (current.status === 'em_andamento' && current.started_at) apontadas++;
    }
    return { total, apontadas, rate: total > 0 ? (apontadas / total) * 100 : 0 };
  }, [allStages, productionOrders]);

  // Status distribution for pie chart
  const statusDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(o => {
      const st = o.status || 'Outro';
      counts[st] = (counts[st] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [orders]);

  return (

      <div className="editorial-container editorial-stagger w-full space-y-6 page-enter">
        <EditorialPageHeader
          sectionNumber="02"
          sectionLabel="PCP · VISÃO GERAL"
          title="PCP"
          description="Planejamento e controle de produção: WIP por setor, rendimento, lead time e qualidade."
          actions={
            <Badge variant="secondary" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              {productionOrders.length} OPs em produção
            </Badge>
          }
        />

        {/* Section header: KPIs */}
        <div className="flex items-baseline gap-3 pt-2">
          <span className="font-display text-2xl text-muted-foreground tabular-nums">01</span>
          <span className="section-label">Indicadores</span>
        </div>

        {/* KPI Cards */}
        <StatGrid>
          <StatCard
            label="OPs Ativas"
            value={productionOrders.length}
            icon={Factory}
          />
          <StatCard
            label="Total Pares"
            value={productionOrders.reduce((s, o) => s + (o.quantity || 0), 0).toLocaleString('pt-BR')}
            icon={Package}
            tone="warning"
          />
          <StatCard
            label="Rendimento"
            value={`${yieldStats.rate.toFixed(1)}%`}
            icon={TrendingUp}
            tone="success"
          />
          <StatCard
            label="Taxa Rejeito"
            value={`${defectStats.rate.toFixed(1)}%`}
            icon={XCircle}
            tone="destructive"
          />
          <StatCard
            label="Lead Time Médio"
            value={avgLeadTime}
            unit="h"
            icon={Clock}
          />
          <StatCard
            label="Materiais Reservados"
            value={materialStats.pending}
            icon={AlertTriangle}
            tone="warning"
          />
          <StatCard
            label="Apontamento"
            value={`${apontamento.rate.toFixed(0)}%`}
            icon={CheckCircle2}
            tone={apontamento.rate >= 60 ? 'success' : apontamento.rate >= 30 ? 'warning' : 'destructive'}
            hint={`${apontamento.apontadas}/${apontamento.total} OPs com início apontado`}
          />
        </StatGrid>

        {/* Section header: Charts */}
        <div className="flex items-baseline gap-3 pt-2">
          <span className="font-display text-2xl text-muted-foreground tabular-nums">02</span>
          <span className="section-label">Distribuição</span>
        </div>

        {/* Charts */}
        <div className="grid sm:grid-cols-1 md:grid-cols-2 gap-4">
          {/* WIP by Sector */}
          <Panel title="WIP por Setor (pares)">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={wipBySector} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="sector" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip formatter={(v: number) => `${v} pares`} />} />
                  <Bar dataKey="pending" stackId="a" fill={CHART_COLORS[1]} name="Pendente" radius={[0, 0, 0, 0]} barSize={30} />
                  <Bar dataKey="inProgress" stackId="a" fill={CHART_COLORS[0]} name="Em andamento" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
          </Panel>

          {/* Status Distribution */}
          <Panel title="Distribuição de OPs">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie 
                    data={statusDistribution} 
                    cx="50%" 
                    cy="50%" 
                    innerRadius={60} 
                    outerRadius={90} 
                    paddingAngle={3} 
                    dataKey="value" 
                    stroke="none"
                  >
                    {statusDistribution.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                </PieChart>
              </ResponsiveContainer>
          </Panel>
        </div>

        {/* Section header: Detalhamento */}
        <div className="flex items-baseline gap-3 pt-2">
          <span className="font-display text-2xl text-muted-foreground tabular-nums">03</span>
          <span className="section-label">Detalhamento por Setor</span>
        </div>

        {/* Sector Detail Table */}
        <Panel title="Detalhamento por Setor" flush>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="sticky top-0 z-sticky bg-muted/40 backdrop-blur-sm border-b [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                    <th className="text-left p-2">Setor</th>
                    <th className="text-center p-2">Pendentes</th>
                    <th className="text-center p-2">Em Andamento</th>
                    <th className="text-center p-2">Concluídos</th>
                    <th className="text-center p-2">WIP (pares)</th>
                  </tr>
                </thead>
                <tbody>
                  {wipBySector.map(row => (
                    <tr key={row.sector} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="p-2 font-medium">{row.sector}</td>
                      <td className="p-2 text-center tabular-nums">
                        <Badge variant="secondary">{row.pending}</Badge>
                      </td>
                      <td className="p-2 text-center tabular-nums">
                        <Badge variant="default">{row.inProgress}</Badge>
                      </td>
                      <td className="p-2 text-center tabular-nums">
                        <Badge className="bg-success/15 text-success border-success/30">{row.done}</Badge>
                      </td>
                      <td className="p-2 text-center font-bold tabular-nums">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </Panel>

        {/* Section header: Qualidade */}
        {qualityRecords.length > 0 && (
          <div className="flex items-baseline gap-3 pt-2">
            <span className="font-display text-2xl text-muted-foreground tabular-nums">04</span>
            <span className="section-label">Qualidade</span>
          </div>
        )}

        {/* Recent Quality Issues */}
        {qualityRecords.length > 0 && (
          <Panel title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Últimos Registros de Qualidade</span>}>
              <div className="space-y-2">
                {qualityRecords.slice(0, 10).map((qr: any) => (
                  <div key={qr.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
                    <div>
                      <span className="font-medium">{qr.stage_name}</span>
                      <span className="text-muted-foreground ml-2">{qr.description || qr.record_type}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={qr.resolved ? 'secondary' : 'destructive'} className="text-xs">
                        {qr.quantity} un - {qr.resolved ? 'Resolvido' : qr.severity}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
          </Panel>
        )}
      </div>

  );
}

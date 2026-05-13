import { useMemo } from 'react';
import { ChartBar as BarChart3, TrendUp as TrendingUp, Clock, Warning as AlertTriangle, Factory, Package, CheckCircle as CheckCircle2, XCircle } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOrders } from '@/hooks/useOrders';
import { useAllOrderStages } from '@/hooks/useOrderStages';
import { useAllQualityRecords } from '@/hooks/useQualityRecords';
import { useAllReservations } from '@/hooks/useReservations';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { differenceInHours, parseISO } from 'date-fns';

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

const SECTORS = ['Corte Palmilha', 'Corte Forração', 'Mesa', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição'];

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

  // WIP by sector
  const wipBySector = useMemo(() => {
    const orderIds = new Set(productionOrders.map(o => o.id));
    return SECTORS.map(sector => {
      const stages = allStages.filter(s => orderIds.has(s.order_id) && s.stage_name === sector);
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
    const completed = orders.filter(o => (o.status || '').toLowerCase().includes('concluída') || o.status === 'completed');
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
    
      <div className="w-full space-y-6 page-enter">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold">Dashboard PCP</h1>
          <Badge variant="secondary">{productionOrders.length} OPs em produção</Badge>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <Factory className="h-5 w-5 mx-auto text-primary mb-1" />
              <p className="text-2xl font-bold">{productionOrders.length}</p>
              <p className="text-xs text-muted-foreground">OPs Ativas</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <Package className="h-5 w-5 mx-auto text-warning mb-1" />
              <p className="text-2xl font-bold">{productionOrders.reduce((s, o) => s + (o.quantity || 0), 0)}</p>
              <p className="text-xs text-muted-foreground">Total Pares</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <TrendingUp className="h-5 w-5 mx-auto text-success mb-1" />
              <p className="text-2xl font-bold">{yieldStats.rate.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Rendimento</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <XCircle className="h-5 w-5 mx-auto text-destructive mb-1" />
              <p className="text-2xl font-bold">{defectStats.rate.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Taxa Rejeito</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <Clock className="h-5 w-5 mx-auto text-accent mb-1" />
              <p className="text-2xl font-bold">{avgLeadTime}h</p>
              <p className="text-xs text-muted-foreground">Lead Time Médio</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <AlertTriangle className="h-5 w-5 mx-auto text-warning mb-1" />
              <p className="text-2xl font-bold">{materialStats.pending}</p>
              <p className="text-xs text-muted-foreground">Materiais Reservados</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* WIP by Sector */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">WIP por Setor (pares)</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          {/* Status Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Distribuição de OPs</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </div>

        {/* Sector Detail Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Detalhamento por Setor</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Setor</th>
                    <th className="text-center p-2">Pendentes</th>
                    <th className="text-center p-2">Em Andamento</th>
                    <th className="text-center p-2">Concluídos</th>
                    <th className="text-center p-2">WIP (pares)</th>
                  </tr>
                </thead>
                <tbody>
                  {wipBySector.map(row => (
                    <tr key={row.sector} className="border-b hover:bg-muted/50">
                      <td className="p-2 font-medium">{row.sector}</td>
                      <td className="p-2 text-center">
                        <Badge variant="secondary">{row.pending}</Badge>
                      </td>
                      <td className="p-2 text-center">
                        <Badge variant="default">{row.inProgress}</Badge>
                      </td>
                      <td className="p-2 text-center">
                        <Badge className="bg-success/15 text-success border-success/30">{row.done}</Badge>
                      </td>
                      <td className="p-2 text-center font-bold">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Recent Quality Issues */}
        {qualityRecords.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Últimos Registros de Qualidade
              </CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        )}
      </div>
    
  );
}

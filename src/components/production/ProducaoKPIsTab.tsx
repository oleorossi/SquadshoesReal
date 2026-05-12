import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProducaoKPIs, PeriodFilter } from '@/hooks/useProducaoKPIs';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { TrendUp as TrendingUp, TrendDown as TrendingDown, Target, Clock, Warning as AlertTriangle, ChartBar as BarChart3, Package, ArrowClockwise as RotateCw, ShieldCheck, Wrench, Bug } from '@phosphor-icons/react';

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: '90d', label: 'Últimos 3 meses' },
  { value: '180d', label: 'Últimos 6 meses' },
  { value: 'all', label: 'Todo o período' },
];

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  in_production: 'Em Produção',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

const PIE_COLORS = [
  '#0EA5E9', // Primary
  '#F59E0B', // Warning
  '#10B981', // Success
  '#EF4444', // Destructive
  '#8B5CF6', // Violet
  '#EC4899', // Pink
];

const CustomTooltip = ({ active, payload, label, formatter }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background/95 border border-border p-3 rounded-lg shadow-lg backdrop-blur-sm">
        {label && <p className="text-xs font-bold mb-1.5 text-muted-foreground">{label}</p>}
        <div className="space-y-1">
          {payload.map((item: any, index: number) => (
            <div key={index} className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color || item.fill }} />
              <p className="text-xs font-medium">
                <span className="text-muted-foreground">{item.name || item.dataKey}:</span>{" "}
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


function KpiCard({ icon: Icon, label, value, unit, color, subtitle }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${color || 'bg-primary/10'}`}>
            <Icon className={`h-5 w-5 ${color?.includes('destructive') ? 'text-destructive' : 'text-primary'}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="text-lg font-bold">
              {value}{unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
            </p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProducaoKPIsTab() {
  const [period, setPeriod] = useState<PeriodFilter>('30d');
  const { data, isLoading } = useProducaoKPIs(period);

  if (isLoading) return <div className="flex items-center justify-center h-32 text-muted-foreground">Carregando KPIs...</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Period Filter */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Indicadores de Produção</h2>
        <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={Target} label="Fill Rate" value={data.fillRate} unit="%" subtitle={`${data.completedOps}/${data.totalOps} OPs`} />
        <KpiCard icon={Package} label="Precisão de Estoque" value={data.stockAccuracy} unit="%" color="bg-primary/10" />
        <KpiCard icon={Clock} label="Tempo Médio de Ciclo" value={data.avgCycleTime} unit="dias" />
        <KpiCard icon={TrendingUp} label="Pares Produzidos" value={data.pairsProduced.toLocaleString('pt-BR')} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          icon={AlertTriangle}
          label="OPs Atrasadas"
          value={data.delayRate}
          unit="%"
          color="bg-destructive/10"
          subtitle={`${data.delayedCount} de ${data.activeOps} ativas`}
        />
        <KpiCard icon={RotateCw} label="Giro de Componentes" value={data.turnover} unit="x" />
        <KpiCard icon={BarChart3} label="Total de OPs" value={data.totalOps} subtitle="no período" />
        <KpiCard icon={TrendingDown} label="OPs Ativas" value={data.activeOps} subtitle="em andamento" />
      </div>

      {/* Quality KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={ShieldCheck} label="Score de Qualidade" value={data.qualityScore} unit="%" color="bg-primary/10" subtitle={`${data.totalInspected} pares inspecionados`} />
        <KpiCard icon={Bug} label="Taxa de Defeito" value={data.defectRate} unit="%" color="bg-destructive/10" />
        <KpiCard icon={Wrench} label="Taxa de Retrabalho" value={data.reworkRate} unit="%" color="bg-destructive/10" />
        <KpiCard icon={Target} label="Total Inspecionado" value={data.totalInspected.toLocaleString('pt-BR')} subtitle="pares no período" />
      </div>

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Stage Efficiency Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Eficiência por Etapa
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.stageEfficiency.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sem dados de etapas</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.stageEfficiency} layout="vertical" margin={{ left: 20, right: 30, top: 10, bottom: 10 }}>
                  <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip formatter={(v: number, name: string) => name === 'Tempo Médio' ? `${v}h` : `${v}%`} />} />
                  <Bar dataKey="efficiency" name="Eficiência (%)" fill={PIE_COLORS[0]} radius={[0, 4, 4, 0]} barSize={15} />
                  <Bar dataKey="avgTimeHours" name="Tempo Médio (h)" fill={PIE_COLORS[1]} radius={[0, 4, 4, 0]} barSize={15} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Status Distribution Pie Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> Distribuição de Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.statusDist.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sem dados</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={data.statusDist}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    stroke="none"
                  >
                    {data.statusDist.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip formatter={(v: number, name: string) => [v, STATUS_LABELS[name] || name]} />} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delayed OPs List */}
      {data.delayedOpsList.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> OPs Atrasadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.delayedOpsList.map(op => (
                <div key={op.id} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{op.order_number}</p>
                    <p className="text-xs text-muted-foreground">{op.quantity} pares • Entrega: {op.planned_delivery}</p>
                  </div>
                  <Badge variant="destructive" className="text-xs shrink-0">
                    {op.daysLate} {op.daysLate === 1 ? 'dia' : 'dias'} atrasado
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

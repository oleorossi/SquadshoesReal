import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, Clock, Warning as AlertTriangle, TrendUp as TrendingUp, TrendDown as TrendingDown, Lightning as Zap } from '@phosphor-icons/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

interface PrinterMetric {
  id: string;
  name: string;
  status: 'online' | 'offline';
  totalPrinted: number;
  errorRate: number;
  avgSpeed: number;
  paperLevel: number;
  uptime: number;
}

const MOCK_VOLUME_DATA = [
  { date: '01/03', volume: 320, errors: 8 },
  { date: '05/03', volume: 450, errors: 5 },
  { date: '10/03', volume: 380, errors: 12 },
  { date: '15/03', volume: 520, errors: 3 },
  { date: '20/03', volume: 610, errors: 7 },
  { date: '25/03', volume: 490, errors: 4 },
  { date: '30/03', volume: 570, errors: 6 },
];

const MOCK_COST_DATA = [
  { month: 'Jan', material: 120, manutencao: 45, energia: 30 },
  { month: 'Fev', material: 135, manutencao: 20, energia: 32 },
  { month: 'Mar', material: 110, manutencao: 60, energia: 28 },
  { month: 'Abr', material: 145, manutencao: 15, energia: 35 },
];

const MOCK_OPTIMIZATION_DATA = [
  { name: 'Layout', value: 35 },
  { name: 'Performance', value: 25 },
  { name: 'Custo', value: 20 },
  { name: 'Qualidade', value: 20 },
];

const MOCK_PRINTERS: PrinterMetric[] = [
  { id: '1', name: 'Elgin L42 Pro', status: 'online', totalPrinted: 4520, errorRate: 1.2, avgSpeed: 3.2, paperLevel: 72, uptime: 98.5 },
  { id: '2', name: 'Zebra ZD421', status: 'online', totalPrinted: 3810, errorRate: 0.8, avgSpeed: 2.8, paperLevel: 95, uptime: 99.1 },
  { id: '3', name: 'Brother QL-820', status: 'offline', totalPrinted: 1200, errorRate: 3.5, avgSpeed: 4.1, paperLevel: 30, uptime: 87.2 },
];

const PIE_COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))'];

function TrendBadge({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const isPositive = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isPositive ? 'text-green-600' : 'text-destructive'}`}>
      {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isPositive ? '+' : ''}{value}{suffix}
    </span>
  );
}

export function LabelAnalyticsDashboard() {
  const [timeRange, setTimeRange] = useState('30d');

  const totals = useMemo(() => ({
    printed: MOCK_VOLUME_DATA.reduce((a, d) => a + d.volume, 0),
    errors: MOCK_VOLUME_DATA.reduce((a, d) => a + d.errors, 0),
    avgTime: 3.2,
    optimizations: 12,
  }), []);

  const errorRate = ((totals.errors / totals.printed) * 100).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Analytics de Etiquetas</h2>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 dias</SelectItem>
            <SelectItem value="30d">Últimos 30 dias</SelectItem>
            <SelectItem value="90d">Últimos 90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4 text-center space-y-1">
            <Printer className="h-5 w-5 mx-auto text-primary" />
            <div className="display text-2xl tabular-nums text-foreground">{totals.printed.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Etiquetas Impressas</div>
            <TrendBadge value={12.5} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center space-y-1">
            <Clock className="h-5 w-5 mx-auto text-green-600" />
            <div className="display text-2xl tabular-nums text-foreground">{totals.avgTime}s</div>
            <div className="text-xs text-muted-foreground">Tempo Médio</div>
            <TrendBadge value={-8.3} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center space-y-1">
            <AlertTriangle className="h-5 w-5 mx-auto text-destructive" />
            <div className="display text-2xl tabular-nums text-foreground">{errorRate}%</div>
            <div className="text-xs text-muted-foreground">Taxa de Erro</div>
            <TrendBadge value={-2.1} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center space-y-1">
            <Zap className="h-5 w-5 mx-auto text-purple-600" />
            <div className="display text-2xl tabular-nums text-foreground">{totals.optimizations}</div>
            <div className="text-xs text-muted-foreground">Otimizações Aplicadas</div>
            <TrendBadge value={4} suffix="" />
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Volume chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Volume de Impressão</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={MOCK_VOLUME_DATA}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="volume" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Volume" />
                <Bar dataKey="errors" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} name="Erros" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Costs chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Custos por Período (R$)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={MOCK_COST_DATA}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="material" stackId="a" fill="hsl(var(--primary))" name="Material" />
                <Bar dataKey="manutencao" stackId="a" fill="hsl(var(--chart-2))" name="Manutenção" />
                <Bar dataKey="energia" stackId="a" fill="hsl(var(--chart-3))" name="Energia" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Optimizations pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Otimizações por Categoria</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={MOCK_OPTIMIZATION_DATA} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name} ${value}%`}>
                  {MOCK_OPTIMIZATION_DATA.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Performance per printer */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Performance por Impressora</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={MOCK_PRINTERS} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="totalPrinted" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Total Impresso" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Printer status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Status das Impressoras em Tempo Real</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {MOCK_PRINTERS.map(p => (
              <div key={p.id} className="border rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex items-center gap-2 min-w-[180px]">
                  <Printer className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{p.name}</span>
                  <Badge variant={p.status === 'online' ? 'default' : 'secondary'} className="text-xs">
                    {p.status === 'online' ? '● Online' : '○ Offline'}
                  </Badge>
                </div>
                <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">Impressas</span>
                    <div className="font-semibold">{p.totalPrinted.toLocaleString()}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Erros</span>
                    <div className="font-semibold">{p.errorRate}%</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Uptime</span>
                    <div className="font-semibold">{p.uptime}%</div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground">Papel</span>
                    <Progress value={p.paperLevel} className="h-1.5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { CurrencyDollar as DollarSign, TrendUp as TrendingUp, TrendDown as TrendingDown, Package } from '@phosphor-icons/react';
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders';
import { useCogsEntries } from '@/hooks/useCogsEntries';
import { useCostVarianceReports } from '@/hooks/useCostVariance';
import { useProducts } from '@/hooks/useProducts';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, Area, AreaChart
} from 'recharts';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const COLORS = [
  'hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))', '#8884d8', '#82ca9d', '#ffc658'
];

export default function CostAnalyticsPanel() {
  const [period, setPeriod] = useState('3m');

  const { data: purchaseOrders = [] } = usePurchaseOrders();
  const { data: cogsEntries = [] } = useCogsEntries();
  const { data: varianceReports = [] } = useCostVarianceReports();
  const { data: products = [] } = useProducts();

  // Filter by period
  const periodDays = period === '1m' ? 30 : period === '3m' ? 90 : period === '6m' ? 180 : 365;
  const cutoff = new Date(Date.now() - periodDays * 86400000).toISOString();

  const filteredPOs = useMemo(() =>
    (purchaseOrders as any[]).filter(po => po.created_at >= cutoff),
    [purchaseOrders, cutoff]
  );

  const filteredCogs = useMemo(() =>
    (cogsEntries as any[]).filter(e => e.created_at >= cutoff),
    [cogsEntries, cutoff]
  );

  // KPIs
  const totalSpending = useMemo(() =>
    filteredPOs.reduce((s, po) => s + Number(po.total_value || 0), 0),
    [filteredPOs]
  );

  const totalCogs = useMemo(() =>
    filteredCogs.reduce((s, e) => s + Number(e.total_cogs || 0), 0),
    [filteredCogs]
  );

  const totalRevenue = useMemo(() =>
    filteredCogs.reduce((s, e) => s + Number(e.revenue || 0), 0),
    [filteredCogs]
  );

  const marginPct = totalRevenue > 0 ? ((totalRevenue - totalCogs) / totalRevenue) * 100 : 0;

  // Spending by supplier (pie chart)
  const spendingBySupplier = useMemo(() => {
    const map = new Map<string, number>();
    filteredPOs.forEach(po => {
      const name = po.supplier_name || 'Outros';
      map.set(name, (map.get(name) || 0) + Number(po.total_value || 0));
    });
    return Array.from(map).map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value).slice(0, 8);
  }, [filteredPOs]);

  // Monthly spending trend
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { spending: number; cogs: number; revenue: number }>();
    filteredPOs.forEach(po => {
      const month = po.created_at?.slice(0, 7) || '';
      if (!map.has(month)) map.set(month, { spending: 0, cogs: 0, revenue: 0 });
      map.get(month)!.spending += Number(po.total_value || 0);
    });
    filteredCogs.forEach(e => {
      const month = e.created_at?.slice(0, 7) || '';
      if (!map.has(month)) map.set(month, { spending: 0, cogs: 0, revenue: 0 });
      map.get(month)!.cogs += Number(e.total_cogs || 0);
      map.get(month)!.revenue += Number(e.revenue || 0);
    });
    return Array.from(map).sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }));
  }, [filteredPOs, filteredCogs]);

  // Spending by category
  const spendingByCategory = useMemo(() => {
    const map = new Map<string, number>();
    (products as any[]).forEach(p => {
      const cat = p.category || 'Outros';
      const stock = Number(p.quantity || 0) * Number(p.unit_price || 0);
      map.set(cat, (map.get(cat) || 0) + stock);
    });
    return Array.from(map).map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value).slice(0, 8);
  }, [products]);

  // Variance analysis
  const varianceData = useMemo(() =>
    (varianceReports as any[]).slice(0, 15).map(r => ({
      name: r.period || r.order_id?.slice(0, 8),
      padrão: Number(r.total_standard_cost || 0),
      real: Number(r.total_actual_cost || 0),
      variação: Number(r.total_variance || 0),
    })),
    [varianceReports]
  );

  // Supplier performance
  const supplierPerformance = useMemo(() => {
    const map = new Map<string, { total: number; count: number; received: number }>();
    filteredPOs.forEach(po => {
      const name = po.supplier_name || 'Outros';
      if (!map.has(name)) map.set(name, { total: 0, count: 0, received: 0 });
      const entry = map.get(name)!;
      entry.total += Number(po.total_value || 0);
      entry.count++;
      if (po.status === 'received') entry.received++;
    });
    return Array.from(map).map(([name, data]) => ({
      name,
      volume: data.total,
      pedidos: data.count,
      entregaPct: data.count > 0 ? Math.round((data.received / data.count) * 100) : 0,
    })).sort((a, b) => b.volume - a.volume).slice(0, 10);
  }, [filteredPOs]);

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-4">
        <Tabs value={period} onValueChange={setPeriod}>
          <TabsList>
            <TabsTrigger value="1m">1 mês</TabsTrigger>
            <TabsTrigger value="3m">3 meses</TabsTrigger>
            <TabsTrigger value="6m">6 meses</TabsTrigger>
            <TabsTrigger value="1y">1 ano</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-primary" />
              <p className="text-xs text-muted-foreground">Total Compras</p>
            </div>
            <p className="text-xl font-bold">{fmt(totalSpending)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-orange-500" />
              <p className="text-xs text-muted-foreground">CPV (COGS)</p>
            </div>
            <p className="text-xl font-bold">{fmt(totalCogs)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <p className="text-xs text-muted-foreground">Receita</p>
            </div>
            <p className="text-xl font-bold">{fmt(totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              {marginPct >= 0 ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
              <p className="text-xs text-muted-foreground">Margem Bruta</p>
            </div>
            <p className={`text-xl font-bold ${marginPct >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              {marginPct.toFixed(1)}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Spending Trend */}
        <Card>
          <CardHeader><CardTitle className="text-base">Tendência de Custos</CardTitle></CardHeader>
          <CardContent>
            {monthlyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis className="text-xs" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend />
                  <Area type="monotone" dataKey="spending" name="Compras" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.1} />
                  <Area type="monotone" dataKey="cogs" name="CPV" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.1} />
                  <Area type="monotone" dataKey="revenue" name="Receita" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3))" fillOpacity={0.1} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">Sem dados no período</p>
            )}
          </CardContent>
        </Card>

        {/* Spending by Supplier (Pie) */}
        <Card>
          <CardHeader><CardTitle className="text-base">Gastos por Fornecedor</CardTitle></CardHeader>
          <CardContent>
            {spendingBySupplier.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={spendingBySupplier} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {spendingBySupplier.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">Sem dados de compras</p>
            )}
          </CardContent>
        </Card>

        {/* Cost Variance */}
        <Card>
          <CardHeader><CardTitle className="text-base">Variação de Custos (Padrão vs Real)</CardTitle></CardHeader>
          <CardContent>
            {varianceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={varianceData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend />
                  <Bar dataKey="padrão" name="Custo Padrão" fill="hsl(var(--primary))" />
                  <Bar dataKey="real" name="Custo Real" fill="hsl(var(--chart-2))" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">Sem relatórios de variância</p>
            )}
          </CardContent>
        </Card>

        {/* Supplier Performance */}
        <Card>
          <CardHeader><CardTitle className="text-base">Performance de Fornecedores</CardTitle></CardHeader>
          <CardContent>
            {supplierPerformance.length > 0 ? (
              <div className="space-y-3 max-h-[280px] overflow-auto">
                {supplierPerformance.map(s => (
                  <div key={s.name} className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0">
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.pedidos} pedidos</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{fmt(s.volume)}</p>
                      <Badge variant={s.entregaPct >= 80 ? 'default' : s.entregaPct >= 50 ? 'secondary' : 'destructive'} className="text-xs">
                        {s.entregaPct}% entregue
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">Sem dados de fornecedores</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown */}
      <Card>
        <CardHeader><CardTitle className="text-base">Valor em Estoque por Categoria</CardTitle></CardHeader>
        <CardContent>
          {spendingByCategory.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={spendingByCategory} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} className="text-xs" />
                <YAxis type="category" dataKey="name" width={120} className="text-xs" />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="value" name="Valor" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">Sem dados de categorias</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

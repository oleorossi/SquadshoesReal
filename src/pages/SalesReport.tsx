import AppLayout from "@/components/layout/AppLayout";
import { useState, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import {
  BarChart3, Filter, Users, Palette, ShoppingBag, TrendingUp,
  Award, Layers, Package, Crown, Loader2, AlertTriangle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useRepresentatives } from '@/hooks/useRepresentatives';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { cn } from '@/lib/utils';

const COLORS = [
  '#0EA5E9', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', 
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

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


function useAllSaleOrderItems() {
  return useQuery({
    queryKey: ['all_sale_order_items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_order_items')
        .select('*, technical_sheets(name, code, shoe_category, colors), sale_orders(representative_id, representative, client_name, status, created_at)');
      if (error) throw error;
      return data;
    },
  });
}

 function RankingTable({ data, columns }: {
   data: { label: string; value: number; extra?: string }[];
   columns: [string, string, string?];
 }) {
   return (
     <div className="rounded-md border overflow-hidden">
       <div className="overflow-x-auto">
         <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs w-8">#</TableHead>
            <TableHead className="text-xs">{columns[0]}</TableHead>
            <TableHead className="text-xs text-right">{columns[1]}</TableHead>
            {columns[2] && <TableHead className="text-xs text-right">{columns[2]}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow><TableCell colSpan={columns[2] ? 4 : 3} className="text-center text-muted-foreground py-8 text-sm">Sem dados</TableCell></TableRow>
          ) : data.map((d, i) => (
            <TableRow key={d.label}>
              <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="text-sm font-medium">{d.label}</TableCell>
              <TableCell className="text-right font-mono text-sm">{d.value.toLocaleString('pt-BR')}</TableCell>
              {columns[2] && <TableCell className="text-right text-xs text-muted-foreground">{d.extra || ''}</TableCell>}
            </TableRow>
          ))}
         </TableBody>
       </Table>
       </div>
     </div>
  );
}

export default function SalesReport() {
  const { data: orders = [], isLoading: loadOrders, isError: errOrders } = useSaleOrders();
  const { data: reps = [] } = useRepresentatives();
  const { data: allItems = [], isLoading: loadItems, isError: errItems } = useAllSaleOrderItems();
  const [repFilter, setRepFilter] = usePersistedState<string>('repFilter', 'all');
  const [dateFrom, setDateFrom] = usePersistedState('dateFrom', '');
  const [dateTo, setDateTo] = usePersistedState('dateTo', '');
  const [statusFilter, setStatusFilter] = usePersistedState<string>('statusFilter', 'all');
  const [tab, setTab] = usePersistedState('tab', 'overview');

  const isLoading = loadOrders || loadItems;
  const isError = errOrders || errItems;

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (repFilter !== 'all') {
        if (o.representative_id !== repFilter && o.representative !== reps.find(r => r.id === repFilter)?.name) return false;
      }
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (dateFrom && o.created_at.slice(0, 10) < dateFrom) return false;
      if (dateTo && o.created_at.slice(0, 10) > dateTo) return false;
      return true;
    });
  }, [orders, repFilter, statusFilter, dateFrom, dateTo, reps]);

  const filteredOrderIds = useMemo(() => new Set(filtered.map(o => o.id)), [filtered]);

  const filteredItems = useMemo(() => {
    return allItems.filter(item => filteredOrderIds.has(item.sale_order_id));
  }, [allItems, filteredOrderIds]);

  const totalSales = filtered.reduce((s, o) => s + Number(o.total), 0);
  const totalCommission = filtered.reduce((s, o) => s + Number((o as any).commission_value || 0), 0);
  const totalPairs = filteredItems.reduce((s, i) => s + i.quantity, 0);

  const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  // --- Analytics ---
  const repSummary = useMemo(() => {
    const map = new Map<string, { name: string; total: number; commission: number; count: number; pairs: number }>();
    filtered.forEach(o => {
      const repId = (o as any).representative_id || 'sem_rep';
      const repName = o.representative || 'Sem representante';
      const existing = map.get(repId) || { name: repName, total: 0, commission: 0, count: 0, pairs: 0 };
      existing.total += Number(o.total);
      existing.commission += Number((o as any).commission_value || 0);
      existing.count += 1;
      map.set(repId, existing);
    });
    // Add pairs
    filteredItems.forEach(item => {
      const so = (item as any).sale_orders;
      const repId = so?.representative_id || 'sem_rep';
      const existing = map.get(repId);
      if (existing) existing.pairs += item.quantity;
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered, filteredItems]);

  const topModels = useMemo(() => {
    const map = new Map<string, { label: string; value: number; revenue: number }>();
    filteredItems.forEach(item => {
      const ref = (item as any).technical_sheets;
      const name = ref?.name || 'Desconhecido';
      const code = ref?.code || '';
      const key = name;
      const existing = map.get(key) || { label: code ? `${name} (${code})` : name, value: 0, revenue: 0 };
      existing.value += item.quantity;
      existing.revenue += item.quantity * Number(item.unit_price);
      map.set(key, existing);
    });
    return Array.from(map.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
      .map(d => ({ ...d, extra: fmt(d.revenue) }));
  }, [filteredItems]);

  const topColors = useMemo(() => {
    const map = new Map<string, number>();
    filteredItems.forEach(item => {
      const color = item.color || (item as any).technical_sheets?.colors || 'Sem cor';
      const colors = color.split(',').map((c: string) => c.trim()).filter(Boolean);
      colors.forEach((c: string) => {
        map.set(c, (map.get(c) || 0) + item.quantity);
      });
    });
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);
  }, [filteredItems]);

  const topCategories = useMemo(() => {
    const map = new Map<string, number>();
    filteredItems.forEach(item => {
      const cat = (item as any).technical_sheets?.shoe_category || 'Sem categoria';
      map.set(cat, (map.get(cat) || 0) + item.quantity);
    });
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredItems]);

  // ABC analysis on models
  const abcAnalysis = useMemo(() => {
    const sorted = [...topModels].sort((a, b) => b.value - a.value);
    const total = sorted.reduce((s, d) => s + d.value, 0);
    let acc = 0;
    return sorted.map(d => {
      acc += d.value;
      const pct = total > 0 ? (acc / total) * 100 : 0;
      const cls = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
      return { ...d, pct: Math.round(pct), cls };
    });
  }, [topModels]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="font-semibold text-foreground">Falha ao carregar dados</p>
        <p className="text-sm text-muted-foreground">Verifique sua conexão e recarregue a página.</p>
      </div>
    );
  }

  return (
    
      <div className="space-y-5 page-enter">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6" /> Relatórios de Vendas
          </h1>
          <p className="text-sm text-muted-foreground">Análise detalhada de vendas, modelos, cores e representantes</p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Representante</Label>
                <Select value={repFilter} onValueChange={setRepFilter}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {reps.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="Pendente">Pendente</SelectItem>
                    <SelectItem value="Aprovado">Aprovado</SelectItem>
                    <SelectItem value="Em Produção">Em Produção</SelectItem>
                    <SelectItem value="Faturado">Faturado</SelectItem>
                    <SelectItem value="Cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">De</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs">Até</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="mt-1 h-9" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-lg font-bold font-mono">{fmt(totalSales)}</p>
                <p className="text-[10px] text-muted-foreground">Total Vendas</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-warning/15 flex items-center justify-center">
                <Crown className="h-4 w-4 text-warning" />
              </div>
              <div>
                <p className="text-lg font-bold font-mono">{fmt(totalCommission)}</p>
                <p className="text-[10px] text-muted-foreground">Comissões</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-success/15 flex items-center justify-center">
                <ShoppingBag className="h-4 w-4 text-success" />
              </div>
              <div>
                <p className="text-lg font-bold font-mono">{filtered.length}</p>
                <p className="text-[10px] text-muted-foreground">Pedidos</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                <Package className="h-4 w-4 text-violet-500" />
              </div>
              <div>
                <p className="text-lg font-bold font-mono">{totalPairs.toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-muted-foreground">Total Pares</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="overview" className="gap-1.5 text-xs"><BarChart3 className="h-3.5 w-3.5" /> Visão Geral</TabsTrigger>
            <TabsTrigger value="reps" className="gap-1.5 text-xs"><Users className="h-3.5 w-3.5" /> Representantes</TabsTrigger>
            <TabsTrigger value="models" className="gap-1.5 text-xs"><ShoppingBag className="h-3.5 w-3.5" /> Modelos</TabsTrigger>
            <TabsTrigger value="colors" className="gap-1.5 text-xs"><Palette className="h-3.5 w-3.5" /> Cores</TabsTrigger>
            <TabsTrigger value="abc" className="gap-1.5 text-xs"><Award className="h-3.5 w-3.5" /> Curva ABC</TabsTrigger>
            <TabsTrigger value="orders" className="gap-1.5 text-xs"><Layers className="h-3.5 w-3.5" /> Pedidos</TabsTrigger>
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4 text-primary" /> Top 10 Modelos (pares)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {topModels.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">Sem dados</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={topModels.slice(0, 10)} layout="vertical" margin={{ left: 10, right: 30, top: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={140} axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip formatter={(v: number) => `${v} pares`} />} />
                        <Bar dataKey="value" fill={COLORS[0]} radius={[0, 4, 4, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Palette className="h-4 w-4 text-primary" /> Cores mais Vendidas
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-center">
                  {topColors.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">Sem dados</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={topColors.slice(0, 10).map(c => ({ name: c.label, value: c.value }))}
                          dataKey="value" nameKey="name"
                          cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3}
                          stroke="none"
                        >
                          {topColors.slice(0, 10).map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip formatter={(v: number) => `${v} pares`} />} />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Category chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" /> Vendas por Categoria
                </CardTitle>
              </CardHeader>
              <CardContent>
                {topCategories.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Sem dados</p>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={topCategories} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip formatter={(v: number) => `${v} pares`} />} />
                      <Bar dataKey="value" fill={COLORS[2]} radius={[4, 4, 0, 0]} barSize={30} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* REPRESENTATIVES */}
          <TabsContent value="reps" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Ranking de Representantes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs w-8">#</TableHead>
                        <TableHead className="text-xs">Representante</TableHead>
                        <TableHead className="text-xs text-center">Pedidos</TableHead>
                        <TableHead className="text-xs text-right">Pares</TableHead>
                        <TableHead className="text-xs text-right">Total Vendas</TableHead>
                        <TableHead className="text-xs text-right">Comissão</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {repSummary.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Sem dados</TableCell></TableRow>
                      ) : repSummary.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-medium text-sm">{r.name}</TableCell>
                          <TableCell className="text-center"><Badge variant="outline" className="text-xs">{r.count}</Badge></TableCell>
                          <TableCell className="text-right font-mono text-sm">{r.pairs.toLocaleString('pt-BR')}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(r.total)}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-warning">{fmt(r.commission)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Rep bar chart */}
            {repSummary.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Vendas por Representante</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={repSummary.map(r => ({ name: r.name, vendas: r.total, comissao: r.commission }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v: number) => fmt(v)} />
                      <Bar dataKey="vendas" name="Vendas" fill="hsl(35, 92%, 50%)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="comissao" name="Comissão" fill="hsl(38, 92%, 70%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* MODELS */}
          <TabsContent value="models" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Ranking de Modelos por Quantidade</CardTitle>
                </CardHeader>
                <CardContent>
                  <RankingTable
                    data={topModels}
                    columns={['Modelo', 'Pares', 'Faturamento']}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Gráfico de Modelos</CardTitle>
                </CardHeader>
                <CardContent>
                  {topModels.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">Sem dados</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={topModels.slice(0, 10)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={140} />
                        <Tooltip formatter={(v: number) => `${v} pares`} />
                        <Bar dataKey="value" fill="hsl(35, 92%, 50%)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* COLORS */}
          <TabsContent value="colors" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Ranking de Cores</CardTitle>
                </CardHeader>
                <CardContent>
                  <RankingTable
                    data={topColors}
                    columns={['Cor', 'Pares']}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Distribuição de Cores</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-center">
                  {topColors.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8">Sem dados</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <PieChart>
                        <Pie
                          data={topColors.slice(0, 10).map(c => ({ name: c.label, value: c.value }))}
                          dataKey="value" nameKey="name"
                          cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}
                          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        >
                          {topColors.slice(0, 10).map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Categories breakdown */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Vendas por Categoria de Calçado</CardTitle>
              </CardHeader>
              <CardContent>
                <RankingTable
                  data={topCategories.map(c => ({ ...c, extra: `${totalPairs > 0 ? ((c.value / totalPairs) * 100).toFixed(1) : 0}%` }))}
                  columns={['Categoria', 'Pares', '% do Total']}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABC */}
          <TabsContent value="abc" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Award className="h-4 w-4 text-primary" /> Curva ABC — Modelos Vendidos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs w-8">#</TableHead>
                        <TableHead className="text-xs">Modelo</TableHead>
                        <TableHead className="text-xs text-right">Pares</TableHead>
                        <TableHead className="text-xs text-right">% Acum.</TableHead>
                        <TableHead className="text-xs text-center">Classe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {abcAnalysis.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sem dados</TableCell></TableRow>
                      ) : abcAnalysis.map((d, i) => (
                        <TableRow key={d.label}>
                          <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="text-sm font-medium">{d.label}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{d.value.toLocaleString('pt-BR')}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{d.pct}%</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className={cn(
                              'text-xs font-bold',
                              d.cls === 'A' && 'bg-success/15 text-success border-success/30',
                              d.cls === 'B' && 'bg-warning/15 text-warning border-warning/30',
                              d.cls === 'C' && 'bg-muted text-muted-foreground',
                            )}>
                              {d.cls}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                  <span><Badge variant="outline" className="bg-success/15 text-success border-success/30 text-[10px] mr-1">A</Badge> 0–80% (itens essenciais)</span>
                  <span><Badge variant="outline" className="bg-warning/15 text-warning border-warning/30 text-[10px] mr-1">B</Badge> 80–95% (intermediários)</span>
                  <span><Badge variant="outline" className="bg-muted text-muted-foreground text-[10px] mr-1">C</Badge> 95–100% (baixo impacto)</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ORDERS DETAIL */}
          <TabsContent value="orders" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Detalhamento de Pedidos ({filtered.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-hidden overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs">Nº Pedido</TableHead>
                        <TableHead className="text-xs">Cliente</TableHead>
                        <TableHead className="text-xs">Representante</TableHead>
                        <TableHead className="text-xs text-right">Total</TableHead>
                        <TableHead className="text-xs text-right">Comissão</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum pedido encontrado</TableCell></TableRow>
                      ) : filtered.map(o => (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-xs">{o.order_number || '—'}</TableCell>
                          <TableCell className="text-xs font-medium">{o.client_name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{o.representative || '—'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmt(Number(o.total))}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmt(Number((o as any).commission_value || 0))}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn(
                              'text-[10px]',
                              o.status === 'Pendente' && 'bg-warning/10 text-warning border-warning/30',
                              o.status === 'Aprovado' && 'bg-success/10 text-success border-success/30',
                              o.status === 'Faturado' && 'bg-primary/10 text-primary border-primary/30',
                              o.status === 'Cancelado' && 'bg-destructive/10 text-destructive border-destructive/30',
                            )}>
                              {o.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString('pt-BR')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    
  );
}

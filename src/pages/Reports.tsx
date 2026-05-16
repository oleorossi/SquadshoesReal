import { useMemo, useState } from 'react';
import { ShoppingCart, TrendUp as TrendingUp, CurrencyDollar as DollarSign, Percent, Package, Warning as AlertTriangle, Clock, FileText, Download, Funnel as Filter, Calendar, ChartBar as BarChart3, ChartPie as PieChartIcon, MapTrifold as Map, Users, ArrowUpRight, ArrowDownRight, CircleNotch as Loader2, ArrowsClockwise as RefreshCw, FileXls as FileSpreadsheet, Printer, Envelope as Mail, CaretRight as ChevronRight, Pulse as Activity, Stack as Layers, MagnifyingGlassMinus as SearchX } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useOrders } from '@/hooks/useOrders';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useProducts } from '@/hooks/useProducts';
import { useClients } from '@/hooks/useClients';
import { useAccountsPayable, useAccountsReceivable } from '@/hooks/useFinance';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line, Legend
} from 'recharts';
import { format, subDays, startOfMonth, endOfMonth, isAfter, isBefore, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  exportTemplateExcel, exportTemplatePDF, exportDashboardExcel,
  exportDashboardPDF, type ReportData,
} from '@/lib/exportReports';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

const CHART_COLORS = ['#0EA5E9', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];

const CustomTooltip = ({ active, payload, label, formatter }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-background/95 border border-border p-3 rounded-lg shadow-lg backdrop-blur-sm">
        {label && <p className="text-xs font-bold mb-1.5 text-muted-foreground">{label}</p>}
        <div className="space-y-1">
          {payload.map((item: any, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color || item.fill }} />
              <p className="text-xs font-medium">
                <span className="text-muted-foreground">{item.name}:</span>{' '}
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

function KpiCard({ title, value, icon: Icon, trend, trendLabel, variant = 'default' }: {
  title: string; value: string | number; icon: any;
  trend?: 'up' | 'down' | 'neutral'; trendLabel?: string;
  variant?: 'default' | 'warning' | 'success' | 'destructive';
}) {
  return (
    <StatCard
      label={title}
      value={value}
      icon={Icon}
      tone={variant === 'default' ? 'primary' : variant}
      hint={trendLabel}
      deltaTone={trend}
    />
  );
}

const REPORT_TEMPLATES = [
  { id: 'sales-summary', name: 'Resumo de Vendas', icon: ShoppingCart, description: 'Vendas por período, cliente e produto', category: 'comercial' },
  { id: 'production-report', name: 'Relatório de Produção', icon: Layers, description: 'OPs por status, setor e eficiência', category: 'producao' },
  { id: 'stock-position', name: 'Posição de Estoque', icon: Package, description: 'Estoque atual, mínimos e giro', category: 'estoque' },
  { id: 'financial-summary', name: 'Resumo Financeiro', icon: DollarSign, description: 'Contas a pagar/receber e fluxo de caixa', category: 'financeiro' },
  { id: 'client-ranking', name: 'Ranking de Clientes', icon: Users, description: 'Top clientes por faturamento e volume', category: 'comercial' },
  { id: 'delayed-orders', name: 'Pedidos Atrasados', icon: AlertTriangle, description: 'Pedidos e OPs com prazo vencido', category: 'producao' },
];

export default function Reports() {
  const { data: orders = [], isLoading: l1, isError: e1, refetch: r1 } = useOrders();
  const { data: saleOrders = [], isLoading: l2, isError: e2, refetch: r2 } = useSaleOrders();
  const { data: products = [], isLoading: l3, isError: e3, refetch: r3 } = useProducts();
  const { data: clients = [] } = useClients();
  const { data: payables = [] } = useAccountsPayable();
  const { data: receivables = [] } = useAccountsReceivable();

  const [period, setPeriod] = useState('30d');
  const [reportCategory, setReportCategory] = useState('all');
  const isLoading = l1 || l2 || l3;
  const isError = e1 || e2 || e3;

  const today = new Date();
  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
  const periodStart = subDays(today, periodDays);

  const metrics = useMemo(() => {
    const recentSales = saleOrders.filter(s => {
      try { return isAfter(parseISO(s.created_at), periodStart); } catch { return false; }
    });
    const totalRevenue = recentSales.reduce((sum, s) => sum + (s.total || 0), 0);
    const avgOrderValue = recentSales.length > 0 ? totalRevenue / recentSales.length : 0;
    const recentOrders = orders.filter(o => {
      try { return isAfter(parseISO(o.created_at), periodStart); } catch { return false; }
    });
    const COMPLETED = ['concluída', 'concluído', 'completed', 'finalizado'];
    const completedOrders = recentOrders.filter(o => COMPLETED.includes((o.status || '').toLowerCase()));
    const conversionRate = recentOrders.length > 0 ? (completedOrders.length / recentOrders.length) * 100 : 0;

    return {
      ordersToday: recentSales.length,
      revenueToday: totalRevenue,
      avgOrderValue,
      conversionRate,
    };
  }, [saleOrders, orders, periodStart]);

  // Orders trend by week
  const ordersTrend = useMemo(() => {
    const weeks: Record<string, { name: string; pedidos: number; faturamento: number }> = {};
    saleOrders.forEach(s => {
      try {
        const d = parseISO(s.created_at);
        if (isBefore(d, periodStart)) return;
        const weekKey = format(d, "'Sem' w", { locale: ptBR });
        if (!weeks[weekKey]) weeks[weekKey] = { name: weekKey, pedidos: 0, faturamento: 0 };
        weeks[weekKey].pedidos++;
        weeks[weekKey].faturamento += (s.total || 0);
      } catch {}
    });
    return Object.values(weeks).slice(-8);
  }, [saleOrders, periodStart]);

  // Top products from sale order items
  const topProducts = useMemo(() => {
    const prodMap: Record<string, { name: string; qty: number }> = {};
    saleOrders.forEach(s => {
      const items = (s as any).items;
      if (Array.isArray(items)) {
        items.forEach((item: any) => {
          const name = item.reference_name || item.product_name || 'Sem nome';
          if (!prodMap[name]) prodMap[name] = { name, qty: 0 };
          prodMap[name].qty += (item.quantity || 0);
        });
      }
    });
    return Object.values(prodMap).sort((a, b) => b.qty - a.qty).slice(0, 6);
  }, [saleOrders]);

  // Client segments
  const clientSegments = useMemo(() => {
    const segMap: Record<string, number> = {};
    saleOrders.forEach(s => {
      const state = (s as any).client_state || (s as any).estado || 'Outros';
      segMap[state] = (segMap[state] || 0) + 1;
    });
    return Object.entries(segMap)
      .map(([name, value]) => ({ name: name || 'Outros', value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [saleOrders]);

  // Alerts
  const alerts = useMemo(() => {
    const lowStock = products.filter(p => p.active && p.min_stock && p.quantity < p.min_stock).length;
    const ACTIVE_PROD_STATUSES = new Set(['aprovado', 'em produção']);
    const delayedOrders = saleOrders.filter(s => {
      try {
        return ACTIVE_PROD_STATUSES.has((s.status || '').toLowerCase()) &&
          s.delivery_deadline && isBefore(parseISO(s.delivery_deadline), today);
      } catch { return false; }
    }).length;
    const overduePayables = payables.filter(p => {
      try { return p.status !== 'paid' && isBefore(parseISO(p.due_date), today); } catch { return false; }
    }).length;
    return { lowStock, delayedOrders, overduePayables };
  }, [products, saleOrders, payables, today]);

  // Production status distribution
  const productionStatus = useMemo(() => {
    const CANONICAL: Record<string, string> = {
      'em produção': 'Em Produção', 'concluída': 'Concluída', 'concluído': 'Concluída',
    };
    const statusMap: Record<string, number> = {};
    orders.forEach(o => {
      const raw = o.status || 'Indefinido';
      const st = CANONICAL[raw.toLowerCase()] ?? raw;
      statusMap[st] = (statusMap[st] || 0) + 1;
    });
    return Object.entries(statusMap).map(([name, value]) => ({ name, value }));
  }, [orders]);

  const filteredTemplates = reportCategory === 'all'
    ? REPORT_TEMPLATES
    : REPORT_TEMPLATES.filter(t => t.category === reportCategory);

  const reportData: ReportData = { saleOrders, orders, products, clients, payables, receivables };

  const handleGenerateReport = (template: typeof REPORT_TEMPLATES[0]) => {
    try {
      exportTemplateExcel(template.id, reportData);
      toast.success(`Relatório "${template.name}" exportado!`, { description: 'Download iniciado.' });
    } catch {
      toast.error('Erro ao gerar relatório. Tente novamente.');
    }
  };

  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
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
    <div className="space-y-5 page-enter p-1">
      {/* Header */}
      <EditorialPageHeader
        sectionLabel="RELATÓRIOS · GERAL"
        title="Analytics & Relatórios"
        description="Métricas em tempo real e geração inteligente de relatórios"
        actions={
          <>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[130px] h-9 text-xs">
                <Calendar className="h-3.5 w-3.5 mr-1.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 dias</SelectItem>
                <SelectItem value="30d">30 dias</SelectItem>
                <SelectItem value="90d">90 dias</SelectItem>
                <SelectItem value="365d">12 meses</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => { r1(); r2(); r3(); toast.success('Dados atualizados'); }}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </>
        }
      />

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard" className="gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />Painel
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />Relatórios
          </TabsTrigger>
        </TabsList>

        {/* ========== DASHBOARD TAB ========== */}
        <TabsContent value="dashboard" className="space-y-6">
          {/* KPI Cards */}
          <StatGrid>
            <KpiCard title="Pedidos no Período" value={metrics.ordersToday} icon={ShoppingCart}
              trend="up" trendLabel={`últimos ${periodDays}d`} variant="default" />
            <KpiCard title="Faturamento" value={formatCurrency(metrics.revenueToday)} icon={DollarSign}
              trend="up" trendLabel="total do período" variant="success" />
            <KpiCard title="Ticket Médio" value={formatCurrency(metrics.avgOrderValue)} icon={TrendingUp}
              trendLabel="por pedido" variant="default" />
            <KpiCard title="Taxa de Conclusão" value={`${metrics.conversionRate.toFixed(1)}%`} icon={Percent}
              trendLabel="OPs concluídas" variant={metrics.conversionRate > 50 ? 'success' : 'warning'} />
          </StatGrid>

          {/* Alerts Banner */}
          {(alerts.lowStock > 0 || alerts.delayedOrders > 0 || alerts.overduePayables > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {alerts.lowStock > 0 && (
                <Card className="border-warning/30 bg-warning/5">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="bg-warning/15 rounded-lg p-2"><Package className="h-4 w-4 text-warning" /></div>
                    <div>
                      <p className="text-sm font-semibold">{alerts.lowStock} itens</p>
                      <p className="text-xs text-muted-foreground">Estoque baixo</p>
                    </div>
                  </CardContent>
                </Card>
              )}
              {alerts.delayedOrders > 0 && (
                <Card className="border-destructive/30 bg-destructive/5">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="bg-destructive/15 rounded-lg p-2"><Clock className="h-4 w-4 text-destructive" /></div>
                    <div>
                      <p className="text-sm font-semibold">{alerts.delayedOrders} pedidos</p>
                      <p className="text-xs text-muted-foreground">Atrasados</p>
                    </div>
                  </CardContent>
                </Card>
              )}
              {alerts.overduePayables > 0 && (
                <Card className="border-destructive/30 bg-destructive/5">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="bg-destructive/15 rounded-lg p-2"><AlertTriangle className="h-4 w-4 text-destructive" /></div>
                    <div>
                      <p className="text-sm font-semibold">{alerts.overduePayables} contas</p>
                      <p className="text-xs text-muted-foreground">Vencidas</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Orders Trend */}
            <Panel title={<span className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" />Tendência de Pedidos</span>}>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={ordersTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 10 }} />
                    <YAxis className="text-xs" tick={{ fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="pedidos" stroke="hsl(var(--stage-cut-fg))" fill="hsl(var(--stage-cut-fg))" fillOpacity={0.15} name="Pedidos" />
                  </AreaChart>
                </ResponsiveContainer>
            </Panel>

            {/* Revenue Trend */}
            <Panel title={<span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-success" />Faturamento por Semana</span>}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={ordersTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 10 }} />
                    <YAxis className="text-xs" tick={{ fontSize: 10 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip content={<CustomTooltip formatter={(v: number) => formatCurrency(v)} />} />
                    <Bar dataKey="faturamento" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} name="Faturamento" />
                  </BarChart>
                </ResponsiveContainer>
            </Panel>

            {/* Production Status */}
            <Panel title={<span className="flex items-center gap-2"><PieChartIcon className="h-4 w-4 text-primary" />Status de Produção</span>}>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={productionStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={85}
                      paddingAngle={3} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {productionStatus.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
            </Panel>

            {/* Client Segments */}
            <Panel title={<span className="flex items-center gap-2"><Map className="h-4 w-4 text-primary" />Distribuição por Estado</span>}>
                {clientSegments.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={clientSegments} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={60} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="value" fill="hsl(var(--stage-sew-fg))" radius={[0, 4, 4, 0]} name="Pedidos" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">
                    Sem dados de distribuição geográfica
                  </div>
                )}
            </Panel>
          </div>

          {/* Top Products */}
          {topProducts.length > 0 && (
            <Panel title={<span className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" />Top Produtos</span>}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={topProducts}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="qty" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} name="Quantidade" />
                  </BarChart>
                </ResponsiveContainer>
            </Panel>
          )}
        </TabsContent>

        {/* ========== REPORTS TAB ========== */}
        <TabsContent value="reports" className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Gerador de Relatórios</h2>
              <p className="text-xs text-muted-foreground">Selecione um template para gerar o relatório</p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={reportCategory} onValueChange={setReportCategory}>
                <SelectTrigger className="w-[150px] h-9 text-xs">
                  <Filter className="h-3.5 w-3.5 mr-1.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas categorias</SelectItem>
                  <SelectItem value="comercial">Comercial</SelectItem>
                  <SelectItem value="producao">Produção</SelectItem>
                  <SelectItem value="estoque">Estoque</SelectItem>
                  <SelectItem value="financeiro">Financeiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredTemplates.length === 0 ? (
              <div className="col-span-full">
                <Panel flush>
                  <EmptyState
                    icon={SearchX}
                    title="Nenhum relatório encontrado"
                    description="Tente ajustar os filtros de categoria ou busca."
                  />
                </Panel>
              </div>
            ) : filteredTemplates.map(template => {
              const Icon = template.icon;
              return (
                <Card key={template.id} className="hover:shadow-md transition-all group cursor-pointer"
                  onClick={() => handleGenerateReport(template)}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="bg-primary/10 rounded-lg p-2.5 group-hover:bg-primary/20 transition-colors">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">{template.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline" className="text-[10px]">{template.category}</Badge>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Export Options */}
          <Panel eyebrow="RELATÓRIOS · GERAL" title="Opções de Exportação">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                  try { exportDashboardPDF(reportData, { ordersToday: metrics.ordersToday, revenueToday: metrics.revenueToday, conversionRate: metrics.conversionRate }); toast.success('PDF gerado!'); }
                  catch { toast.error('Erro ao gerar PDF.'); }
                }}>
                  <Download className="h-3.5 w-3.5" />PDF
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                  try { exportDashboardExcel(reportData); toast.success('Excel gerado!'); }
                  catch { toast.error('Erro ao gerar Excel.'); }
                }}>
                  <FileSpreadsheet className="h-3.5 w-3.5" />Excel
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" />Imprimir
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                  const subject = encodeURIComponent('Relatório Analytics — Squad Shoes');
                  const body = encodeURIComponent(
                    `Período: últimos ${periodDays} dias\n\nPedidos: ${metrics.ordersToday}\nFaturamento: ${metrics.revenueToday.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\nTaxa conclusão: ${metrics.conversionRate.toFixed(1)}%\n\nGerado em ${new Date().toLocaleString('pt-BR')}`
                  );
                  window.open(`mailto:?subject=${subject}&body=${body}`);
                }}>
                  <Mail className="h-3.5 w-3.5" />Email
                </Button>
              </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export const Component = Reports;

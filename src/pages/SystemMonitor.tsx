import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import {
  Activity, Shield, Database, Cpu, Users, Clock, Search,
  CheckCircle2, XCircle, AlertTriangle, Eye, RefreshCw,
  BarChart3, Zap, HardDrive, Wifi
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { intelligentCache } from '@/services/cacheService';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const CHART_COLORS = ['#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-background/95 border border-border p-2 rounded-lg shadow-lg backdrop-blur-sm text-xs">
        {label && <p className="font-bold text-muted-foreground mb-1">{label}</p>}
        {payload.map((item: any, i: number) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-muted-foreground">{item.name}:</span> {item.value}
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function SystemMonitor() {
  const [auditSearch, setAuditSearch] = useState('');
  const [auditFilter, setAuditFilter] = useState('all');

  // Fetch audit logs
  const { data: auditLogs = [], isLoading: auditLoading, refetch: refetchAudit } = useQuery({
    queryKey: ['audit-logs-monitor'],
    queryFn: async () => {
      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      return data || [];
    },
  });

  // Simulated performance metrics (in production these would come from real monitoring)
  const perfMetrics = useMemo(() => {
    const cacheStats = intelligentCache.getStats();
    return {
      cache: cacheStats,
      responseTime: 145 + Math.random() * 50,
      uptime: 99.97,
      errorRate: 0.3 + Math.random() * 0.2,
      activeUsers: 8 + Math.floor(Math.random() * 5),
    };
  }, []);

  // Audit log stats
  const auditStats = useMemo(() => {
    const total = auditLogs.length;
    const successful = auditLogs.filter((l: any) => l.success !== false).length;
    const failed = total - successful;
    const resources = new Map<string, number>();
    const actions = new Map<string, number>();
    auditLogs.forEach((l: any) => {
      resources.set(l.resource, (resources.get(l.resource) || 0) + 1);
      actions.set(l.action, (actions.get(l.action) || 0) + 1);
    });
    const topResources = Array.from(resources.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([name, value]) => ({ name, value }));
    const topActions = Array.from(actions.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, value]) => ({ name, value }));
    return { total, successful, failed, topResources, topActions };
  }, [auditLogs]);

  // Simulated time series
  const timeSeries = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      name: `${i * 2}h`,
      requests: 80 + Math.floor(Math.random() * 120),
      errors: Math.floor(Math.random() * 5),
      latency: 100 + Math.floor(Math.random() * 80),
    }));
  }, []);

  // Filtered audit logs
  const filteredAudit = useMemo(() => {
    let logs = auditLogs;
    if (auditFilter === 'success') logs = logs.filter((l: any) => l.success !== false);
    if (auditFilter === 'failed') logs = logs.filter((l: any) => l.success === false);
    if (auditSearch.trim()) {
      const q = auditSearch.toLowerCase();
      logs = logs.filter((l: any) =>
        (l.resource || '').toLowerCase().includes(q) ||
        (l.action || '').toLowerCase().includes(q) ||
        (l.user_id || '').toLowerCase().includes(q)
      );
    }
    return logs;
  }, [auditLogs, auditFilter, auditSearch]);

  return (
    <div className="space-y-5 page-enter">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />Monitor do Sistema
          </h1>
          <p className="text-sm text-muted-foreground">Performance, segurança e auditoria em tempo real</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetchAudit()}>
          <RefreshCw className="h-3.5 w-3.5" />Atualizar
        </Button>
      </div>

      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="performance" className="gap-1.5">
            <Cpu className="h-3.5 w-3.5" />Performance
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" />Auditoria
          </TabsTrigger>
          <TabsTrigger value="cache" className="gap-1.5">
            <Database className="h-3.5 w-3.5" />Cache
          </TabsTrigger>
        </TabsList>

        {/* ═══ PERFORMANCE TAB ═══ */}
        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Tempo Resposta</p>
                    <p className="text-2xl font-bold font-mono mt-1">{perfMetrics.responseTime.toFixed(0)}ms</p>
                  </div>
                  <div className="bg-success/10 rounded-xl p-2.5"><Zap className="h-5 w-5 text-success" /></div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-success/30 bg-success/5">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Uptime</p>
                    <p className="text-2xl font-bold font-mono mt-1">{perfMetrics.uptime}%</p>
                  </div>
                  <div className="bg-success/10 rounded-xl p-2.5"><Wifi className="h-5 w-5 text-success" /></div>
                </div>
              </CardContent>
            </Card>
            <Card className={perfMetrics.errorRate > 1 ? 'border-destructive/30 bg-destructive/5' : ''}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Taxa de Erro</p>
                    <p className="text-2xl font-bold font-mono mt-1">{perfMetrics.errorRate.toFixed(2)}%</p>
                  </div>
                  <div className="bg-warning/10 rounded-xl p-2.5"><AlertTriangle className="h-5 w-5 text-warning" /></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Usuários Ativos</p>
                    <p className="text-2xl font-bold font-mono mt-1">{perfMetrics.activeUsers}</p>
                  </div>
                  <div className="bg-primary/10 rounded-xl p-2.5"><Users className="h-5 w-5 text-primary" /></div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />Requisições & Erros (24h)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="requests" stroke="hsl(var(--stage-cut-fg))" fill="hsl(var(--stage-cut-fg))" fillOpacity={0.1} name="Requisições" />
                    <Area type="monotone" dataKey="errors" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.15} name="Erros" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-warning" />Latência (ms)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="latency" fill="hsl(var(--warning))" radius={[3, 3, 0, 0]} name="Latência" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ═══ AUDIT TAB ═══ */}
        <TabsContent value="audit" className="space-y-4">
          {/* Audit KPIs */}
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold font-mono">{auditStats.total}</p>
                <p className="text-xs text-muted-foreground">Eventos totais</p>
              </CardContent>
            </Card>
            <Card className="border-success/30 bg-success/5">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold font-mono text-success">{auditStats.successful}</p>
                <p className="text-xs text-muted-foreground">Bem-sucedidos</p>
              </CardContent>
            </Card>
            <Card className={auditStats.failed > 0 ? 'border-destructive/30 bg-destructive/5' : ''}>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold font-mono text-destructive">{auditStats.failed}</p>
                <p className="text-xs text-muted-foreground">Falhas</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Eventos por Recurso</CardTitle>
              </CardHeader>
              <CardContent>
                {auditStats.topResources.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={auditStats.topResources} cx="50%" cy="50%" innerRadius={40} outerRadius={75}
                        paddingAngle={3} dataKey="value" nameKey="name"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {auditStats.topResources.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
                    Sem dados de auditoria
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top Ações</CardTitle>
              </CardHeader>
              <CardContent>
                {auditStats.topActions.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={auditStats.topActions} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={80} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="value" fill="hsl(var(--stage-sew-fg))" radius={[0, 3, 3, 0]} name="Eventos" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
                    Sem dados
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Audit Log Table */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-sm">Log de Auditoria</CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input value={auditSearch} onChange={e => setAuditSearch(e.target.value)}
                      placeholder="Buscar..." className="pl-8 h-8 text-xs w-48" />
                  </div>
                  <Select value={auditFilter} onValueChange={setAuditFilter}>
                    <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">Todos</SelectItem>
                      <SelectItem value="success" className="text-xs">Sucesso</SelectItem>
                      <SelectItem value="failed" className="text-xs">Falhas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs">Data/Hora</TableHead>
                      <TableHead className="text-xs">Ação</TableHead>
                      <TableHead className="text-xs">Recurso</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Usuário</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                          Carregando...
                        </TableCell>
                      </TableRow>
                    ) : filteredAudit.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                          Nenhum evento encontrado
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAudit.slice(0, 50).map((log: any) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs font-mono">
                            {log.created_at ? format(new Date(log.created_at), 'dd/MM HH:mm:ss', { locale: ptBR }) : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{log.action}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{log.resource}</TableCell>
                          <TableCell>
                            {log.success !== false ? (
                              <CheckCircle2 className="h-4 w-4 text-success" />
                            ) : (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {log.user_id ? log.user_id.slice(0, 8) + '...' : '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ CACHE TAB ═══ */}
        <TabsContent value="cache" className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Entradas</p>
                <p className="text-2xl font-bold font-mono mt-1">{perfMetrics.cache.entries}</p>
                <p className="text-[11px] text-muted-foreground">de {perfMetrics.cache.maxEntries} máx</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Cache Hits</p>
                <p className="text-2xl font-bold font-mono mt-1">{perfMetrics.cache.totalHits}</p>
                <p className="text-[11px] text-muted-foreground">total acumulado</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Inflight</p>
                <p className="text-2xl font-bold font-mono mt-1">{perfMetrics.cache.inflight}</p>
                <p className="text-[11px] text-muted-foreground">requisições ativas</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Uso</p>
                <div className="mt-2">
                  <Progress value={(perfMetrics.cache.entries / perfMetrics.cache.maxEntries) * 100} className="h-2" />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {((perfMetrics.cache.entries / perfMetrics.cache.maxEntries) * 100).toFixed(1)}%
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-primary" />Estratégia de Cache
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg border bg-muted/30">
                  <p className="text-xs font-semibold">Evição</p>
                  <p className="text-xs text-muted-foreground mt-0.5">LRU com score de prioridade (acesso × tempo)</p>
                </div>
                <div className="p-3 rounded-lg border bg-muted/30">
                  <p className="text-xs font-semibold">Deduplicação</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Requisições inflight são reutilizadas automaticamente</p>
                </div>
                <div className="p-3 rounded-lg border bg-muted/30">
                  <p className="text-xs font-semibold">TTL Padrão</p>
                  <p className="text-xs text-muted-foreground mt-0.5">5 minutos, configurável por chave</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs"
                onClick={() => {
                  intelligentCache.invalidate();
                  window.location.reload();
                }}>
                <RefreshCw className="h-3.5 w-3.5" />Limpar Cache
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export const Component = SystemMonitor;

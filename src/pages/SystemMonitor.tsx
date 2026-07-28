import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pulse as Activity, Shield, Database, Cpu, Users, Clock, MagnifyingGlass as Search, CheckCircle as CheckCircle2, XCircle, Warning as AlertTriangle, ArrowsClockwise as RefreshCw, Lightning as Zap, HardDrive, WifiHigh as Wifi } from '@phosphor-icons/react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { intelligentCache } from '@/services/cacheService';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

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
  const { data: auditLogs = [], isLoading: auditLoading, error: auditError, refetch: refetchAudit } = useQuery({
    queryKey: ['audit-logs-monitor'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Esta tela não tem uma fonte de observabilidade de produção conectada.
  // Exibe apenas estatísticas reais do cache local; os demais indicadores ficam
  // explicitamente indisponíveis até a integração ser feita.
  const perfMetrics = useMemo(() => {
    const cacheStats = intelligentCache.getStats();
    return {
      cache: cacheStats,
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

  // Filtered audit logs
  const filteredAudit = useMemo(() => {
    let logs = auditLogs;
    if (auditFilter === 'success') logs = logs.filter((l: any) => l.success !== false);
    if (auditFilter === 'failed') logs = logs.filter((l: any) => l.success === false);
    if (auditSearch.trim()) {
      logs = logs.filter((l: any) =>
        searchMatchesAllTerms(auditSearch, l.resource, l.action, l.user_id)
      );
    }
    return logs;
  }, [auditLogs, auditFilter, auditSearch]);

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="SISTEMA · MONITOR"
        title="Monitor do Sistema"
        description="Demonstração da interface de monitoramento; telemetria de produção ainda não está conectada."
        actions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetchAudit()}>
            <RefreshCw className="h-3.5 w-3.5" />Atualizar
          </Button>
        }
      />

      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <p><strong>Demonstração:</strong> latência, uptime, taxa de erro, usuários ativos e gráficos de performance não representam telemetria real.</p>
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
          <StatGrid>
            <StatCard label="Tempo Resposta" value="—" hint="Telemetria não conectada" icon={Zap} tone="default" />
            <StatCard label="Uptime" value="—" hint="Telemetria não conectada" icon={Wifi} tone="default" />
            <StatCard label="Taxa de Erro" value="—" hint="Telemetria não conectada" icon={AlertTriangle} tone="default" />
            <StatCard label="Usuários Ativos" value="—" hint="Telemetria não conectada" icon={Users} tone="default" />
          </StatGrid>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title={<span className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" />Requisições & Erros (24h)</span>}>
                <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Telemetria de requisições não conectada</div>
            </Panel>

            <Panel title={<span className="flex items-center gap-2"><Clock className="h-4 w-4 text-warning" />Latência (ms)</span>}>
                <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Telemetria de latência não conectada</div>
            </Panel>
          </div>
        </TabsContent>

        {/* ═══ AUDIT TAB ═══ */}
        <TabsContent value="audit" className="space-y-4">
          {auditError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <XCircle className="h-4 w-4 shrink-0" />
              Auditoria indisponível: {(auditError as Error).message}
            </div>
          )}
          {/* Audit KPIs */}
          {!auditError && (
            <StatGrid>
              <StatCard label="Eventos totais" value={auditStats.total} />
              <StatCard label="Bem-sucedidos" value={auditStats.successful} tone="success" />
              <StatCard label="Falhas" value={auditStats.failed} tone={auditStats.failed > 0 ? 'destructive' : 'default'} />
            </StatGrid>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Eventos por Recurso">
                {auditError ? (
                  <div className="flex items-center justify-center h-[200px] text-sm text-destructive">Auditoria indisponível</div>
                ) : auditStats.topResources.length > 0 ? (
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
            </Panel>

            <Panel title="Top Ações">
                {auditError ? (
                  <div className="flex items-center justify-center h-[200px] text-sm text-destructive">Auditoria indisponível</div>
                ) : auditStats.topActions.length > 0 ? (
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
            </Panel>
          </div>

          {/* Audit Log Table */}
          <Panel
            title="Log de Auditoria"
            actions={
              <div className="flex items-center gap-2">
                <SearchInput
                  value={auditSearch}
                  onChange={setAuditSearch}
                  placeholder="Buscar por ação, recurso ou usuário…"
                  resultCount={filteredAudit.length}
                  totalCount={auditLogs.length}
                  className="w-64"
                  inputClassName="h-8 text-xs"
                />
                <Select value={auditFilter} onValueChange={setAuditFilter}>
                  <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">Todos</SelectItem>
                    <SelectItem value="success" className="text-xs">Sucesso</SelectItem>
                    <SelectItem value="failed" className="text-xs">Falhas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            }
            flush
          >
              <div className="max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                      <TableHead>Data/Hora</TableHead>
                      <TableHead>Ação</TableHead>
                      <TableHead>Recurso</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Usuário</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                          Carregando...
                        </TableCell>
                      </TableRow>
                    ) : auditError ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-destructive text-sm">
                          Auditoria indisponível: {(auditError as Error).message}
                        </TableCell>
                      </TableRow>
                    ) : filteredAudit.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="p-0">
                          {auditSearch.trim() ? (
                            <EmptyState
                              size="sm"
                              icon={Search}
                              title={`Nenhum resultado para "${auditSearch}"`}
                              action={<Button variant="outline" size="sm" onClick={() => setAuditSearch('')}>Limpar busca</Button>}
                            />
                          ) : (
                            <EmptyState icon={Shield} title="Nenhum evento encontrado" size="sm" />
                          )}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAudit.slice(0, 50).map((log: any) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs font-mono">
                            {log.created_at ? format(new Date(log.created_at), 'dd/MM HH:mm:ss', { locale: ptBR }) : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{log.action}</Badge>
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
          </Panel>
        </TabsContent>

        {/* ═══ CACHE TAB ═══ */}
        <TabsContent value="cache" className="space-y-4">
          <StatGrid>
            <StatCard label="Entradas" value={perfMetrics.cache.entries} hint={`de ${perfMetrics.cache.maxEntries} máx`} />
            <StatCard label="Cache Hits" value={perfMetrics.cache.totalHits} hint="total acumulado" />
            <StatCard label="Inflight" value={perfMetrics.cache.inflight} hint="requisições ativas" />
            <StatCard
              label="Uso"
              value={`${((perfMetrics.cache.entries / perfMetrics.cache.maxEntries) * 100).toFixed(1)}%`}
              hint="da capacidade"
            />
          </StatGrid>

          <Panel title={<span className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-primary" />Estratégia de Cache</span>} bodyClassName="space-y-3">
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
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export const Component = SystemMonitor;

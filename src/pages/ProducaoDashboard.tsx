import AppLayout from "@/components/layout/AppLayout";
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Factory, Package, Warning as AlertTriangle, ClipboardText as ClipboardList, TrendDown as TrendingDown, Stack as Layers, CheckCircle as CheckCircle2, ArrowCircleDown as ArrowDownCircle, ArrowCircleUp as ArrowUpCircle, ChartBar as BarChart3 } from '@phosphor-icons/react';
import { StockHistoryTab } from '@/components/production/StockHistoryTab';
import ProducaoKPIsTab from '@/components/production/ProducaoKPIsTab';
import { StatGridSkeleton } from '@/components/layout/PageSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function useProducaoData() {
  return useQuery({
    queryKey: ['dashboard-producao'],
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [ordersRes, productsRes, movementsRes, stagesRes] = await Promise.all([
        supabase.from('orders').select('*, technical_sheets(name, code)').order('created_at', { ascending: false }).limit(500),
        supabase.from('products').select('id, name, sku, quantity, min_stock, max_stock, unit_price, unit, active').eq('active', true),
        supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('order_stages').select('id, order_id, stage_name, status').limit(3000),
      ]);

      const orders = ordersRes.data || [];
      const products = productsRes.data || [];
      const stages = stagesRes.data || [];

      const statusCount: Record<string, number> = {};
      for (const o of orders) {
        statusCount[o.status] = (statusCount[o.status] || 0) + 1;
      }

      const activeOps = orders.filter(o => (o.status || '').toLowerCase() === 'em produção').slice(0, 8);
      const lowStock = products.filter(p => p.min_stock > 0 && p.quantity <= p.min_stock);
      const totalStockValue = products.reduce((s, p) => s + p.quantity * p.unit_price, 0);
      const totalPairsInProduction = activeOps.reduce((s, o) => s + o.quantity, 0);
      const completedOps = orders.filter(o => ['concluída', 'concluído', 'finalizado'].includes((o.status || '').toLowerCase()));
      const totalPairsProduced = completedOps.reduce((s, o) => s + o.quantity, 0);

      const opProgress = activeOps.map(op => {
        const opStages = stages.filter(s => s.order_id === op.id);
        const totalStages = opStages.length;
        const completedStages = opStages.filter(s => s.status === 'concluido').length;
        return {
          ...op,
          refName: (op as any).technical_sheets?.name || '?',
          refCode: (op as any).technical_sheets?.code || '',
          progress: totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0,
          completedStages,
          totalStages,
        };
      });

      return { statusCount, opProgress, lowStock, totalStockValue, totalPairsInProduction, totalPairsProduced, totalOps: orders.length };
    },
  });
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  in_production: 'Em Produção',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export default function ProducaoDashboard() {
  const { data, isLoading } = useProducaoData();

  if (isLoading) {
    return (
      <div className="editorial-container editorial-stagger space-y-6 page-enter">
        <EditorialPageHeader
          sectionNumber="03"
          sectionLabel="PRODUÇÃO · VISÃO GERAL"
          title="Produção"
          description="Ordens de produção, estoque e materiais — fluxo da fábrica em tempo real."
        />
        <StatGridSkeleton count={4} />
        <div className="grid sm:grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-[260px] rounded-lg" />
          <Skeleton className="h-[260px] rounded-lg" />
        </div>
      </div>
    );
  }
  if (!data) return null;

  return (

      <div className="editorial-container editorial-stagger space-y-6 page-enter">
        <EditorialPageHeader
          sectionNumber="03"
          sectionLabel="PRODUÇÃO · VISÃO GERAL"
          title="Produção"
          description="Ordens de produção, estoque e materiais — fluxo da fábrica em tempo real."
        />

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="overview" className="gap-1.5"><Factory className="h-4 w-4" /> Visão Geral</TabsTrigger>
            <TabsTrigger value="kpis" className="gap-1.5"><BarChart3 className="h-4 w-4" /> KPIs</TabsTrigger>
            <TabsTrigger value="history-out" className="gap-1.5"><ArrowDownCircle className="h-4 w-4" /> Histórico de Saída</TabsTrigger>
            <TabsTrigger value="history-in" className="gap-1.5"><ArrowUpCircle className="h-4 w-4" /> Histórico de Entrada</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Section header: KPIs */}
            <div className="flex items-baseline gap-3 pt-2">
              <span className="font-display text-2xl text-muted-foreground tabular-nums">01</span>
              <span className="section-label">Indicadores</span>
            </div>

            {/* KPIs */}
            <StatGrid>
              <StatCard label="OPs Ativas" value={data.opProgress.length} icon={ClipboardList} />
              <StatCard label="Pares em Produção" value={data.totalPairsInProduction.toLocaleString('pt-BR')} icon={Factory} tone="primary" />
              <StatCard label="Estoque Baixo" value={data.lowStock.length} icon={AlertTriangle} tone="destructive" />
              <StatCard label="Valor em Estoque" value={fmt(data.totalStockValue)} icon={Package} tone="primary" />
            </StatGrid>

            {/* Section header: OPs */}
            <div className="flex items-baseline gap-3 pt-2">
              <span className="font-display text-2xl text-muted-foreground tabular-nums">02</span>
              <span className="section-label">Ordens & Estoque</span>
            </div>

            <div className="grid sm:grid-cols-1 md:grid-cols-2 gap-6">
              <Panel title={<span className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" /> Ordens em Andamento</span>}>
                  <div className="space-y-4">
                    {data.opProgress.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma OP ativa</p> : data.opProgress.map(op => (
                      <div key={op.id} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{op.order_number} — {op.refName}</p>
                            <p className="text-xs text-muted-foreground">{op.quantity} pares • {op.color || 'Sem cor'}</p>
                          </div>
                          <Badge variant={op.progress === 100 ? 'default' : 'outline'} className="text-xs shrink-0">
                            {op.completedStages}/{op.totalStages} etapas
                          </Badge>
                        </div>
                        <Progress value={op.progress} className="h-2" />
                      </div>
                    ))}
                  </div>
              </Panel>

              <Panel title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Alertas de Estoque</span>}>
                  <div className="space-y-3">
                    {data.lowStock.length === 0 ? (
                      <EmptyState
                        size="sm"
                        icon={CheckCircle2}
                        title="Estoque adequado"
                        description="Todos os materiais estão acima do mínimo."
                      />
                    ) : data.lowStock.slice(0, 10).map(p => (
                      <div key={p.id} className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-xs text-muted-foreground">SKU: {p.sku}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-semibold ${p.quantity === 0 ? 'text-destructive' : 'text-amber-600'}`}>
                            {p.quantity} {p.unit}
                          </p>
                          <p className="text-xs text-muted-foreground">Mín: {p.min_stock}</p>
                        </div>
                      </div>
                    ))}
                  </div>
              </Panel>

              <Panel className="md:col-span-2" title={<span className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Distribuição de OPs</span>}>
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    {Object.entries(data.statusCount).map(([status, count]) => (
                      <div key={status} className="rounded-lg border p-3 text-center">
                        <p className="display text-2xl tabular-nums">{count}</p>
                        <p className="text-xs text-muted-foreground">{STATUS_LABELS[status] || status}</p>
                      </div>
                    ))}
                  </div>
              </Panel>
            </div>
          </TabsContent>

          <TabsContent value="kpis">
            <ProducaoKPIsTab />
          </TabsContent>

          <TabsContent value="history-out">
            <StockHistoryTab type="out" />
          </TabsContent>

          <TabsContent value="history-in">
            <StockHistoryTab type="in" />
          </TabsContent>
        </Tabs>
      </div>
    
  );
}

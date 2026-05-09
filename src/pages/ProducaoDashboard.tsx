import AppLayout from "@/components/layout/AppLayout";
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Factory, Package, AlertTriangle, ClipboardList, TrendingDown, Layers, CheckCircle2, ArrowDownCircle, ArrowUpCircle, BarChart3, Loader2 } from 'lucide-react';
import { StockHistoryTab } from '@/components/production/StockHistoryTab';
import ProducaoKPIsTab from '@/components/production/ProducaoKPIsTab';

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

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm">Carregando...</span>
    </div>
  );
  if (!data) return null;

  return (
    
      <div className="space-y-5 page-enter">
        <div>
          <h1 className="display text-xl tracking-tight">Resumo Produção</h1>
          <p className="text-sm text-muted-foreground">Ordens de produção, estoque e materiais</p>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="overview" className="gap-1.5"><Factory className="h-4 w-4" /> Visão Geral</TabsTrigger>
            <TabsTrigger value="kpis" className="gap-1.5"><BarChart3 className="h-4 w-4" /> KPIs</TabsTrigger>
            <TabsTrigger value="history-out" className="gap-1.5"><ArrowDownCircle className="h-4 w-4" /> Histórico de Saída</TabsTrigger>
            <TabsTrigger value="history-in" className="gap-1.5"><ArrowUpCircle className="h-4 w-4" /> Histórico de Entrada</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><ClipboardList className="h-5 w-5 text-primary" /></div>
                    <div>
                      <p className="text-xs text-muted-foreground">OPs Ativas</p>
                      <p className="text-lg font-bold">{data.opProgress.length}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><Factory className="h-5 w-5 text-primary" /></div>
                    <div>
                      <p className="text-xs text-muted-foreground">Pares em Produção</p>
                      <p className="text-lg font-bold">{data.totalPairsInProduction.toLocaleString('pt-BR')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center"><AlertTriangle className="h-5 w-5 text-destructive" /></div>
                    <div>
                      <p className="text-xs text-muted-foreground">Estoque Baixo</p>
                      <p className="text-lg font-bold">{data.lowStock.length}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><Package className="h-5 w-5 text-primary" /></div>
                    <div>
                      <p className="text-xs text-muted-foreground">Valor em Estoque</p>
                      <p className="text-lg font-bold">{fmt(data.totalStockValue)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" /> Ordens em Andamento</CardTitle>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Alertas de Estoque</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.lowStock.length === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-green-600" /> Todos os materiais com estoque adequado
                      </div>
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
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Distribuição de OPs</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {Object.entries(data.statusCount).map(([status, count]) => (
                      <div key={status} className="rounded-lg border p-3 text-center">
                        <p className="display text-2xl tabular-nums">{count}</p>
                        <p className="text-xs text-muted-foreground">{STATUS_LABELS[status] || status}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
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

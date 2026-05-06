import { useMemo } from 'react';
import {
  ShoppingBag, Factory, AlertTriangle, TrendingUp,
  Package, Scissors, CheckCircle2, Zap, Loader2
} from 'lucide-react';
import { StatusCard } from '@/components/ui/StatusCard';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useOrders } from '@/hooks/useOrders';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useProducts } from '@/hooks/useProducts';
import { cn } from '@/lib/utils';

const sectorConfig = [
  { setor: 'Corte', icon: Scissors, colorClass: 'text-warning bg-warning/10' },
  { setor: 'Pesponto', icon: Package, colorClass: 'text-primary bg-primary/10' },
  { setor: 'Montagem', icon: CheckCircle2, colorClass: 'text-success bg-success/10' },
];

export default function ProductionDashboard() {
  const { data: orders = [], isLoading: l1 } = useOrders();
  const { data: saleOrders = [], isLoading: l2 } = useSaleOrders();
  const { data: products = [], isLoading: l3 } = useProducts();

  const stats = useMemo(() => {
    const activeProducts = products.filter(p => p.active);
    const criticalStock = activeProducts.filter(p => p.min_stock > 0 && p.quantity <= p.min_stock);
    const DONE_STATUSES = ['concluído', 'concluida', 'completed', 'finalizado', 'cancelled', 'cancelada', 'cancelado'];
    const activeOPs = orders.filter(o => !DONE_STATUSES.includes((o.status || '').toLowerCase()));
    const completedOPs = orders.filter(o => ['concluído', 'concluida', 'completed', 'finalizado'].includes((o.status || '').toLowerCase()));
    const totalPairsProduced = completedOPs.reduce((s, o) => s + o.quantity, 0);

    const totalRevenue = saleOrders
      .filter(o => ['Faturado', 'Aprovado', 'Entregue'].includes(o.status))
      .reduce((s, o) => s + Number(o.total), 0);

    const pendingPurchaseOrders = orders.filter(o => o.status === 'Pendente').length;

    return { criticalStock, activeOPs, totalRevenue, pendingPurchaseOrders, totalPairsProduced };
  }, [orders, saleOrders, products]);

  const fmt = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

  if (l1 || l2 || l3) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      {/* Header */}
      <div className="flex justify-between items-end flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Dashboard <span className="text-primary">Industrial</span>
          </h1>
          <p className="text-sm text-muted-foreground font-medium">
            Unidade de Produção — Visão Geral
          </p>
        </div>
        <div className="flex gap-2">
          <div className="bg-card border p-2 rounded-xl shadow-sm text-center min-w-[100px]">
            <p className="text-[10px] font-black text-muted-foreground uppercase">Meta Mensal</p>
            <p className="text-sm font-bold font-mono">30.000 prs</p>
          </div>
          <div className="bg-primary text-primary-foreground p-2 rounded-xl shadow-lg text-center min-w-[100px]">
            <p className="text-[10px] font-black opacity-80 uppercase">Produzido</p>
            <p className="text-sm font-bold font-mono">{stats.totalPairsProduced.toLocaleString('pt-BR')} prs</p>
          </div>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatusCard
          title="Faturamento Bruto"
          value={fmt(stats.totalRevenue)}
          type="info"
          icon={TrendingUp}
          trend="+12% vs mês ant."
        />
        <StatusCard
          title="Pedidos em Aberto"
          value={String(stats.activeOPs.length).padStart(2, '0')}
          type="success"
          icon={ShoppingBag}
        />
        <StatusCard
          title="Ordens de Compra"
          value={String(stats.pendingPurchaseOrders).padStart(2, '0')}
          type="warning"
          icon={Zap}
        />
        <StatusCard
          title="Rupturas de Estoque"
          value={String(stats.criticalStock.length).padStart(2, '0')}
          type="danger"
          icon={AlertTriangle}
        />
      </div>

      {/* Production Flow + Critical Inputs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Work Flow */}
        <div className="lg:col-span-2 bg-card rounded-3xl border shadow-sm p-6">
          <h3 className="text-sm font-black uppercase text-muted-foreground mb-6 flex items-center gap-2">
            <Factory className="h-4 w-4" /> Fluxo de Trabalho (OPs Ativas)
          </h3>
          <div className="space-y-4">
            {sectorConfig.map((step) => {
              const sectorOPs = stats.activeOPs.filter(o =>
                (o.status || '').toLowerCase().includes(step.setor.toLowerCase())
              );
              const progress = stats.activeOPs.length > 0
                ? Math.round((sectorOPs.length / stats.activeOPs.length) * 100)
                : 0;
              const refName = sectorOPs[0]
                ? ((sectorOPs[0] as any).technical_sheets?.name || 'Sem referência')
                : 'Sem OPs';

              return (
                <div key={step.setor} className="p-4 border rounded-2xl hover:bg-muted/50 transition-colors">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-3">
                      <div className={cn('p-2 rounded-lg', step.colorClass)}>
                        <step.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-black uppercase tracking-tight">{step.setor}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{refName}</p>
                      </div>
                    </div>
                    <span className="text-xs font-black font-mono">{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-1.5" />
                </div>
              );
            })}
          </div>
        </div>

        {/* Critical Inputs */}
        <div className="bg-sidebar-background rounded-3xl p-6 text-sidebar-foreground shadow-2xl">
          <h3 className="text-[10px] font-black uppercase text-sidebar-muted mb-6 tracking-widest">
            Atenção: Insumos Críticos
          </h3>
          <div className="space-y-6">
            {stats.criticalStock.length === 0 ? (
              <p className="text-sm text-sidebar-muted">Nenhum insumo em ruptura 🎉</p>
            ) : (
              stats.criticalStock.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between border-b border-sidebar-border pb-4 last:border-0">
                  <div>
                    <p className="text-sm font-bold">{item.name}</p>
                    <p className="text-[10px] text-sidebar-muted font-mono italic">
                      Estoque: {item.quantity} {item.unit} (mín: {item.min_stock})
                    </p>
                  </div>
                  <Badge variant="destructive" className="text-[9px]">URGENTE</Badge>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

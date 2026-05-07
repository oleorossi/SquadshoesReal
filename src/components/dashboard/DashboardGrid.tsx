 import { KPICard as KpiCard } from './KPICard';
import { Factory, ClipboardList, AlertTriangle, ShoppingCart, TrendingUp, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface DashboardGridProps {
  stats: any;
  filterPeriod: string;
  productsCount: number;
  fmt: (v: number) => string;
}

/** Card financeiro destacado (Saldo Líquido) */
function FinHighlightCard({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div
      className="rounded-lg p-4 border flex flex-col gap-1.5 hover:shadow-md transition-shadow cursor-pointer bg-primary border-primary/50"
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-primary-foreground/50">
        {label}
      </span>
      <span className={cn(
        'text-[22px] font-bold font-mono leading-none tracking-tight tabular-nums',
        positive ? 'text-lime-400' : 'text-red-400',
      )}>
        {value}
      </span>
      <span className="text-[11px] text-primary-foreground/50">{positive ? 'positivo' : 'negativo'}</span>
    </div>
  );
}

export function DashboardGrid({ stats, filterPeriod, productsCount, fmt }: DashboardGridProps) {
  const navigate = useNavigate();
  const isCurrentMonth = filterPeriod === format(new Date(), 'yyyy-MM');
  const saldo = stats.totalReceivable - stats.totalPayable;

  return (
    <div className="space-y-3">
      {/* Row 1 — Produção */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KpiCard
          title={isCurrentMonth ? 'Produção Hoje' : 'Produção no Período'}
          value={isCurrentMonth
            ? stats.productionToday
            : stats.completedOPs.reduce((s: number, o: any) => s + o.quantity, 0)}
          icon={Factory}
          subtitle={`${stats.inProductionOPs.length} OP(s) ativas`}
          variant="success"
          onClick={() => navigate('/orders')}
        />
        <KpiCard
          title="OEE"
          value={`${stats.oee}%`}
          icon={Factory}
          variant={stats.oee >= 80 ? 'success' : stats.oee >= 60 ? 'warning' : 'destructive'}
          subtitle="Eficiência global"
          onClick={() => navigate('/orders')}
        />
        <KpiCard
          title="OPs Ativas"
          value={stats.activeOPs.length}
          icon={ClipboardList}
          subtitle={`${stats.completedOPs.length} concluídas`}
          onClick={() => navigate('/orders')}
        />
        <KpiCard
          title="OPs em Atraso"
          value={stats.lateOPs.length}
          icon={AlertTriangle}
          variant={stats.lateOPs.length > 0 ? 'destructive' : 'default'}
          subtitle={stats.lateOPs.length > 0 ? 'Prazo ultrapassado' : 'Prazo OK'}
          onClick={() => navigate('/orders')}
        />
        <KpiCard
          title="Estoque Crítico"
          value={stats.criticalStock.length}
          icon={AlertTriangle}
          variant={stats.criticalStock.length > 0 ? 'destructive' : 'default'}
          subtitle={`${productsCount} itens`}
          onClick={() => navigate('/estoque')}
        />
        <KpiCard
          title="PVs Pendentes"
          value={stats.pendingSales.length}
          icon={ShoppingCart}
          variant={stats.pendingSales.length > 5 ? 'warning' : 'default'}
          subtitle="Pedidos aguardando"
          onClick={() => navigate('/sales')}
        />
      </div>

      {/* Row 2 — Financeiro */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <KpiCard
          title="Faturamento"
          value={fmt(stats.totalRevenue)}
          icon={TrendingUp}
          variant="success"
          trend="up"
          trendLabel="mês atual"
          onClick={() => navigate('/comercial')}
        />
        <KpiCard
          title="A Receber"
          value={fmt(stats.totalReceivable)}
          icon={ArrowUpRight}
          subtitle={stats.overdueReceivables > 0 ? `${stats.overdueReceivables} vencido(s)` : 'Em dia'}
          variant={stats.overdueReceivables > 0 ? 'warning' : 'default'}
          onClick={() => navigate('/finance')}
        />
        <KpiCard
          title="A Pagar"
          value={fmt(stats.totalPayable)}
          icon={ArrowDownRight}
          subtitle={stats.overduePayables > 0 ? `${stats.overduePayables} vencido(s)` : 'Em dia'}
          variant={stats.overduePayables > 0 ? 'destructive' : 'default'}
          onClick={() => navigate('/finance')}
        />
        <FinHighlightCard
          label="Saldo Líquido"
          value={fmt(saldo)}
          positive={saldo >= 0}
        />
      </div>
    </div>
  );
}

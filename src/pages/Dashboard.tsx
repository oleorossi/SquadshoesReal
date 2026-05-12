import { useState } from "react";
import { Plus, TrendingUp, Gauge, ClipboardList, Clock, AlertTriangle, ShoppingBag, TrendingDown, DollarSign, CalendarRange } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { KPICard } from "@/components/dashboard/KPICard";
import { FinCard } from "@/components/dashboard/FinCard";
import { ChartsRow } from "@/components/dashboard/ChartsRow";
import { BottomRow } from "@/components/dashboard/BottomRow";
import { ConsumptionErrorAlert } from "@/components/dashboard/ConsumptionErrorAlert";
import { useConsumptionSchemaError } from "@/hooks/useConsumptionSchemaError";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getDashboardPeriodRange, PERIOD_OPTIONS, type DashboardPeriod } from "@/lib/dashboardPeriod";

export default function Dashboard() {
  const navigate = useNavigate();
  const { error: consumptionError, clear: clearConsumptionError } = useConsumptionSchemaError();

  // Filtro de período do painel. Default = mês vigente conforme especificação:
  // ao abrir, mostra dados de mês atual; usuário escolhe outras janelas
  // (últimos 3m, 6m, ano vigente, tudo) no select do topo.
  const [period, setPeriod] = useState<DashboardPeriod>('current_month');
  const range = getDashboardPeriodRange(period);

  // Query for production and inventory KPIs — filtra por created_at do período
  const { data: productionStats } = useQuery({
    queryKey: ['dashboard-production-stats', range.cacheKey],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [
        { count: productsCount },
        { count: criticalCount },
        { count: ordersCount },
        { count: pendingSalesCount }
      ] = await Promise.all([
        // Estoque é estado atual — não filtra por período
        supabase.from('products').select('*', { count: 'exact', head: true }),
        supabase.from('products').select('*', { count: 'exact', head: true }).lt('quantity', 10),
        // OPs ativas e PVs pendentes filtram por created_at do período
        supabase.from('orders').select('*', { count: 'exact', head: true })
          .in('status', ['Reservado', 'Em Produção', 'Em produção'])
          .gte('created_at', range.startISO).lte('created_at', range.endISO),
        supabase.from('sale_orders').select('*', { count: 'exact', head: true })
          .in('status', ['Rascunho', 'rascunho'])
          .gte('created_at', range.startISO).lte('created_at', range.endISO)
      ]);

      return {
        products: productsCount || 0,
        critical: criticalCount || 0,
        activeOps: ordersCount || 0,
        pendingSales: pendingSalesCount || 0
      };
    }
  });

  // Faturamento + AR/AP filtram por created_at dentro do período.
  // "Saldo Líquido", "Vencidos" continuam refletindo carteira global pra alertar
  // o gestor — não muda com período pq risco financeiro é cross-tempo.
  const { data: financialStats } = useQuery({
    queryKey: ['dashboard-financial-stats', range.cacheKey],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const todayIso = new Date().toISOString().slice(0, 10);
      const [
        { data: salesData },
        { data: receivableRows },
        { data: payableRows },
      ] = await Promise.all([
        supabase.from('sale_orders').select('total')
          .gte('created_at', range.startISO).lte('created_at', range.endISO),
        supabase.from('accounts_receivable').select('amount, amount_received, due_date, status'),
        supabase.from('accounts_payable').select('amount, amount_paid, due_date, status'),
      ]);

      const RECEIVED_STATUSES = new Set(['received', 'recebido', 'cancelled', 'cancelado']);
      const PAID_STATUSES = new Set(['paid', 'pago', 'cancelled', 'cancelado']);

      const revenue = salesData?.reduce((acc, curr) => acc + (Number(curr.total) || 0), 0) || 0;

      let receivable = 0;
      let receivableOverdue = 0;
      (receivableRows || []).forEach((r: any) => {
        if (RECEIVED_STATUSES.has(r.status)) return;
        const remaining = Math.max(0, Number(r.amount || 0) - Number(r.amount_received || 0));
        receivable += remaining;
        if (r.due_date && r.due_date < todayIso) receivableOverdue += 1;
      });

      let payable = 0;
      let payableOverdue = 0;
      (payableRows || []).forEach((p: any) => {
        if (PAID_STATUSES.has(p.status)) return;
        const remaining = Math.max(0, Number(p.amount || 0) - Number(p.amount_paid || 0));
        payable += remaining;
        if (p.due_date && p.due_date < todayIso) payableOverdue += 1;
      });

      return {
        revenue,
        receivable,
        receivableOverdue,
        payable,
        payableOverdue,
        netBalance: receivable - payable,
      };
    }
  });

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  return (
    <div className="flex flex-col gap-4 page-enter">
      {consumptionError && (
        <ConsumptionErrorAlert
          error={consumptionError}
          context="Dashboard — saúde do motor de consumo"
          onDismiss={clearConsumptionError}
        />
      )}

      {/* Editorial header com filtro de período */}
      <div className="flex items-end justify-between gap-4 pb-1 flex-wrap">
        <div className="min-w-0">
          <div className="eyebrow flex items-center gap-2">
            <span className="live-dot" />
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </div>
          <h1 className="display text-2xl mt-2 sm:text-3xl">Squad Shoes · Visão geral</h1>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            <Select value={period} onValueChange={v => setPeriod(v as DashboardPeriod)}>
              <SelectTrigger className="h-9 w-44 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-[10px] capitalize hidden sm:flex">
              {range.label}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground font-mono tabular-nums hidden sm:block">
            {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {/* KPIs — Produção */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5 stagger-children">
        <KPICard
          label="Produtos"
          value={productionStats?.products ?? "..."}
          sub="Itens cadastrados"
          status="info"
          icon={TrendingUp}
          onClick={() => navigate('/estoque')}
        />
        <KPICard
          label="OEE Global"
          value="81%"
          sub="Eficiência global"
          status="info"
          icon={Gauge}
          onClick={() => navigate('/producao')}
        />
        <KPICard
          label="OPs Ativas"
          value={productionStats?.activeOps ?? "..."}
          sub={`Em curso · ${range.label}`}
          status="good"
          icon={ClipboardList}
          onClick={() => navigate('/orders')}
        />
        <KPICard
          label="OPs em Atraso"
          value="0"
          sub="Prazo OK"
          status="neutral"
          icon={Clock}
          onClick={() => navigate('/orders')}
        />
        <KPICard
          label="Estoque Crítico"
          value={productionStats?.critical ?? "..."}
          sub="Itens abaixo do mín."
          status="danger"
          icon={AlertTriangle}
          onClick={() => navigate('/estoque?tab=alerts')}
        />
        <KPICard
          label="PVs Pendentes"
          value={productionStats?.pendingSales ?? "..."}
          sub={`Aguardando · ${range.label}`}
          status="warning"
          icon={ShoppingBag}
          onClick={() => navigate('/sales')}
        />
      </div>

      {/* KPIs — Financeiro (Faturamento filtra por período; A Receber/Pagar globais) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 stagger-children">
        <div onClick={() => navigate('/finance')} className="cursor-pointer">
          <FinCard label={`Faturamento · ${range.label}`} value={formatCurrency(financialStats?.revenue ?? 0)} sub="Total PVs" subColor="up" trendIcon={TrendingUp} />
        </div>
        <div onClick={() => navigate('/finance')} className="cursor-pointer">
          <FinCard
            label="A Receber"
            value={formatCurrency(financialStats?.receivable ?? 0)}
            sub={`${financialStats?.receivableOverdue ?? 0} vencidos`}
            subColor={(financialStats?.receivableOverdue ?? 0) > 0 ? 'warning' : 'up'}
            trendIcon={TrendingUp}
          />
        </div>
        <div onClick={() => navigate('/finance')} className="cursor-pointer">
          <FinCard
            label="A Pagar"
            value={formatCurrency(financialStats?.payable ?? 0)}
            sub={`${financialStats?.payableOverdue ?? 0} vencidos`}
            subColor={(financialStats?.payableOverdue ?? 0) > 0 ? 'down' : 'muted'}
            trendIcon={TrendingDown}
          />
        </div>
        <div onClick={() => navigate('/finance')} className="cursor-pointer">
          <FinCard
            label="Saldo Líquido"
            value={formatCurrency(financialStats?.netBalance ?? 0)}
            sub="A Receber − A Pagar"
            subColor="muted"
            highlight
          />
        </div>
      </div>

      {/* Gráficos + lista — recebem o período pra ajustar buckets/filtros */}
      <ChartsRow period={period} />
      <BottomRow period={period} />
    </div>
  );
}

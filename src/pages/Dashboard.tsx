import { useState } from "react";
import { Plus, TrendUp as TrendingUp, Gauge, ClipboardText as ClipboardList, Clock, Warning as AlertTriangle, ShoppingBag, TrendDown as TrendingDown, CurrencyDollar as DollarSign, CalendarBlank as CalendarRange } from '@phosphor-icons/react';
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { ChartsRow } from "@/components/dashboard/ChartsRow";
import { BottomRow } from "@/components/dashboard/BottomRow";
import { ConsumptionErrorAlert } from "@/components/dashboard/ConsumptionErrorAlert";
import { useConsumptionSchemaError } from "@/hooks/useConsumptionSchemaError";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getDashboardPeriodRange, PERIOD_OPTIONS, type DashboardPeriod } from "@/lib/dashboardPeriod";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";

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
    <div className="flex flex-col gap-6 page-enter editorial-stagger">
      {consumptionError && (
        <ConsumptionErrorAlert
          error={consumptionError}
          context="Dashboard — saúde do motor de consumo"
          onDismiss={clearConsumptionError}
        />
      )}

      {/* Industrial Editorial Pro 2.0: header substitui hero inline custom.
          Live dot pulse + title Anton clamp + meta MONO + actions inline. */}
      <EditorialPageHeader
        sectionLabel={`PAINEL · ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase()}`}
        title="Squad Shoes"
        description={`Visão geral de produção, estoque e financeiro · ${range.label}`}
        live
        meta={
          <>
            ATUALIZADO <strong>{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
          </>
        }
        actions={
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
            <Badge variant="outline" className="text-xs capitalize hidden sm:flex">
              {range.label}
            </Badge>
          </div>
        }
      />

      {/* Section label antes do bloco produção */}
      <div className="flex items-baseline gap-3 pt-2">
        <span className="font-display text-2xl text-muted-foreground tabular-nums" aria-hidden="true">01</span>
        <h2 className="section-label">Produção & Estoque</h2>
      </div>

      {/* KPIs — Produção */}
      <StatGrid>
        <StatCard
          label="Produtos"
          value={productionStats?.products ?? "..."}
          hint="Itens cadastrados"
          icon={TrendingUp}
          onClick={() => navigate('/estoque')}
        />
        <StatCard
          label="OEE Global"
          value="81%"
          hint="Eficiência global"
          icon={Gauge}
          onClick={() => navigate('/producao')}
        />
        <StatCard
          label="OPs Ativas"
          value={productionStats?.activeOps ?? "..."}
          hint={`Em curso · ${range.label}`}
          tone="success"
          icon={ClipboardList}
          onClick={() => navigate('/orders')}
        />
        <StatCard
          label="OPs em Atraso"
          value="0"
          hint="Prazo OK"
          icon={Clock}
          onClick={() => navigate('/orders')}
        />
        <StatCard
          label="Estoque Crítico"
          value={productionStats?.critical ?? "..."}
          hint="Itens abaixo do mín."
          tone="destructive"
          icon={AlertTriangle}
          onClick={() => navigate('/estoque?tab=alerts')}
        />
        <StatCard
          label="PVs Pendentes"
          value={productionStats?.pendingSales ?? "..."}
          hint={`Aguardando · ${range.label}`}
          tone="warning"
          icon={ShoppingBag}
          onClick={() => navigate('/sales')}
        />
      </StatGrid>

      {/* Section label antes do bloco financeiro */}
      <div className="flex items-baseline gap-3 pt-2">
        <span className="font-display text-2xl text-muted-foreground tabular-nums" aria-hidden="true">02</span>
        <h2 className="section-label">Financeiro</h2>
      </div>

      {/* KPIs — Financeiro (Faturamento filtra por período; A Receber/Pagar globais) */}
      <StatGrid>
        <StatCard
          label={`Faturamento · ${range.label}`}
          value={formatCurrency(financialStats?.revenue ?? 0)}
          hint="Total PVs"
          tone="success"
          icon={TrendingUp}
          onClick={() => navigate('/finance')}
        />
        <StatCard
          label="A Receber"
          value={formatCurrency(financialStats?.receivable ?? 0)}
          hint={`${financialStats?.receivableOverdue ?? 0} vencidos`}
          tone={(financialStats?.receivableOverdue ?? 0) > 0 ? 'warning' : 'success'}
          icon={TrendingUp}
          onClick={() => navigate('/finance')}
        />
        <StatCard
          label="A Pagar"
          value={formatCurrency(financialStats?.payable ?? 0)}
          hint={`${financialStats?.payableOverdue ?? 0} vencidos`}
          tone={(financialStats?.payableOverdue ?? 0) > 0 ? 'destructive' : 'default'}
          icon={TrendingDown}
          onClick={() => navigate('/finance')}
        />
        <StatCard
          label="Saldo Líquido"
          value={formatCurrency(financialStats?.netBalance ?? 0)}
          hint="A Receber − A Pagar"
          tone="primary"
          icon={DollarSign}
          onClick={() => navigate('/finance')}
        />
      </StatGrid>

      {/* Section label antes dos gráficos */}
      <div className="flex items-baseline gap-3 pt-2">
        <span className="font-display text-2xl text-muted-foreground tabular-nums" aria-hidden="true">03</span>
        <h2 className="section-label">Tendências & Atividade</h2>
      </div>

      {/* Gráficos + lista — recebem o período pra ajustar buckets/filtros */}
      <ChartsRow period={period} />
      <BottomRow period={period} />
    </div>
  );
}

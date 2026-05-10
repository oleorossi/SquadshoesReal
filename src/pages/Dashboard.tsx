 import { Plus, TrendingUp, Gauge, ClipboardList, Clock, AlertTriangle, ShoppingBag, TrendingDown, DollarSign } from "lucide-react";
 import { useNavigate } from "react-router-dom";
 import { useQuery } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
import { KPICard } from "@/components/dashboard/KPICard";
import { FinCard } from "@/components/dashboard/FinCard";
import { ChartsRow } from "@/components/dashboard/ChartsRow";
import { BottomRow } from "@/components/dashboard/BottomRow";
import { ConsumptionErrorAlert } from "@/components/dashboard/ConsumptionErrorAlert";
 import { useConsumptionSchemaError } from "@/hooks/useConsumptionSchemaError";

 export default function Dashboard() {
   const navigate = useNavigate();
   // Captura erros do motor de consumo (Zod/RPC) emitidos globalmente.
   // O alerta exibe os 5 primeiros campos inválidos e oferece "Copiar detalhes".
   const { error: consumptionError, clear: clearConsumptionError } = useConsumptionSchemaError();
 
   // Query for production and inventory KPIs
    const { data: productionStats, isLoading: isProdLoading } = useQuery({
     queryKey: ['dashboard-production-stats'],
      staleTime: 60 * 1000, // 1 minute
     queryFn: async () => {
       const [
         { count: productsCount },
         { count: criticalCount },
         { count: ordersCount },
         { count: pendingSalesCount }
       ] = await Promise.all([
         supabase.from('products').select('*', { count: 'exact', head: true }),
         supabase.from('products').select('*', { count: 'exact', head: true }).lt('quantity', 10),
         // Active OP statuses (Portuguese title-case is the canonical DB value).
         supabase.from('orders').select('*', { count: 'exact', head: true })
           .in('status', ['Reservado', 'Em Produção', 'Em produção']),
         // Pending sale orders ≈ "Rascunho" (draft) in DB.
         supabase.from('sale_orders').select('*', { count: 'exact', head: true })
           .in('status', ['Rascunho', 'rascunho'])
       ]);
 
       return {
         products: productsCount || 0,
         critical: criticalCount || 0,
         activeOps: ordersCount || 0,
         pendingSales: pendingSalesCount || 0
       };
     }
   });
 
   // Faturamento = soma de sale_orders.total. A tabela 'orders' (OPs) não tem coluna
   // 'total' — só custos de produção. Receita vive em sale_orders.
   // A Receber/A Pagar/Saldo: somamos valor pendente em accounts_receivable e accounts_payable
   // para que o painel reflita o que o módulo Financeiro mostra.
    const { data: financialStats, isLoading: isFinLoading } = useQuery({
     queryKey: ['dashboard-financial-stats'],
      staleTime: 2 * 60 * 1000,
     queryFn: async () => {
       const todayIso = new Date().toISOString().slice(0, 10);
       const [
         { data: salesData },
         { data: receivableRows },
         { data: payableRows },
       ] = await Promise.all([
         supabase.from('sale_orders').select('total'),
         supabase.from('accounts_receivable').select('amount, amount_paid, due_date, status'),
         supabase.from('accounts_payable').select('amount, amount_paid, due_date, status'),
       ]);

       const PAID_STATUSES = new Set(['paid', 'pago', 'cancelled', 'cancelado', 'estornado']);

       const revenue = salesData?.reduce((acc, curr) => acc + (Number(curr.total) || 0), 0) || 0;

       let receivable = 0;
       let receivableOverdue = 0;
       (receivableRows || []).forEach((r: any) => {
         if (PAID_STATUSES.has(r.status)) return;
         const remaining = Math.max(0, Number(r.amount || 0) - Number(r.amount_paid || 0));
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
      {/* Editorial header (Novidade) */}
      <div className="flex items-baseline justify-between gap-4 pb-1">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <span className="live-dot" />
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </div>
          <h1 className="display text-2xl mt-2 sm:text-3xl">Squad Shoes · Visão geral</h1>
        </div>
        <div className="text-xs text-muted-foreground font-mono tabular-nums hidden sm:block">
          {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
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
           sub="Ordens em curso" 
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
           sub="Aguardando liberação" 
           status="warning" 
           icon={ShoppingBag} 
           onClick={() => navigate('/sales')}
         />
      </div>

      {/* KPIs — Financeiro */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 stagger-children">
         <div onClick={() => navigate('/finance')} className="cursor-pointer">
           <FinCard label="Faturamento" value={formatCurrency(financialStats?.revenue ?? 0)} sub="Total PVs" subColor="up" trendIcon={TrendingUp} />
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

      {/* Gráficos */}
      <ChartsRow />

      {/* Tabela + OPs */}
      <BottomRow />
    </div>
  );
}

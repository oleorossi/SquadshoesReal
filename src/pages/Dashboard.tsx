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
 
   // Query for financial KPIs
    const { data: financialStats, isLoading: isFinLoading } = useQuery({
     queryKey: ['dashboard-financial-stats'],
      staleTime: 2 * 60 * 1000, // 2 minutes
     queryFn: async () => {
       // Usando 'total' em vez de 'total_amount' conforme schema da tabela 'orders'
       const { data: orders } = await supabase
         .from('orders')
         .select('total');
       
       const total = orders?.reduce((acc, curr) => acc + (Number((curr as any).total) || 0), 0) || 0;
       
       return {
         revenue: total
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
           <FinCard label="Faturamento" value={formatCurrency(financialStats?.revenue ?? 0)} sub="Total ordens" subColor="up" trendIcon={TrendingUp} />
         </div>
         <div onClick={() => navigate('/finance')} className="cursor-pointer">
           <FinCard label="A Receber" value="R$ 65.690" sub="3 vencidos" subColor="warning" trendIcon={TrendingUp} />
         </div>
         <div onClick={() => navigate('/finance')} className="cursor-pointer">
           <FinCard label="A Pagar" value="R$ 17.841" sub="8 vencidos" subColor="down" trendIcon={TrendingDown} />
         </div>
         <div onClick={() => navigate('/finance')} className="cursor-pointer">
           <FinCard label="Saldo Líquido" value="R$ 47.849" sub="estimado" subColor="muted" highlight />
         </div>
      </div>

      {/* Gráficos */}
      <ChartsRow />

      {/* Tabela + OPs */}
      <BottomRow />
    </div>
  );
}

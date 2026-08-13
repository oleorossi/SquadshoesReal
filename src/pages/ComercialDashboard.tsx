import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { ShoppingCart, TrendUp as TrendingUp, CurrencyDollar as DollarSign, Package } from '@phosphor-icons/react';
import { RefChip } from '@/components/ui/ref-chip';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { StatGridSkeleton } from '@/components/layout/PageSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function useComercialData() {
  return useQuery({
    queryKey: ['dashboard-comercial'],
    queryFn: async () => {
      // Narrow column selection — the dashboard only needs these fields and
      // select('*') was pulling notes, descriptions, and other heavy fields
      // that bloated the initial payload by 30-50%.
      const { data: salesData, error: salesError } = await supabase
        .from('sale_orders')
        .select('id, client_id, client_name, total, status, representative, commission_value')
        .order('created_at', { ascending: false })
        .limit(500);
      if (salesError) throw salesError;

      const sales = salesData ?? [];
      const saleOrderIds = sales.map(s => s.id);
      const clientIds = Array.from(new Set(sales.map(s => s.client_id).filter(Boolean)));
      const [itemsRes, clientsRes] = await Promise.all([
        saleOrderIds.length
          ? supabase.from('sale_order_items').select('sale_order_id, reference_id, quantity, unit_price, color, technical_sheets(name, code)').in('sale_order_id', saleOrderIds)
          : Promise.resolve({ data: [], error: null }),
        clientIds.length
          ? supabase.from('clients').select('id, economic_groups(name)').in('id', clientIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      if (clientsRes.error) throw clientsRes.error;

      const items = itemsRes.data || [];
      const clients = clientsRes.data || [];
      const clientsById = new Map(clients.map(client => [client.id, client]));

      // Top clients by total purchased
      const clientTotals = new Map<string, { name: string; group: string; total: number; orders: number }>();
      for (const s of sales) {
        const key = s.client_name || 'Sem nome';
        const prev = clientTotals.get(key) || { name: key, group: '', total: 0, orders: 0 };
        const client = clientsById.get(s.client_id);
        prev.group = (client as any)?.economic_groups?.name || prev.group || '';
        prev.total += s.total;
        prev.orders += 1;
        clientTotals.set(key, prev);
      }
      const topClients = Array.from(clientTotals.values()).sort((a, b) => b.total - a.total).slice(0, 10);

      // Top groups by total — aggregate from ALL clients, not just top 10
      const groupTotals = new Map<string, { name: string; total: number; orders: number }>();
      for (const c of Array.from(clientTotals.values())) {
        const gName = c.group || 'Sem grupo';
        const prev = groupTotals.get(gName) || { name: gName, total: 0, orders: 0 };
        prev.total += c.total;
        prev.orders += c.orders;
        groupTotals.set(gName, prev);
      }
      const topGroups = Array.from(groupTotals.values()).sort((a, b) => b.total - a.total).slice(0, 5);

      // Top references
      const refTotals = new Map<string, { name: string; code: string; pairs: number; revenue: number }>();
      for (const item of items) {
        const ref = (item as any).technical_sheets;
        const key = item.reference_id;
        const prev = refTotals.get(key) || { name: ref?.name || '?', code: ref?.code || '', pairs: 0, revenue: 0 };
        prev.pairs += item.quantity;
        prev.revenue += item.quantity * (item.unit_price || 0);
        refTotals.set(key, prev);
      }
      const topRefs = Array.from(refTotals.values()).sort((a, b) => b.pairs - a.pairs).slice(0, 10);

      // Rep performance
      const repTotals = new Map<string, { name: string; total: number; commission: number; orders: number }>();
      for (const s of sales) {
        const repName = s.representative || 'Direto';
        const prev = repTotals.get(repName) || { name: repName, total: 0, commission: 0, orders: 0 };
        prev.total += s.total;
        prev.commission += s.commission_value;
        prev.orders += 1;
        repTotals.set(repName, prev);
      }
      const topReps = Array.from(repTotals.values()).sort((a, b) => b.total - a.total).slice(0, 5);

      // Summary
      const totalRevenue = sales.reduce((s, o) => s + o.total, 0);
      const totalOrders = sales.length;
      const totalPairs = items.reduce((s, i) => s + i.quantity, 0);
      const pendingOrders = sales.filter(s => s.status === 'Pendente').length;

       // Top Colors
       const colorTotals = new Map<string, { color: string; pairs: number; revenue: number }>();
       for (const item of items) {
         const color = (item.color || 'Não definida').trim().toUpperCase();
         const prev = colorTotals.get(color) || { color, pairs: 0, revenue: 0 };
         prev.pairs += item.quantity;
         prev.revenue += item.quantity * (item.unit_price || 0);
         colorTotals.set(color, prev);
       }
       const topColors = Array.from(colorTotals.values()).sort((a, b) => b.pairs - a.pairs).slice(0, 10);
 
       return { topClients, topGroups, topRefs, topReps, topColors, totalRevenue, totalOrders, totalPairs, pendingOrders };
    },
  });
}

export default function ComercialDashboard() {
  const { data, isLoading } = useComercialData();

  if (isLoading) return (
    <div className="editorial-container editorial-stagger space-y-6 page-enter">
      <EditorialPageHeader
        sectionNumber="04"
        sectionLabel="COMERCIAL · VISÃO GERAL"
        title="Comercial"
        description="Visão geral de vendas, clientes, representantes e cores mais vendidas."
      />
      <StatGridSkeleton count={4} />
      <div className="grid sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[260px] rounded-lg" />
        ))}
      </div>
    </div>
  );
  if (!data) return null;

  return (

      <div className="editorial-container editorial-stagger space-y-6 page-enter">
        <EditorialPageHeader
          sectionNumber="04"
          sectionLabel="COMERCIAL · VISÃO GERAL"
          title="Comercial"
          description="Visão geral de vendas, clientes, representantes e cores mais vendidas."
        />

        {/* Section header: KPIs */}
        <div className="flex items-baseline gap-3 pt-2">
          <span className="font-display text-2xl text-muted-foreground tabular-nums">01</span>
          <span className="section-label">Indicadores</span>
        </div>

        {/* KPIs */}
        <StatGrid>
          <StatCard
            label="Faturamento Total"
            value={fmt(data.totalRevenue)}
            icon={DollarSign}
            tone="primary"
          />
          <StatCard
            label="Pedidos"
            value={data.totalOrders}
            icon={ShoppingCart}
          />
          <StatCard
            label="Pares Vendidos"
            value={data.totalPairs.toLocaleString('pt-BR')}
            icon={Package}
          />
          <StatCard
            label="Pendentes"
            value={data.pendingOrders}
            icon={TrendingUp}
            tone="destructive"
          />
        </StatGrid>

         {/* Section header: Rankings */}
         <div className="flex items-baseline gap-3 pt-2">
           <span className="font-display text-2xl text-muted-foreground tabular-nums">02</span>
           <span className="section-label">Rankings & Top Performers</span>
         </div>

         <div className="grid sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
           {/* Top Colors */}
           <Panel title="Cores Mais Vendidas">
               <div className="space-y-3">
                 {data.topColors.length === 0 ? (
                   <p className="text-sm text-muted-foreground">Sem dados</p>
                 ) : (
                   data.topColors.map((c, i) => (
                     <div key={c.color} className="flex items-center justify-between">
                       <div className="flex items-center gap-2">
                         <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{i + 1}</span>
                         <span className="text-sm font-medium">{c.color}</span>
                       </div>
                       <div className="text-right">
                         <p className="text-sm font-semibold">{c.pairs.toLocaleString('pt-BR')} pares</p>
                         <p className="text-xs text-muted-foreground">{fmt(c.revenue)}</p>
                       </div>
                     </div>
                   ))
                 )}
               </div>
           </Panel>

          {/* Top Groups */}
          <Panel title="Principais Grupos Econômicos">
              <div className="space-y-3">
                {data.topGroups.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados</p> : data.topGroups.map((g, i) => (
                  <div key={g.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{i + 1}</span>
                      <span className="text-sm font-medium">{g.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{fmt(g.total)}</p>
                      <p className="text-xs text-muted-foreground">{g.orders} pedido{g.orders > 1 ? 's' : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
          </Panel>

          {/* Top Clients */}
          <Panel title="Top Clientes (Lojas)">
              <div className="space-y-3">
                {data.topClients.slice(0, 8).map((c, i) => (
                  <div key={c.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        {c.group && <p className="text-xs text-muted-foreground">{c.group}</p>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold">{fmt(c.total)}</p>
                      <p className="text-xs text-muted-foreground">{c.orders} PV{c.orders > 1 ? 's' : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
          </Panel>

          {/* Top References */}
          <Panel title="Modelos Mais Vendidos">
              <div className="space-y-3">
                {data.topRefs.slice(0, 8).map((r, i) => (
                  <div key={r.code} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{r.name}</p>
                        {r.code && <RefChip code={r.code} className="mt-0.5" />}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold">{r.pairs.toLocaleString('pt-BR')} pares</p>
                      <p className="text-xs text-muted-foreground">{fmt(r.revenue)}</p>
                    </div>
                  </div>
                ))}
              </div>
          </Panel>

          {/* Top Representatives */}
          <Panel title="Performance Representantes">
              <div className="space-y-3">
                {data.topReps.map((r, i) => (
                  <div key={r.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{i + 1}</span>
                      <span className="text-sm font-medium">{r.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{fmt(r.total)}</p>
                      <p className="text-xs text-muted-foreground">Comissão: {fmt(r.commission)}</p>
                    </div>
                  </div>
                ))}
              </div>
          </Panel>
        </div>
      </div>

  );
}

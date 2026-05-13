import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, Users, TrendUp as TrendingUp, Medal as Award, CurrencyDollar as DollarSign, Package, Palette, CircleNotch as Loader2 } from '@phosphor-icons/react';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function useComercialData() {
  return useQuery({
    queryKey: ['dashboard-comercial'],
    queryFn: async () => {
      // Narrow column selection — the dashboard only needs these fields and
      // select('*') was pulling notes, descriptions, and other heavy fields
      // that bloated the initial payload by 30-50%.
      const [salesRes, itemsRes, clientsRes, groupsRes, repsRes] = await Promise.all([
        supabase.from('sale_orders').select('id, client_id, client_name, total, status, representative, commission_value').order('created_at', { ascending: false }).limit(1000),
        supabase.from('sale_order_items').select('reference_id, quantity, unit_price, color, technical_sheets(name, code)').limit(5000),
        supabase.from('clients').select('id, economic_groups(name)').limit(2000),
        supabase.from('economic_groups').select('id, name'),
        supabase.from('representatives').select('id, name').eq('active', true),
      ]);

      const sales = salesRes.data || [];
      const items = itemsRes.data || [];
      const clients = clientsRes.data || [];
       // groups and reps fetched for potential future use or to ensure data consistency

      // Top clients by total purchased
      const clientTotals = new Map<string, { name: string; group: string; total: number; orders: number }>();
      for (const s of sales) {
        const key = s.client_name || 'Sem nome';
        const prev = clientTotals.get(key) || { name: key, group: '', total: 0, orders: 0 };
        const client = clients.find(c => c.id === s.client_id);
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
    <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm">Carregando...</span>
    </div>
  );
  if (!data) return null;

  return (
    
      <div className="space-y-5 page-enter">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Resumo Comercial</h1>
          <p className="text-sm text-muted-foreground">Visão geral de vendas, clientes e representantes</p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><DollarSign className="h-5 w-5 text-primary" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">Faturamento Total</p>
                  <p className="text-lg font-bold">{fmt(data.totalRevenue)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><ShoppingCart className="h-5 w-5 text-primary" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">Pedidos</p>
                  <p className="text-lg font-bold">{data.totalOrders}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><Package className="h-5 w-5 text-primary" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">Pares Vendidos</p>
                  <p className="text-lg font-bold">{data.totalPairs.toLocaleString('pt-BR')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center"><TrendingUp className="h-5 w-5 text-destructive" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">Pendentes</p>
                  <p className="text-lg font-bold">{data.pendingOrders}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

         <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
           {/* Top Colors */}
           <Card>
             <CardHeader className="pb-3">
               <CardTitle className="text-base flex items-center gap-2"><Palette className="h-4 w-4 text-primary" /> Cores Mais Vendidas</CardTitle>
             </CardHeader>
             <CardContent>
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
             </CardContent>
           </Card>
 
          {/* Top Groups */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Award className="h-4 w-4 text-primary" /> Principais Grupos Econômicos</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          {/* Top Clients */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Top Clientes (Lojas)</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          {/* Top References */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4 text-primary" /> Modelos Mais Vendidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.topRefs.slice(0, 8).map((r, i) => (
                  <div key={r.code} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.code}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold">{r.pairs.toLocaleString('pt-BR')} pares</p>
                      <p className="text-xs text-muted-foreground">{fmt(r.revenue)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Representatives */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Performance Representantes</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </div>
      </div>
    
  );
}

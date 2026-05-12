import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { TrendUp as TrendingUp, TrendDown as TrendingDown } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

type MonthData = {
  monthKey: string;       // 'yyyy-MM'
  monthLabel: string;     // 'mai/26'
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
  orderCount: number;
};

function useNetMarginByPeriod(monthsBack: number) {
  return useQuery({
    queryKey: ['net_margin_by_period', monthsBack],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MonthData[]> => {
      const start = format(startOfMonth(subMonths(new Date(), monthsBack - 1)), 'yyyy-MM-dd');

      // Buscar perfis dos pedidos com data de referência (delivery_deadline)
      // PVs Cancelados são excluídos. Sem cálculo de custo persistido → ignorado.
      const { data: profitData, error } = await supabase
        .from('v_order_profitability' as any)
        .select('sale_order_id, total_revenue, total_cost, total_margin, status')
        .not('status', 'in', '("Cancelado","Cancelada","Rascunho")');
      if (error) throw error;

      const ids = (profitData || []).map((p: any) => p.sale_order_id);
      if (ids.length === 0) return [];

      const { data: ordersData } = await supabase
        .from('sale_orders')
        .select('id, delivery_deadline, created_at')
        .in('id', ids)
        .gte('delivery_deadline', start);

      const orderDateMap = new Map<string, string>();
      for (const o of ordersData || []) {
        const ref = o.delivery_deadline || o.created_at;
        if (ref) orderDateMap.set(o.id, ref);
      }

      // Inicializa todos os meses do período
      const months: MonthData[] = [];
      for (let i = monthsBack - 1; i >= 0; i--) {
        const d = subMonths(new Date(), i);
        const monthKey = format(d, 'yyyy-MM');
        months.push({
          monthKey,
          monthLabel: format(d, 'MMM/yy', { locale: ptBR }),
          revenue: 0, cost: 0, margin: 0, marginPct: 0, orderCount: 0,
        });
      }
      const monthIdx = new Map(months.map((m, i) => [m.monthKey, i]));

      for (const p of (profitData || []) as any[]) {
        const orderDate = orderDateMap.get(p.sale_order_id);
        if (!orderDate) continue;
        const monthKey = orderDate.substring(0, 7);
        const idx = monthIdx.get(monthKey);
        if (idx === undefined) continue;
        months[idx].revenue += Number(p.total_revenue) || 0;
        months[idx].cost += Number(p.total_cost) || 0;
        months[idx].margin += Number(p.total_margin) || 0;
        months[idx].orderCount += 1;
      }

      // Calcula margin% no fim
      for (const m of months) {
        m.marginPct = m.revenue > 0 ? (m.margin / m.revenue) * 100 : 0;
      }
      return months;
    },
  });
}

export function NetMarginChart() {
  const [monthsBack, setMonthsBack] = useState(6);
  const { data = [], isLoading } = useNetMarginByPeriod(monthsBack);

  const totals = useMemo(() => {
    const revenue = data.reduce((s, m) => s + m.revenue, 0);
    const cost = data.reduce((s, m) => s + m.cost, 0);
    const margin = revenue - cost;
    const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
    const orderCount = data.reduce((s, m) => s + m.orderCount, 0);
    return { revenue, cost, margin, marginPct, orderCount };
  }, [data]);

  // Tendência: comparar primeira metade do período com a segunda
  const trend = useMemo(() => {
    if (data.length < 2) return null;
    const half = Math.floor(data.length / 2);
    const firstHalf = data.slice(0, half);
    const secondHalf = data.slice(half);
    const firstAvg = firstHalf.reduce((s, m) => s + m.marginPct, 0) / Math.max(1, firstHalf.length);
    const secondAvg = secondHalf.reduce((s, m) => s + m.marginPct, 0) / Math.max(1, secondHalf.length);
    return { firstAvg, secondAvg, delta: secondAvg - firstAvg };
  }, [data]);

  const hasData = totals.orderCount > 0;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Margem Líquida — Evolução por Período
          </CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">
            Receita × Custo (matéria-prima + MOD + GGF + embalagem) com margem % por mês.
            Fonte: <code>order_costs</code> (cálculos persistidos via "Calcular Custos" no PV).
          </p>
        </div>
        <Select value={String(monthsBack)} onValueChange={(v) => setMonthsBack(Number(v))}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">3 meses</SelectItem>
            <SelectItem value="6">6 meses</SelectItem>
            <SelectItem value="12">12 meses</SelectItem>
            <SelectItem value="24">24 meses</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
            Carregando…
          </div>
        ) : !hasData ? (
          <div className="h-72 flex items-center justify-center flex-col gap-2 text-muted-foreground">
            <TrendingDown className="h-8 w-8 opacity-30" />
            <p className="text-sm">Nenhum custo calculado no período.</p>
            <p className="text-[11px]">Rode "Calcular Custos" nos PVs pra ver a evolução de margem aqui.</p>
          </div>
        ) : (
          <>
            {/* KPIs do período */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="rounded-md bg-muted/30 p-2.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Receita</p>
                <p className="text-sm font-bold tabular-nums mt-0.5">{fmt(totals.revenue)}</p>
              </div>
              <div className="rounded-md bg-muted/30 p-2.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Custo</p>
                <p className="text-sm font-bold tabular-nums mt-0.5">{fmt(totals.cost)}</p>
              </div>
              <div className="rounded-md bg-muted/30 p-2.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Margem</p>
                <p className={cn(
                  'text-sm font-bold tabular-nums mt-0.5',
                  totals.margin >= 0 ? 'text-emerald-700' : 'text-red-700',
                )}>{fmt(totals.margin)}</p>
              </div>
              <div className="rounded-md bg-muted/30 p-2.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Margem %</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className={cn(
                    'text-sm font-bold tabular-nums',
                    totals.marginPct >= 20 ? 'text-emerald-700' :
                    totals.marginPct >= 10 ? 'text-amber-700' : 'text-red-700',
                  )}>{fmtPct(totals.marginPct)}</p>
                  {trend && Math.abs(trend.delta) > 0.5 && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[9px] h-4 px-1.5',
                        trend.delta > 0
                          ? 'border-emerald-500/40 text-emerald-700'
                          : 'border-red-500/40 text-red-700',
                      )}
                    >
                      {trend.delta > 0 ? '↑' : '↓'} {Math.abs(trend.delta).toFixed(1)}pp
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis
                    yAxisId="money"
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(v) => fmt(v)}
                  />
                  <YAxis
                    yAxisId="pct"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '0.5rem',
                      fontSize: '12px',
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === 'Margem %') return [fmtPct(value), name];
                      return [fmt(value), name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                  <Bar yAxisId="money" dataKey="revenue" name="Receita" fill="hsl(var(--primary))" opacity={0.85} radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="money" dataKey="cost" name="Custo" fill="hsl(var(--muted-foreground))" opacity={0.6} radius={[3, 3, 0, 0]} />
                  <Line yAxisId="money" type="monotone" dataKey="margin" name="Margem (R$)" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="pct" type="monotone" dataKey="marginPct" name="Margem %" stroke="hsl(38 92% 50%)" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <p className="text-[10px] text-muted-foreground italic mt-3">
              Pedidos contabilizados pelo <strong>delivery_deadline</strong>. Apenas PVs com cálculo de
              custo persistido (<code>order_costs</code>) entram. {totals.orderCount} PV(s) no período.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

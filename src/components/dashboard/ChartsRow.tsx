import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { subMonths, format, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getDashboardPeriodRange, type DashboardPeriod } from "@/lib/dashboardPeriod";

// Cores dos gráficos seguem o handoff Novidade (vermelho Squad como acento
// principal). Antes tinha um verde escuro `hsl(162, 90%, 15%)` hardcoded —
// resíduo de outro tema. Agora puxa do token CSS pra ficar coerente com
// dark mode + sidebar + KPIs.
const PRIMARY      = "hsl(var(--primary))";
const CHART_BLUE   = "hsl(var(--stage-cut-fg))";
const DONUT_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--stage-cut-fg))",
  "hsl(var(--stage-sew-fg))",
  "hsl(var(--warning))",
  "hsl(var(--muted-foreground))",
];

const formatK   = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v);
const formatBRL = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const CARD_TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--card))",
  color: "hsl(var(--foreground))",
  boxShadow: "0 4px 12px -2px rgb(0 0 0 / 0.1)",
};

export function ChartsRow({ period = 'current_month' }: { period?: DashboardPeriod } = {}) {
  const range = getDashboardPeriodRange(period);

  // Quantidade de buckets no chart varia conforme período:
  // current_month=1 (mostra dia/semana — fallback 1 mês), last_3m=3, last_6m=6,
  // current_year=mês atual, all=12. Garantimos mínimo 1.
  const months = useMemo(() => {
    const count = Math.max(1, range.bucketMonths);
    return Array.from({ length: count }, (_, i) => {
      const d = subMonths(new Date(), count - 1 - i);
      return {
        label: format(d, "MMM", { locale: ptBR }),
        start: startOfMonth(d).toISOString(),
        end:   endOfMonth(d).toISOString(),
        key:   format(d, "yyyy-MM"),
      };
    });
  }, [range.cacheKey]);

  const { data: salesData = [], isLoading: salesLoading } = useQuery({
    queryKey: ["dashboard-charts-sales", range.cacheKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_orders")
        .select("created_at, total")
        .gte("created_at", range.startISO)
        .lte("created_at", range.endISO)
        .not("status", "eq", "cancelled");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const { data: productionData = [], isLoading: prodLoading } = useQuery({
    queryKey: ["dashboard-charts-production", range.cacheKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("created_at, quantity")
        .gte("created_at", range.startISO)
        .lte("created_at", range.endISO)
        .not("status", "eq", "cancelled");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const { data: stockByCategory = [], isLoading: stockLoading } = useQuery({
    queryKey: ["dashboard-charts-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("category, quantity")
        .eq("active", true);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const areaData = useMemo(() => {
    return months.map((m) => {
      const vendas = salesData
        .filter((s: any) => s.created_at >= m.start && s.created_at <= m.end)
        .reduce((sum: number, s: any) => sum + (Number(s.total) || 0), 0);
      const producao = productionData
        .filter((o: any) => o.created_at >= m.start && o.created_at <= m.end)
        .reduce((sum: number, o: any) => sum + (Number(o.quantity) || 0), 0);
      return { month: m.label, vendas, producao };
    });
  }, [months, salesData, productionData]);

  const donutData = useMemo(() => {
    const grouped: Record<string, number> = {};
    for (const p of stockByCategory) {
      const cat = (p as any).category || "Outros";
      grouped[cat] = (grouped[cat] || 0) + (Number((p as any).quantity) || 0);
    }
    return Object.entries(grouped)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));
  }, [stockByCategory]);

  if (salesLoading || prodLoading || stockLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1fr_340px] gap-3">
        <Skeleton className="h-[220px] rounded-xl" />
        <Skeleton className="h-[220px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1fr_340px] gap-3">

      {/* ── Area chart ── */}
      <div className="bg-card rounded-xl border border-border shadow-card hover:shadow-card-hover transition-shadow duration-200">
        <div className="flex items-start justify-between px-5 py-4 border-b border-border/60">
          <div>
            <h3 className="text-[13px] font-semibold text-foreground tracking-tight">
              Vendas vs Produção
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">últimos 6 meses</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full" style={{ background: PRIMARY }} />
              Vendas
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              Produção
            </div>
          </div>
        </div>
        <div className="px-4 pt-3 pb-4">
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={areaData} margin={{ top: 4, right: 0, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="gradVendas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={PRIMARY}     stopOpacity={0.2} />
                  <stop offset="95%" stopColor={PRIMARY}     stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradProd" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={CHART_BLUE}  stopOpacity={0.2} />
                  <stop offset="95%" stopColor={CHART_BLUE}  stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--border))" vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              {/* Fix #22: dois Y-axes separados garantem que cada série mantém
                  sua própria escala. Antes (sem yAxisId) compartilhavam eixo,
                  comprimindo produção (~5k pares) a uma linha colada no 0 vs
                  vendas (~200k BRL). Margin right=0 + width auto deixa
                  espaço pro eixo direito sem cortar. Solid line (sem
                  dasharray) facilita ver a linha de produção. */}
              <YAxis yAxisId="vendas" tickFormatter={formatK} tick={{ fontSize: 10, fill: PRIMARY }} axisLine={false} tickLine={false} width={36} />
              <YAxis yAxisId="producao" orientation="right" tickFormatter={formatK} tick={{ fontSize: 10, fill: CHART_BLUE }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                formatter={(v: number, name: string) => name === "vendas" ? formatBRL(v) : `${v} pares`}
                labelFormatter={(l) => `Mês: ${l}`}
                contentStyle={CARD_TOOLTIP_STYLE}
              />
              <Area yAxisId="vendas"   type="monotone" dataKey="vendas"   stroke={PRIMARY}    strokeWidth={2} fill="url(#gradVendas)" dot={{ r: 3, fill: PRIMARY, strokeWidth: 0 }} activeDot={{ r: 4, strokeWidth: 0 }} />
              <Area yAxisId="producao" type="monotone" dataKey="producao" stroke={CHART_BLUE} strokeWidth={2} fill="url(#gradProd)" dot={{ r: 3, fill: CHART_BLUE, strokeWidth: 0 }} activeDot={{ r: 4, strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Donut chart ── */}
      <div className="bg-card rounded-xl border border-border shadow-card hover:shadow-card-hover transition-shadow duration-200">
        <div className="px-5 py-4 border-b border-border/60">
          <h3 className="text-[13px] font-semibold text-foreground tracking-tight">
            Distribuição de Estoque
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">por categoria</p>
        </div>
        <div className="px-2 pt-2 pb-4">
          {donutData.length === 0 ? (
            <div className="flex items-center justify-center h-[160px] text-muted-foreground text-xs">
              Sem dados de estoque
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="42%"
                  innerRadius="38%"
                  outerRadius="62%"
                  paddingAngle={3}
                  dataKey="value"
                >
                  {donutData.map((_, i) => (
                    <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} stroke="hsl(var(--card))" strokeWidth={2} />
                  ))}
                </Pie>
                <Legend
                  iconType="circle"
                  iconSize={7}
                  formatter={(v) => <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{v}</span>}
                />
                <Tooltip
                  formatter={(v: number) => `${v.toLocaleString("pt-BR")} un.`}
                  contentStyle={CARD_TOOLTIP_STYLE}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

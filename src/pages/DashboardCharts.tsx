import { Package, Truck, ChartBar as BarChart3 } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';

const CustomTooltip = ({ active, payload, label, formatter }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background/95 border border-border p-3 rounded-lg shadow-lg backdrop-blur-sm">
        {label && <p className="text-xs font-bold mb-1.5 text-muted-foreground">{label}</p>}
        <div className="space-y-1">
          {payload.map((item: any, index: number) => (
            <div key={index} className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color || item.fill }} />
              <p className="text-xs font-medium">
                <span className="text-muted-foreground">{item.name}:</span>{" "}
                {formatter ? formatter(item.value) : item.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

type Props = {
  monthlyData: { month: string; vendas: number; producao: number }[];
  categoryData: { name: string; value: number }[];
  topModels: { name: string; count: number }[];
  chartColors: string[];
};

export default function DashboardCharts({ monthlyData, categoryData, topModels, chartColors }: Props) {
  return (
    <div className="editorial-container editorial-stagger space-y-6">
      <EditorialPageHeader
        sectionNumber="05"
        sectionLabel="ANALYTICS · CHARTS"
        title="Análises"
        description="Tendências, distribuição de estoque e modelos mais produzidos."
      />

      {/* Section header: Tendência */}
      <div className="flex items-baseline gap-3 pt-2">
        <span className="font-display text-2xl text-muted-foreground tabular-nums">01</span>
        <span className="section-label">Tendência & Distribuição</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Monthly Trend */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Vendas vs Produção — 6 meses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyData} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="gVendas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColors[0]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColors[0]} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gProd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColors[2]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColors[2]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="vendas" name="Vendas (R$)" stroke={chartColors[0]} fillOpacity={1} fill="url(#gVendas)" strokeWidth={2.5} />
                <Area type="monotone" dataKey="producao" name="Produção (pares)" stroke={chartColors[2]} fillOpacity={1} fill="url(#gProd)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Category Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              Distribuição de Estoque
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {categoryData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8">Sem dados</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} stroke="none">
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={chartColors[i % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip formatter={(v: number) => `${v} itens`} />} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Section header: Top Modelos */}
      <div className="flex items-baseline gap-3 pt-2">
        <span className="font-display text-2xl text-muted-foreground tabular-nums">02</span>
        <span className="section-label">Top Modelos</span>
      </div>

      {/* Top Models */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" />
            Top Modelos Produzidos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topModels.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sem dados</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topModels} layout="vertical" margin={{ left: 0, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={100} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip formatter={(v: number) => `${v} pares`} />} />
                <Bar dataKey="count" name="Pares" fill={chartColors[1]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
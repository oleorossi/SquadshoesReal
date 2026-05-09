import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Product } from '@/types/inventory';

// Paleta dos gráficos puxa dos tokens (handoff Novidade) — antes tinha
// 8 hexas hardcoded misturando cores que não casavam com vermelho Squad.
const COLORS = [
  'hsl(var(--warning))',
  'hsl(var(--muted-foreground))',
  'hsl(var(--success))',
  'hsl(var(--destructive))',
  'hsl(var(--stage-cut-fg))',
  'hsl(var(--stage-sew-fg))',
  'hsl(var(--stage-assy-fg))',
  'hsl(var(--stage-fin-fg))',
];

interface StockChartsProps {
  products: Product[];
}

export function StockCharts({ products }: StockChartsProps) {
  const categoryData = useMemo(() => {
    const map = new Map<string, { count: number; value: number }>();
    products.forEach(p => {
      const existing = map.get(p.category) || { count: 0, value: 0 };
      map.set(p.category, {
        count: existing.count + 1,
        value: existing.value + p.quantity * p.unit_price,
      });
    });
    return Array.from(map.entries()).map(([name, data]) => ({
      name,
      quantidade: data.count,
      valor: Math.round(data.value * 100) / 100,
    }));
  }, [products]);

  const stockStatusData = useMemo(() => {
    let critico = 0, baixo = 0, normal = 0;
    products.forEach(p => {
      if (p.quantity <= p.min_stock * 0.5) critico++;
      else if (p.quantity <= p.min_stock) baixo++;
      else normal++;
    });
    return [
      { name: 'Crítico', value: critico, fill: 'hsl(var(--destructive))' },
      { name: 'Baixo', value: baixo, fill: 'hsl(var(--warning))' },
      { name: 'Normal', value: normal, fill: 'hsl(var(--success))' },
    ].filter(d => d.value > 0);
  }, [products]);

  const locationData = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach(p => {
      map.set(p.location, (map.get(p.location) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, itens]) => ({ name, itens }));
  }, [products]);

  const chartConfig = {
    quantidade: { label: 'Qtd Itens', color: 'hsl(35, 92%, 50%)' },
    valor: { label: 'Valor (R$)', color: 'hsl(210, 18%, 40%)' },
    itens: { label: 'Itens', color: 'hsl(35, 92%, 50%)' },
  };

  if (products.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Valor por Categoria */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground">
            Valor por Categoria (R$)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <BarChart data={categoryData} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="valor" radius={[0, 4, 4, 0]} fill="hsl(35, 92%, 50%)" />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Status do Estoque */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground">
            Status do Estoque
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center">
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <PieChart>
              <Pie
                data={stockStatusData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
                nameKey="name"
                label={({ name, value }) => `${name}: ${value}`}
              >
                {stockStatusData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <ChartTooltip content={<ChartTooltipContent />} />
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Itens por Local */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground">
            Itens por Localização
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <BarChart data={locationData} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="itens" radius={[4, 4, 0, 0]}>
                {locationData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}

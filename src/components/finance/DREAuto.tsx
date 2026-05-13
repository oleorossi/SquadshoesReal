import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useDREAuto, useDREInventoryVariation } from '@/hooks/useFinanceIntelligence';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from 'recharts';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { TrendUp as TrendingUp, FileText as FileBarChart, Package as PackageSearch, Info } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toFixed(0);
};
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtMonth = (p: string) => format(parseISO(`${p}-01`), 'MMM/yy', { locale: ptBR });

export function DREAuto() {
  const [months, setMonths] = useState<3 | 6 | 12>(6);
  const { data = [], isLoading } = useDREAuto(months);
  const { data: inventoryData = [], isLoading: invLoading } = useDREInventoryVariation(months);
  const { data: company } = useQuery({
    queryKey: ['primary_company_regime'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('companies')
        .select('regime_tributario, razao_social')
        .eq('is_primary', true)
        .maybeSingle();
      return data as { regime_tributario: string; razao_social: string } | null;
    },
  });
  const isSimplesNacional = String(company?.regime_tributario || '') === '1';

  if (isLoading) return <Skeleton className="h-96" />;

  const totalReceita = data.reduce((s, d) => s + d.receita, 0);
  const totalCMV = data.reduce((s, d) => s + d.cmv, 0);
  const totalEbitda = data.reduce((s, d) => s + d.ebitda, 0);
  const avgMargem = data.length > 0 ? data.reduce((s, d) => s + d.margemBrutaPct, 0) / data.length : 0;

  return (
    <div className="space-y-4">
      {isSimplesNacional && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 flex items-start gap-2 text-sm">
          <Info className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
          <div className="text-blue-800 dark:text-blue-300">
            <strong>{company?.razao_social || 'Empresa'}</strong> está em <strong>Simples Nacional</strong>.
            PIS, COFINS, ICMS, IRPJ, CSLL, ISS já estão consolidados no DAS — o sistema
            soma pagamentos categoria <code className="font-mono text-xs bg-blue-500/10 px-1 rounded">imposto</code>
            {' '}dentro de "Despesas Operacionais" (não em linha "Impostos" separada),
            seguindo a forma correta de apresentar DRE no Simples.
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <FileBarChart className="h-4 w-4 text-primary" />
            DRE — Demonstrativo de Resultado Automático
          </h3>
          <p className="text-xs text-muted-foreground">
            Calculado automaticamente a partir das contas a pagar (CMV/despesas) e a receber (receita)
          </p>
        </div>
        <div className="flex gap-1">
          {([3, 6, 12] as const).map((m) => (
            <Button
              key={m}
              variant={months === m ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMonths(m)}
            >
              {m} meses
            </Button>
          ))}
        </div>
      </div>

      {/* Totalizadores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Receita Total</p>
            <p className="text-base font-bold text-success">{fmt(totalReceita)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">CMV Total</p>
            <p className="text-base font-bold text-destructive">{fmt(totalCMV)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">EBITDA Acumulado</p>
            <p className={cn(
              'text-base font-bold',
              totalEbitda >= 0 ? 'text-success' : 'text-destructive'
            )}>
              {fmt(totalEbitda)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Margem Bruta Média</p>
            <p className={cn(
              'text-base font-bold',
              avgMargem >= 30 ? 'text-success' : avgMargem >= 15 ? 'text-warning' : 'text-destructive'
            )}>
              {fmtPct(avgMargem)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* CMV por Variação de Estoque */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <PackageSearch className="h-4 w-4 text-primary" />
            CMV por Variação de Estoque
            <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Info className="h-3 w-3" />
              Estoque Inicial + Compras − Estoque Final
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invLoading ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">Estoque Inicial</TableHead>
                    <TableHead className="text-right">(+) Compras</TableHead>
                    <TableHead className="text-right">(−) Estoque Final</TableHead>
                    <TableHead className="text-right font-semibold">(=) CMV Calculado</TableHead>
                    <TableHead className="text-right text-muted-foreground">CMV Despesas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventoryData.map((row) => {
                    const dreRow = data.find((d) => d.period === row.period);
                    return (
                      <TableRow key={row.period}>
                        <TableCell className="font-medium">{fmtMonth(row.period)}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(row.estoqueInicial)}</TableCell>
                        <TableCell className="text-right font-mono text-success">{fmt(row.comprasPeriodo)}</TableCell>
                        <TableCell className="text-right font-mono text-destructive">{fmt(row.estoqueFinal)}</TableCell>
                        <TableCell className="text-right font-mono font-bold">{fmt(row.cmvCalculado)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground text-xs">
                          {dreRow ? fmt(dreRow.cmv) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
            <strong>CMV Calculado</strong> usa a fórmula contábil correta: Estoque Inicial + Compras recebidas no período
            − Estoque Final. Os estoques são estimados com base nos movimentos de estoque e no preço unitário atual de cada produto.
            <strong> CMV Despesas</strong> é calculado pela soma de lançamentos de contas a pagar categorizados como
            material, mão de obra ou frete.
          </p>
        </CardContent>
      </Card>

      {/* Gráfico de evolução */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Evolução Mensal</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="period" fontSize={10} tickFormatter={fmtMonth} />
              <YAxis fontSize={10} tickFormatter={fmtShort} />
              <Tooltip
                formatter={(v: number) => fmt(v)}
                labelFormatter={(p) => format(parseISO(`${p}-01`), "MMMM 'de' yyyy", { locale: ptBR })}
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="receita" fill="hsl(var(--success))" name="Receita" radius={[3, 3, 0, 0]} />
              <Bar dataKey="cmv" fill="hsl(var(--destructive))" name="CMV" radius={[3, 3, 0, 0]} />
              <Bar dataKey="despOperacionais" fill="hsl(var(--warning))" name="Desp. Operacionais" radius={[3, 3, 0, 0]} />
              <Bar dataKey="ebitda" fill="hsl(var(--primary))" name="EBITDA" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Margem bruta */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Margem Bruta (%)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="period" fontSize={10} tickFormatter={fmtMonth} />
              <YAxis fontSize={10} tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <Tooltip
                formatter={(v: number) => fmtPct(v)}
                labelFormatter={(p) => format(parseISO(`${p}-01`), "MMMM 'de' yyyy", { locale: ptBR })}
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Line
                type="monotone"
                dataKey="margemBrutaPct"
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={{ r: 4 }}
                name="Margem Bruta"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Tabela detalhada */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Detalhamento Mensal</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">(-) CMV</TableHead>
                <TableHead className="text-right">Margem Bruta</TableHead>
                <TableHead className="text-center">%</TableHead>
                <TableHead className="text-right">(-) Desp. Op.</TableHead>
                <TableHead className="text-right">EBITDA</TableHead>
                <TableHead className="text-center">%</TableHead>
                <TableHead className="text-right">(-) Impostos</TableHead>
                <TableHead className="text-right">Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((m) => (
                <TableRow key={m.period}>
                  <TableCell className="font-medium">{fmtMonth(m.period)}</TableCell>
                  <TableCell className="text-right font-mono text-success">{fmt(m.receita)}</TableCell>
                  <TableCell className="text-right font-mono text-destructive">{fmt(m.cmv)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{fmt(m.margemBruta)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={m.margemBrutaPct >= 30 ? 'default' : m.margemBrutaPct >= 15 ? 'secondary' : 'destructive'}>
                      {fmtPct(m.margemBrutaPct)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-destructive">{fmt(m.despOperacionais)}</TableCell>
                  <TableCell className={cn(
                    'text-right font-mono font-bold',
                    m.ebitda >= 0 ? 'text-success' : 'text-destructive'
                  )}>
                    {fmt(m.ebitda)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={m.ebitdaPct >= 15 ? 'default' : m.ebitdaPct >= 5 ? 'secondary' : 'destructive'}>
                      {fmtPct(m.ebitdaPct)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-destructive">{fmt(m.impostos)}</TableCell>
                  <TableCell className={cn(
                    'text-right font-mono font-bold',
                    m.resultadoLiquido >= 0 ? 'text-success' : 'text-destructive'
                  )}>
                    {fmt(m.resultadoLiquido)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatNumber } from '@/components/ui/stat-number';
import { useDREAuto, useDREInventoryVariation } from '@/hooks/useFinanceIntelligence';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from 'recharts';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { TrendUp as TrendingUp, FileText as FileBarChart, Package as PackageSearch, Info, Warning as AlertTriangle, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { percentageOf } from '@/lib/financeMath';

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
  const { data: report, isLoading, error, refetch } = useDREAuto(months);
  const {
    data: inventoryData = [],
    isLoading: invLoading,
    error: inventoryError,
    refetch: refetchInventory,
  } = useDREInventoryVariation(months, Boolean(report) && !error);
  const data = report?.months || [];
  const company = report?.company || null;
  const isSimplesNacional = String(company?.regime_tributario || '') === '1';

  if (isLoading) return <Skeleton className="h-96" />;

  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="py-8 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <p className="font-semibold text-destructive">Não foi possível calcular a DRE</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl mx-auto">
            Os números não serão exibidos enquanto alguma fonte de receita, CMV, despesa ou regime tributário estiver indisponível.
          </p>
          <p className="text-xs font-mono text-destructive/80 mt-2">{(error as Error).message}</p>
          <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Fonte vazia não é resultado zero. Com 0 recebimento, 0 pagamento e 0 CMV
  // reconhecido, a tabela abaixo sairia inteira zerada e passaria por DRE
  // legítimo de uma empresa parada — quando o que falta é lançar as baixas.
  const vazio = report?.origemVazia;
  const semNenhumLancamento = Boolean(vazio?.recebimentos && vazio?.pagamentos && vazio?.cmv);
  if (semNenhumLancamento) {
    return (
      <Card>
        <CardContent className="py-10">
          <EmptyState
            icon={AlertTriangle}
            title="Sem lançamentos no período"
            description={
              'A DRE é por regime de CAIXA: ela só enxerga título com baixa registrada. ' +
              'Na janela selecionada não há nenhum recebimento em Contas a Receber, ' +
              'nenhum pagamento em Contas a Pagar e nenhum CMV reconhecido — por isso ' +
              'não há resultado a apurar. Registre as baixas para a apuração aparecer.'
            }
          />
        </CardContent>
      </Card>
    );
  }

  const totalReceita = data.reduce((s, d) => s + d.receita, 0);
  const totalCMV = data.reduce((s, d) => s + d.cmv, 0);
  const totalEbitda = data.reduce((s, d) => s + d.ebitda, 0);
  const totalResultadoLiquido = data.reduce((s, d) => s + d.resultadoLiquido, 0);
  // % do faturamento que vira lucro líquido — calculado sobre o agregado
  // (ponderado pela receita), não a média simples dos meses. Métrica
  // principal: "se faturei R$ X, R$ Y vai pro meu bolso, ou Z%".
  const lucroLiquidoPctAgregado = percentageOf(totalResultadoLiquido, totalReceita);
  const margemBrutaPeriodo = percentageOf(totalReceita - totalCMV, totalReceita);

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
            Regime de <strong>caixa</strong> — reconhecido pela data em que o dinheiro entra
            (recebimento) / sai (pagamento). Juros de factoring entram como despesa financeira.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Em títulos com múltiplas baixas, o acumulado fica na data da última baixa até existir um razão detalhado de pagamentos.
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

      {/* Totalizadores — "% vai pro bolso" em destaque na primeira linha,
          tamanho maior que os secundários porque é a métrica principal.
          Benchmark de mercado indústria calçadista: ≥15% saudável, 8-15%
          aceitável, <8% pede atenção (margens apertadas). */}
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="pt-4 pb-4">
          {totalReceita <= 0 ? (
            <div className="flex items-start gap-3 py-2">
              <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Sem receita recebida no período</p>
                <p className="text-xs text-muted-foreground mt-1">
                  A margem não é calculável até existir baixa de recebimento com data de pagamento. Títulos apenas vencendo no período não entram na DRE de caixa.
                </p>
              </div>
            </div>
          ) : (
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Quanto do faturamento foi pro bolso
              </p>
              <p className={cn(
                'display text-4xl tabular-nums leading-none',
                lucroLiquidoPctAgregado >= 15 ? 'text-success'
                  : lucroLiquidoPctAgregado >= 8 ? 'text-warning'
                  : 'text-destructive'
              )}>
                {fmtPct(lucroLiquidoPctAgregado)}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">
                <span className="font-mono">{fmt(totalResultadoLiquido)}</span> de lucro líquido
                <span className="mx-1">·</span>
                sobre <span className="font-mono">{fmt(totalReceita)}</span> de faturamento ({months} meses)
              </p>
            </div>
            <div className="text-xs text-muted-foreground max-w-sm leading-relaxed">
              <p className="font-mono text-[10px] mb-1">FÓRMULA (regime caixa)</p>
              <p>
                Receita recebida − CMV reconhecido (proporcional ao recebimento) − Despesas Operacionais − Impostos − Juros Factoring
              </p>
              <p className="mt-1 text-[10px]">
                Benchmark indústria: ≥15% saudável · 8–15% ok · &lt;8% atenção
              </p>
            </div>
          </div>
          )}
        </CardContent>
      </Card>

      {/* Auditoria visual 01/08/2026 (M29): números dos KPIs usam o StatNumber
          canônico (Anton adaptativo) em vez de <p className="text-base"> ad-hoc
          — o número volta a dominar o card, como no resto do sistema. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Receita Total</p>
            <StatNumber value={fmt(totalReceita)} base={24} min={14} className="text-success" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">CMV Total</p>
            <StatNumber value={fmt(totalCMV)} base={24} min={14} className="text-destructive" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">EBITDA Acumulado</p>
            <StatNumber
              value={fmt(totalEbitda)}
              base={24}
              min={14}
              className={totalEbitda >= 0 ? 'text-success' : 'text-destructive'}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Margem Bruta do Período</p>
            <StatNumber
              value={fmtPct(margemBrutaPeriodo)}
              base={24}
              min={14}
              className={margemBrutaPeriodo >= 30 ? 'text-success' : margemBrutaPeriodo >= 15 ? 'text-warning' : 'text-destructive'}
            />
          </CardContent>
        </Card>
      </div>

      {/* CMV por Variação de Estoque */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <PackageSearch className="h-4 w-4 text-primary" />
            CMV por Variação de Estoque
            <Badge variant="outline" className="text-[10px] font-normal">referência · competência</Badge>
            <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Info className="h-3 w-3" />
              Estoque Inicial + Compras − Estoque Final
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invLoading ? (
            <Skeleton className="h-32" />
          ) : inventoryError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-center">
              <p className="text-sm font-semibold text-destructive">Falha ao calcular a variação de estoque</p>
              <p className="text-xs text-muted-foreground mt-1">{(inventoryError as Error).message}</p>
              <Button size="sm" variant="outline" className="mt-3 gap-1.5" onClick={() => refetchInventory()}>
                <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
              </Button>
            </div>
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
                    <TableHead className="text-right text-muted-foreground">CMV Reconhecido (caixa)</TableHead>
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
            <strong>CMV Calculado</strong> (referência, competência) usa a fórmula contábil de variação de estoque:
            Estoque Inicial + Compras recebidas no período − Estoque Final. Os estoques são estimados com base nos
            movimentos de estoque e no preço unitário atual de cada produto.
            <strong> CMV Reconhecido (caixa)</strong> é o que a DRE principal usa: o CMV de cada venda
            (order_costs → sale_order_cmv) reconhecido proporcional ao recebimento do cliente (cash matching) na
            data do recebimento.
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
              {/* Auditoria visual 01/08/2026 (A15+A16): EBITDA usava --primary,
                  que é a MESMA cor de --destructive (CMV) — barras idênticas; e
                  Receita verde vs CMV vermelho era par ilegível pra daltônico.
                  Receita azul / saída vermelha (padrão bancário) + EBITDA roxo. */}
              <Bar dataKey="receita" fill="hsl(var(--chart-2))" name="Receita" radius={[3, 3, 0, 0]} />
              <Bar dataKey="cmv" fill="hsl(var(--destructive))" name="CMV" radius={[3, 3, 0, 0]} />
              <Bar dataKey="despOperacionais" fill="hsl(var(--warning))" name="Desp. Operacionais" radius={[3, 3, 0, 0]} />
              <Bar dataKey="ebitda" fill="hsl(var(--chart-4))" name="EBITDA" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Margem bruta + Lucro líquido — comparativo em um gráfico só.
          Margem bruta = receita − CMV (antes de despesas/impostos).
          Lucro líquido = % final que sobra (o "vai pro bolso"). */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Evolução de Margens (%)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
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
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="margemBrutaPct"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 3 }}
                name="Margem Bruta"
              />
              <Line
                type="monotone"
                dataKey="ebitdaPct"
                stroke="hsl(var(--warning))"
                strokeWidth={2}
                dot={{ r: 3 }}
                name="EBITDA"
              />
              <Line
                type="monotone"
                dataKey="resultadoLiquidoPct"
                stroke="hsl(var(--success))"
                strokeWidth={3}
                dot={{ r: 4 }}
                name="% bolso (Lucro Líquido)"
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
                <TableHead className="text-right">(-) Juros Fact.</TableHead>
                <TableHead className="text-right">Resultado</TableHead>
                <TableHead className="text-center">% bolso</TableHead>
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
                  <TableCell className="text-right font-mono text-destructive">{fmt(m.jurosFactoring)}</TableCell>
                  <TableCell className={cn(
                    'text-right font-mono font-bold',
                    m.resultadoLiquido >= 0 ? 'text-success' : 'text-destructive'
                  )}>
                    {fmt(m.resultadoLiquido)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={m.resultadoLiquidoPct >= 15 ? 'default' : m.resultadoLiquidoPct >= 8 ? 'secondary' : 'destructive'}>
                      {fmtPct(m.resultadoLiquidoPct)}
                    </Badge>
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

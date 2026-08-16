import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCashFlowProjection } from '@/hooks/useFinanceIntelligence';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { TrendUp as TrendingUp, TrendDown as TrendingDown, Warning as AlertTriangle, Calendar, ArrowsClockwise as RefreshCw, Info } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { StatNumber } from '@/components/ui/stat-number';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toFixed(0);
};

export function CashFlowProjection() {
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);
  const { data, isLoading, error, refetch } = useCashFlowProjection(horizon);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Projeção de Fluxo de Caixa
          </h3>
          <p className="text-xs text-muted-foreground">
            Saldo bancário atual + títulos em aberto por data de vencimento. PVs aprovados entram pela conta a receber sincronizada.
          </p>
        </div>
        <div className="flex gap-1">
          {([30, 60, 90] as const).map((h) => (
            <Button
              key={h}
              variant={horizon === h ? 'default' : 'outline'}
              size="sm"
              onClick={() => setHorizon(h)}
            >
              {h} dias
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[400px]" />
      ) : error || !data ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="h-[300px] flex flex-col items-center justify-center text-center gap-2">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-sm font-semibold text-destructive">Não foi possível calcular a projeção</p>
            <p className="text-xs text-muted-foreground max-w-lg">{(error as Error)?.message || 'A consulta não retornou dados.'}</p>
            <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {data.bankAccountsCount === 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Saldo bancário ainda não cadastrado</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  A projeção parte de R$ 0,00 e mostra apenas o efeito dos títulos. Cadastre as contas bancárias para obter o saldo final realista.
                </p>
              </div>
            </div>
          )}
          {/* KPIs do horizonte — Auditoria visual 01/08/2026 (M29): números
              via StatNumber canônico (Anton adaptativo) em vez de <p> ad-hoc. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Saldo Inicial</p>
                {data.bankAccountsCount === 0 ? (
                  <p className="text-sm font-semibold text-muted-foreground mt-1">Não cadastrado</p>
                ) : (
                  <StatNumber value={fmt(data.initialBalance)} base={24} min={14} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-success" /> Entradas Previstas
                </p>
                <StatNumber value={fmt(data.totalInflow)} base={24} min={14} className="text-success" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="h-3 w-3 text-destructive" /> Saídas Previstas
                </p>
                <StatNumber value={fmt(data.totalOutflow)} base={24} min={14} className="text-destructive" />
              </CardContent>
            </Card>
            <Card className={cn(
              data.finalBalance < 0 && 'border-destructive bg-destructive/5'
            )}>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Saldo Final</p>
                <StatNumber
                  value={fmt(data.finalBalance)}
                  base={24}
                  min={14}
                  className={data.finalBalance >= 0 ? 'text-success' : 'text-destructive'}
                />
              </CardContent>
            </Card>
          </div>

          {/* Alerta de saldo negativo */}
          {data.firstNegativeDay && (
            <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              <div>
                <p className="text-sm font-semibold text-destructive">Atenção: saldo zera em breve</p>
                <p className="text-xs text-muted-foreground">
                  Em <strong>{format(parseISO(data.firstNegativeDay), "dd 'de' MMMM", { locale: ptBR })}</strong> o
                  saldo projetado fica negativo. Saldo mínimo: <strong>{fmt(data.minBalance)}</strong>.
                </p>
              </div>
            </div>
          )}

          {/* Gráfico combinado */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Fluxo Diário e Saldo Acumulado</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={380}>
                <ComposedChart data={data.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    fontSize={10}
                    tickFormatter={(d) => format(parseISO(d), 'dd/MM')}
                    interval={Math.max(1, Math.floor(data.series.length / 12))}
                  />
                  <YAxis yAxisId="left" fontSize={10} tickFormatter={fmtShort} />
                  <YAxis yAxisId="right" orientation="right" fontSize={10} tickFormatter={fmtShort} />
                  <Tooltip
                    formatter={(v: number) => fmt(v)}
                    labelFormatter={(d) => format(parseISO(d as string), "dd 'de' MMMM", { locale: ptBR })}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine yAxisId="right" y={0} stroke="hsl(var(--destructive))" strokeDasharray="3 3" />
                  {/* Auditoria visual 01/08/2026 (A15+A16): Entradas azul /
                      Saídas vermelha (padrão bancário — o par verde/vermelho
                      era ilegível pra daltônico) e a linha de saldo em
                      foreground: antes usava --primary, a MESMA cor de
                      --destructive, camuflando o saldo nas barras de saída. */}
                  <Bar yAxisId="left" dataKey="inflow" fill="hsl(var(--chart-2))" name="Entradas" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="left" dataKey="outflow" fill="hsl(var(--destructive))" name="Saídas" radius={[2, 2, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="balance"
                    stroke="hsl(var(--foreground))"
                    strokeWidth={2.5}
                    dot={false}
                    name="Saldo Acumulado"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

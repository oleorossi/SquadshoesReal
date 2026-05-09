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
import { TrendingUp, TrendingDown, AlertTriangle, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toFixed(0);
};

export function CashFlowProjection() {
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);
  const { data, isLoading } = useCashFlowProjection(horizon);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Projeção de Fluxo de Caixa
          </h3>
          <p className="text-xs text-muted-foreground">
            Saldo projetado considerando contas a pagar, a receber e pedidos aprovados/faturados
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

      {isLoading || !data ? (
        <Skeleton className="h-[400px]" />
      ) : (
        <>
          {/* KPIs do horizonte */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Saldo Inicial</p>
                <p className="text-base font-bold">{fmt(data.initialBalance)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-success" /> Entradas Previstas
                </p>
                <p className="text-base font-bold text-success">{fmt(data.totalInflow)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="h-3 w-3 text-destructive" /> Saídas Previstas
                </p>
                <p className="text-base font-bold text-destructive">{fmt(data.totalOutflow)}</p>
              </CardContent>
            </Card>
            <Card className={cn(
              data.finalBalance < 0 && 'border-destructive bg-destructive/5'
            )}>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Saldo Final</p>
                <p className={cn(
                  'text-base font-bold',
                  data.finalBalance >= 0 ? 'text-success' : 'text-destructive'
                )}>
                  {fmt(data.finalBalance)}
                </p>
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
                  <Bar yAxisId="left" dataKey="inflow" fill="hsl(var(--success))" name="Entradas" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="left" dataKey="outflow" fill="hsl(var(--destructive))" name="Saídas" radius={[2, 2, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="balance"
                    stroke="hsl(var(--primary))"
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

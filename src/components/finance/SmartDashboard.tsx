import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatNumber } from '@/components/ui/stat-number';
import { Warning as AlertTriangle, TrendUp as TrendingUp, TrendDown as TrendingDown, CurrencyDollar as DollarSign, Wallet, ArrowUpRight, ArrowDownRight, WarningCircle as AlertCircle, Info, Sparkle as Sparkles, CaretRight as ChevronRight, CheckCircle, CircleNotch as Loader2, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { useFinanceAlerts, useFinanceKPIs, useCashFlowProjection } from '@/hooks/useFinanceIntelligence';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, ReferenceLine } from 'recharts';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toFixed(0);
};

// Audit visual #58: variantes de cor de texto que de fato renderizam legíveis
// sobre o bg de 5%. Antes 'text-warning-foreground' caía pra um cinza-claro
// quase invisível em light mode, e 'text-primary' com opacity 90% (aplicada
// no <p> do description) sumia também. Agora usamos text-{color}-700 em light
// e dark:text-{color}-300 — ratios passam WCAG AA sobre fundo /5.
const severityStyle = {
  critical: 'border-destructive/40 bg-destructive/5 text-destructive [&_p]:!opacity-100',
  warning: 'border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-200 [&_p]:!opacity-100',
  info: 'border-primary/40 bg-primary/5 text-foreground [&_p]:!opacity-100',
};
const severityIcon = {
  critical: <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />,
  warning: <AlertCircle className="h-4 w-4 text-warning shrink-0" />,
  info: <Info className="h-4 w-4 text-primary shrink-0" />,
};

export function SmartDashboard({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { data: kpis, isLoading: loadingKpis, error: kpisError, refetch: refetchKpis } = useFinanceKPIs();
  const { data: alerts = [], isLoading: loadingAlerts, error: alertsError } = useFinanceAlerts();
  const {
    data: cashflow,
    isLoading: loadingCashflow,
    error: cashflowError,
    refetch: refetchCashflow,
  } = useCashFlowProjection(30);
  // Surfacing errors silenciados antes (useQuery sem onError swallowed) —
  // se a query de alertas falhar, mostra aviso visível em vez de "Tudo em dia!".

  if (kpisError) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="py-8 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <p className="font-semibold text-destructive">Não foi possível montar a visão financeira</p>
          <p className="text-xs text-muted-foreground mt-1">Nenhum total será exibido com fontes incompletas.</p>
          <p className="text-xs font-mono text-destructive/80 mt-2">{(kpisError as Error).message}</p>
          <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={() => refetchKpis()}>
            <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loadingKpis || !kpis) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  const balanceColor = kpis.totalBalance < 0
    ? 'text-destructive'
    : kpis.totalBalance < 5000
      ? 'text-warning'
      : 'text-success';

  const projectedColor = kpis.netPosition < 0 ? 'text-destructive' : 'text-success';

  return (
    <div className="space-y-5">
      {(kpis.cashWarnings?.legacyDatedCount > 0 || kpis.cashWarnings?.undatedLegacyCount > 0) && <div role="alert" className="rounded-md border border-warning p-3 text-sm space-y-1">
        <p className="font-medium">Os indicadores de caixa contêm histórico anterior sem discriminação completa.</p>
        {!!kpis.cashWarnings.legacyDatedCount && <p>{kpis.cashWarnings.legacyDatedCount} valor(es) usa(m) a data antiga registrada.</p>}
        {!!kpis.cashWarnings.undatedLegacyCount && <p>Sem data comprovada e fora dos totais mensais: recebimentos {fmt(kpis.cashWarnings.undatedReceipts)} e pagamentos {fmt(kpis.cashWarnings.undatedPayments)}.</p>}
      </div>}
       {/* ─── ALERTAS INTELIGENTES (TOPO) ─── */}
       <Card className="border-primary/30 shadow-sm">
         <CardHeader className="pb-3">
           <CardTitle className="text-sm flex items-center gap-2">
             <Sparkles className="h-4 w-4 text-primary" />
             Alertas Inteligentes
             {!loadingAlerts && alerts.length > 0 && (
               <Badge variant="outline" className="ml-1 text-xs">{alerts.length}</Badge>
             )}
           </CardTitle>
         </CardHeader>
         <CardContent className="space-y-2">
           {loadingAlerts ? (
             <div className="flex items-center justify-center py-4">
               <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
               <span className="text-xs text-muted-foreground">Analisando dados financeiros...</span>
             </div>
           ) : alertsError ? (
             <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
               <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
               <div className="flex-1 min-w-0">
                 <p className="text-sm font-semibold text-destructive">Falha ao carregar alertas</p>
                 <p className="text-xs text-destructive/80 mt-0.5">
                   {(alertsError as Error)?.message || 'Erro desconhecido na consulta financeira.'}
                 </p>
                 <p className="text-xs text-muted-foreground mt-1">
                   Verifique se as tabelas bank_accounts, accounts_payable, accounts_receivable estão acessíveis.
                 </p>
               </div>
             </div>
           ) : alerts.length === 0 ? (
             <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
               <CheckCircle className="h-5 w-5 text-success shrink-0" />
               <div className="min-w-0 flex-1">
                 <p className="text-sm font-semibold text-success">
                   {kpis.bankAccountsCount === 0 ? 'Nenhum alerta nos títulos' : 'Tudo em dia'}
                 </p>
                 <p className="text-xs text-muted-foreground mt-0.5">
                   {kpis.bankAccountsCount === 0
                     ? 'Nenhuma conta vencida. Cadastre o saldo bancário para também validar cobertura e risco de caixa.'
                     : 'Saldo positivo, nenhuma conta vencida e sem projeção de saldo negativo nos próximos 30 dias.'}
                 </p>
               </div>
             </div>
           ) : (
             alerts.slice(0, 5).map((alert) => (
               <div
                 key={alert.id}
                 className={cn(
                   'flex items-start gap-3 rounded-lg border p-3 transition-all hover:shadow-sm',
                   severityStyle[alert.severity]
                 )}
               >
                 {severityIcon[alert.severity]}
                 <div className="flex-1 min-w-0">
                   <p className="text-sm font-semibold">{alert.title}</p>
                   <p className="text-xs opacity-90 mt-0.5">{alert.description}</p>
                   {alert.value !== undefined && (
                     <p className="text-xs font-mono font-bold mt-1">{fmt(alert.value)}</p>
                   )}
                 </div>
                 {alert.action && onNavigate && (
                   <Button
                     variant="outline"
                     size="sm"
                     className="shrink-0 h-7 text-xs bg-background/50"
                     onClick={() => onNavigate(alert.action!.tab)}
                   >
                     {alert.action.label}
                     <ChevronRight className="h-3 w-3 ml-0.5" />
                   </Button>
                 )}
               </div>
             ))
           )}
         </CardContent>
       </Card>

      {/* ─── KPIS PRINCIPAIS ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Saldo cadastrado em bancos</p>
                {kpis.bankAccountsCount === 0 ? (
                  // Sem contas cadastradas: "R$ 0,00" parecia dado real e
                  // contradizia o alerta de saldo. Estado vazio orientativo
                  // deixa claro que falta integração/cadastro (issue 7).
                  <p className="text-sm font-semibold text-muted-foreground leading-tight">
                    Sem contas
                    <span className="block text-[11px] font-normal text-muted-foreground/80">
                      Cadastre em Configurações
                    </span>
                  </p>
                ) : (
                  // Auditoria visual 01/08/2026 (M29): número de KPI usa o
                  // StatNumber canônico (Anton adaptativo) em vez de <p> ad-hoc.
                  <StatNumber value={fmt(kpis.totalBalance)} base={26} min={14} className={balanceColor} />
                )}
                {kpis.bankAccountsCount > 0 && <p className="text-xs text-muted-foreground mt-1">Baixas de títulos não atualizam este saldo automaticamente.</p>}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-success/10 flex items-center justify-center">
                <ArrowUpRight className="h-5 w-5 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">A Receber</p>
                <StatNumber value={fmt(kpis.totalReceivable)} base={26} min={14} className="text-success" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                <ArrowDownRight className="h-5 w-5 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">A Pagar</p>
                <StatNumber value={fmt(kpis.totalPayable)} base={26} min={14} className="text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                'h-10 w-10 rounded-lg flex items-center justify-center',
                kpis.netPosition >= 0 ? 'bg-success/10' : 'bg-destructive/10'
              )}>
                <DollarSign className={cn('h-5 w-5', projectedColor)} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Posição Líquida</p>
                <StatNumber value={fmt(kpis.netPosition)} base={26} min={14} className={projectedColor} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── MOVIMENTO REALIZADO DO MÊS ─── */}
      <div className="flex items-center justify-between gap-3 flex-wrap -mb-2">
        <div>
          <h3 className="text-sm font-semibold">Movimento realizado no mês</h3>
          <p className="text-xs text-muted-foreground">Regime de caixa: somente valores efetivamente recebidos ou pagos.</p>
        </div>
        <Badge variant="outline" className="text-xs">Realizado · Caixa</Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Recebido no Mês</p>
              {kpis.revenueGrowth !== 0 && (
                <Badge
                  variant={kpis.revenueGrowth > 0 ? 'default' : 'destructive'}
                  className="text-xs gap-0.5"
                >
                  {kpis.revenueGrowth > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                  {kpis.revenueGrowth > 0 ? '+' : ''}{kpis.revenueGrowth.toFixed(1)}%
                </Badge>
              )}
            </div>
            <p className="display text-xl tabular-nums text-success mt-1">{fmt(kpis.monthRevenue)}</p>
            <p className="text-xs text-muted-foreground mt-1">Ainda previsto no mês: {fmt(kpis.monthReceivableForecast)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground">Pago no Mês</p>
            <p className="display text-xl tabular-nums text-destructive mt-1">{fmt(kpis.monthExpenses)}</p>
            <p className="text-xs text-muted-foreground mt-1">Ainda previsto no mês: {fmt(kpis.monthPayableForecast)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground">Resultado de Caixa</p>
            <p className={cn(
              'display text-xl tabular-nums mt-1',
              kpis.monthResult >= 0 ? 'text-success' : 'text-destructive'
            )}>
              {fmt(kpis.monthResult)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Resultado ainda previsto: {fmt(kpis.monthForecastResult)}</p>
          </CardContent>
        </Card>
      </div>

      {/* ─── PROJEÇÃO DE FLUXO DE CAIXA 30 DIAS ─── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Projeção de Saldo — Próximos 30 dias</CardTitle>
            {kpis.bankAccountsCount === 0 ? (
              <Badge variant="outline" className="text-xs">Parte de R$ 0 · sem bancos</Badge>
            ) : cashflow?.firstNegativeDay && (
              <Badge variant="destructive" className="text-xs">
                Saldo zera em {format(parseISO(cashflow.firstNegativeDay), "dd 'de' MMM", { locale: ptBR })}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingCashflow ? (
            <Skeleton className="h-[220px]" />
          ) : cashflowError || !cashflow ? (
            <div className="h-[220px] flex flex-col items-center justify-center text-center gap-2">
              <AlertTriangle className="h-7 w-7 text-destructive" />
              <p className="text-sm font-semibold text-destructive">Falha ao carregar a projeção</p>
              <p className="text-xs text-muted-foreground max-w-lg">{(cashflowError as Error)?.message || 'A projeção não retornou dados.'}</p>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refetchCashflow()}>
                <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
              </Button>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={cashflow.series}>
                <defs>
                  <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  fontSize={10}
                  tickFormatter={(d) => format(parseISO(d), 'dd/MM')}
                  interval={Math.max(1, Math.floor(cashflow.series.length / 8))}
                />
                <YAxis fontSize={10} tickFormatter={fmtShort} />
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  labelFormatter={(d) => format(parseISO(d as string), "dd 'de' MMMM", { locale: ptBR })}
                  contentStyle={{
                    backgroundColor: 'hsl(var(--background))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="3 3" />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#balanceGradient)"
                  name="Saldo Projetado"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

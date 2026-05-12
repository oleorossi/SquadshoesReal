/**
 * FinanceiroDashboard — Painel financeiro consolidado
 *
 * User: "Remodelar o módulo financeiro todo, está confuso, os alertas
 *        inteligentes não estão buscando nada."
 *
 * Estrutura:
 *  1. Header editorial (live-dot + display)
 *  2. KPIs principais (4 cards: Saldo / A receber / A pagar / Saldo líquido)
 *  3. SmartDashboard embutido (alertas inteligentes — antes só estava em /finance)
 *  4. Atalhos diretos para sub-módulos (NF-e, Contas, DRE, Fluxo de Caixa)
 *  5. Vencidos + Próximos vencimentos (compacto)
 *
 * Fix: o componente anterior (FinanceiroDashboard simples) NÃO renderizava
 * SmartDashboard, então alertas inteligentes só apareciam em /finance.
 * Agora qualquer porta de entrada ao módulo financeiro vê os alertas.
 */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { TrendUp as TrendingUp, TrendDown as TrendingDown, WarningCircle as AlertCircle, CreditCard, Receipt, ArrowUpRight, ArrowDownRight, CurrencyDollar as DollarSign, Wallet, FileXls as FileSpreadsheet, CaretRight as ChevronRight, CircleNotch as Loader2 } from '@phosphor-icons/react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SmartDashboard } from '@/components/finance/SmartDashboard';
import { NetMarginChart } from '@/components/finance/NetMarginChart';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function useFinancialOverview() {
  return useQuery({
    queryKey: ['financeiro_overview'],
    staleTime: 60_000,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      const [payRes, recRes, bankRes] = await Promise.all([
        supabase.from('accounts_payable').select('id, due_date, amount, amount_paid, status, description').neq('status', 'cancelled'),
        supabase.from('accounts_receivable').select('id, due_date, amount, amount_received, status, client_name').neq('status', 'cancelled'),
        supabase.from('bank_accounts').select('id, name, bank_name, current_balance').eq('active', true),
      ]);

      const pays = payRes.data || [];
      const recs = recRes.data || [];
      const banks = bankRes.data || [];

      const totalBalance = banks.reduce((s, b) => s + Number(b.current_balance || 0), 0);
      const totalPayable = pays
        .filter(p => p.status !== 'paid')
        .reduce((s, p) => s + Math.max(0, Number(p.amount) - Number(p.amount_paid || 0)), 0);
      const totalReceivable = recs
        .filter(r => r.status !== 'received')
        .reduce((s, r) => s + Math.max(0, Number(r.amount) - Number(r.amount_received || 0)), 0);
      const netPosition = totalBalance + totalReceivable - totalPayable;

      const overduePayables = pays.filter(p => p.status !== 'paid' && p.due_date < today);
      const overdueReceivables = recs.filter(r => r.status !== 'received' && r.due_date < today);
      const upcomingPayables = pays
        .filter(p => p.status !== 'paid' && p.due_date >= today && p.due_date <= nextWeek)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 6);

      return {
        totalBalance, totalPayable, totalReceivable, netPosition,
        banks, overduePayables, overdueReceivables, upcomingPayables,
      };
    },
  });
}

export default function FinanceiroDashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useFinancialOverview();

  return (
    <AppLayout>
      <div className="space-y-5 pb-12">
        {/* Header editorial */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <span className="live-dot" />
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
            </div>
            <h1 className="display text-3xl mt-2">Painel Financeiro</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Saldo, fluxo de caixa, alertas inteligentes e atalhos pra sub-módulos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/finance')} className="gap-1.5">
              <Wallet className="h-3.5 w-3.5" /> Contas (AR/AP)
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/nfe')} className="gap-1.5">
              <Receipt className="h-3.5 w-3.5" /> NF-e
            </Button>
          </div>
        </div>

        {/* KPIs principais */}
        {isLoading || !data ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <Card key={i}><CardContent className="p-4 h-24 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </CardContent></Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="slash-top">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Wallet className="h-3.5 w-3.5" />
                  <span className="eyebrow">Saldo bancos</span>
                </div>
                <div className={cn(
                  'display text-3xl mt-2 tabular-nums',
                  data.totalBalance < 0 ? 'text-primary' :
                  data.totalBalance < 5000 ? 'text-amber-600 dark:text-amber-400' :
                  'text-emerald-600 dark:text-emerald-400',
                )}>
                  {fmt(data.totalBalance)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {data.banks.length} {data.banks.length === 1 ? 'conta' : 'contas'} ativa{data.banks.length !== 1 && 's'}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span className="eyebrow">A Receber</span>
                </div>
                <div className="display text-3xl mt-2 tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmt(data.totalReceivable)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {data.overdueReceivables.length} vencidos
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-primary">
                  <ArrowDownRight className="h-3.5 w-3.5" />
                  <span className="eyebrow">A Pagar</span>
                </div>
                <div className="display text-3xl mt-2 tabular-nums text-primary">
                  {fmt(data.totalPayable)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {data.overduePayables.length} vencidos · {data.upcomingPayables.length} em 7 dias
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  {data.netPosition >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  <span className="eyebrow">Saldo líquido</span>
                </div>
                <div className={cn(
                  'display text-3xl mt-2 tabular-nums',
                  data.netPosition >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-primary',
                )}>
                  {fmt(data.netPosition)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Saldo + AR − AP
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Alertas Inteligentes (SmartDashboard) */}
        <SmartDashboard onNavigate={tab => navigate(`/finance?tab=${tab}`)} />

        {/* KPI: Margem líquida por período (round 10) */}
        <NetMarginChart />

        {/* Vencidos + Próximos Vencimentos */}
        {data && (
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-primary" />
                  Vencidos
                </CardTitle>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/finance?tab=payable')}>
                  Ver todos <ChevronRight className="h-3 w-3" />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {data.overduePayables.length === 0 && data.overdueReceivables.length === 0 ? (
                  <EmptyState
                    icon={CreditCard}
                    title="Nada vencido"
                    description="Todas as contas estão em dia."
                    size="sm"
                  />
                ) : (
                  <div className="divide-y border-t">
                    {data.overduePayables.slice(0, 5).map(p => (
                      <div key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{p.description}</p>
                          <p className="text-[11px] text-primary tabular-nums">
                            Pagar · venceu em {format(new Date(p.due_date + 'T00:00:00'), 'dd/MM/yyyy')}
                          </p>
                        </div>
                        <Badge variant="destructive" className="font-mono shrink-0">
                          {fmt(Number(p.amount) - Number(p.amount_paid || 0))}
                        </Badge>
                      </div>
                    ))}
                    {data.overdueReceivables.slice(0, 5).map(r => (
                      <div key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{r.client_name}</p>
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 tabular-nums">
                            Receber · venceu em {format(new Date(r.due_date + 'T00:00:00'), 'dd/MM/yyyy')}
                          </p>
                        </div>
                        <Badge variant="outline" className="border-amber-500 text-amber-600 font-mono shrink-0">
                          {fmt(Number(r.amount) - Number(r.amount_received || 0))}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  Próximos vencimentos · 7 dias
                </CardTitle>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/finance?tab=payable')}>
                  Ver todos <ChevronRight className="h-3 w-3" />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {data.upcomingPayables.length === 0 ? (
                  <EmptyState
                    icon={DollarSign}
                    title="Nenhum vencimento"
                    description="Sem contas a pagar nos próximos 7 dias."
                    size="sm"
                  />
                ) : (
                  <div className="divide-y border-t">
                    {data.upcomingPayables.map(p => (
                      <div key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{p.description}</p>
                          <p className="text-[11px] text-muted-foreground tabular-nums">
                            {format(new Date(p.due_date + 'T00:00:00'), 'dd/MM/yyyy')}
                          </p>
                        </div>
                        <span className="font-mono text-sm font-semibold tabular-nums shrink-0">
                          {fmt(Number(p.amount) - Number(p.amount_paid || 0))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Atalhos para sub-módulos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Atalhos</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-0">
            <button
              onClick={() => navigate('/finance')}
              className="flex flex-col items-start gap-1.5 p-3 rounded-lg border hover:bg-muted/40 transition-colors text-left"
            >
              <Wallet className="h-5 w-5 text-primary" />
              <p className="text-sm font-semibold">Contas (AR/AP)</p>
              <p className="text-xs text-muted-foreground">Lançamentos e pagamentos</p>
            </button>
            <button
              onClick={() => navigate('/nfe')}
              className="flex flex-col items-start gap-1.5 p-3 rounded-lg border hover:bg-muted/40 transition-colors text-left"
            >
              <Receipt className="h-5 w-5 text-primary" />
              <p className="text-sm font-semibold">NF-e</p>
              <p className="text-xs text-muted-foreground">Emissão e consulta</p>
            </button>
            <button
              onClick={() => navigate('/finance?tab=dre')}
              className="flex flex-col items-start gap-1.5 p-3 rounded-lg border hover:bg-muted/40 transition-colors text-left"
            >
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <p className="text-sm font-semibold">DRE</p>
              <p className="text-xs text-muted-foreground">Demonstrativo de resultado</p>
            </button>
            <button
              onClick={() => navigate('/finance?tab=cashflow')}
              className="flex flex-col items-start gap-1.5 p-3 rounded-lg border hover:bg-muted/40 transition-colors text-left"
            >
              <TrendingUp className="h-5 w-5 text-primary" />
              <p className="text-sm font-semibold">Fluxo de Caixa</p>
              <p className="text-xs text-muted-foreground">Projeção 30/60/90 dias</p>
            </button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

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
import { todayISO, todayPlusDaysISO } from '@/lib/date';
import { TrendUp as TrendingUp, TrendDown as TrendingDown, CreditCard, Receipt, ArrowUpRight, ArrowDownRight, CurrencyDollar as DollarSign, Wallet, FileXls as FileSpreadsheet, CaretRight as ChevronRight, CircleNotch as Loader2, Warning, ArrowsClockwise } from '@phosphor-icons/react';
import AppLayout from '@/components/layout/AppLayout';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { SmartDashboard } from '@/components/finance/SmartDashboard';
import { NetMarginChart } from '@/components/finance/NetMarginChart';
import { useMissingARSaleOrders, useReconcileMissingAR } from '@/hooks/useReconcileMissingAR';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function useFinancialOverview() {
  return useQuery({
    queryKey: ['financeiro_overview'],
    staleTime: 60_000,
    queryFn: async () => {
      const today = todayISO();
      const nextWeek = todayPlusDaysISO(7);

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
  const { data: missingAR } = useMissingARSaleOrders();
  const reconcile = useReconcileMissingAR();
  const missingTotal = (missingAR ?? []).reduce((s, o) => s + o.total, 0);

  return (
    <AppLayout>
      <div className="editorial-container editorial-stagger space-y-6 pb-12">
        <EditorialPageHeader
          sectionNumber="01"
          sectionLabel="FINANCEIRO · VISÃO GERAL"
          title="Financeiro"
          description="Saldo, fluxo de caixa, alertas inteligentes e atalhos pra sub-módulos."
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => navigate('/finance')} className="gap-1.5">
                <Wallet className="h-3.5 w-3.5" /> Contas (AR/AP)
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/nfe')} className="gap-1.5">
                <Receipt className="h-3.5 w-3.5" /> NF-e
              </Button>
            </>
          }
        />

        {/* Reconciliação de receita: PVs faturados (NF autorizada) sem conta a receber.
            A NF autoriza de forma assíncrona pelo servidor e a receita não nasce — aqui
            o gestor reconcilia em 1 clique (caminho canônico, idempotente). */}
        {missingAR && missingAR.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <Warning className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" weight="fill" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                  {missingAR.length} {missingAR.length === 1 ? 'pedido faturado' : 'pedidos faturados'} com NF autorizada sem conta a receber
                </p>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
                  A NF autorizou pela sincronização automática e a receita não foi gerada · {fmt(missingTotal)}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={reconcile.isPending}
              onClick={() => reconcile.mutate(missingAR)}
            >
              {reconcile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowsClockwise className="h-3.5 w-3.5" />}
              Reconciliar {missingAR.length}
            </Button>
          </div>
        )}

        {/* Section header: KPIs */}
        <div className="flex items-baseline gap-3 pt-2">
          <span className="font-display text-2xl text-muted-foreground tabular-nums">01</span>
          <span className="section-label">Indicadores</span>
        </div>

        {/* KPIs principais */}
        {isLoading || !data ? (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <Card key={i}><CardContent className="p-4 h-24 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </CardContent></Card>
            ))}
          </div>
        ) : (
          <StatGrid>
            <StatCard
              label="Saldo bancos"
              value={fmt(data.totalBalance)}
              icon={Wallet}
              tone={
                data.totalBalance < 0 ? 'destructive' :
                data.totalBalance < 5000 ? 'warning' : 'success'
              }
              hint={`${data.banks.length} ${data.banks.length === 1 ? 'conta' : 'contas'} ativa${data.banks.length !== 1 ? 's' : ''}`}
            />
            <StatCard
              label="A Receber"
              value={fmt(data.totalReceivable)}
              icon={ArrowUpRight}
              tone="success"
              hint={`${data.overdueReceivables.length} vencidos`}
            />
            <StatCard
              label="A Pagar"
              value={fmt(data.totalPayable)}
              icon={ArrowDownRight}
              tone="destructive"
              hint={`${data.overduePayables.length} vencidos · ${data.upcomingPayables.length} em 7 dias`}
            />
            <StatCard
              label="Saldo líquido"
              value={fmt(data.netPosition)}
              icon={data.netPosition >= 0 ? TrendingUp : TrendingDown}
              tone={data.netPosition >= 0 ? 'success' : 'destructive'}
              hint="Saldo + AR − AP"
            />
          </StatGrid>
        )}

        {/* Section header: Alertas */}
        <div className="flex items-baseline gap-3 pt-2">
          <span className="font-display text-2xl text-muted-foreground tabular-nums">02</span>
          <span className="section-label">Alertas Inteligentes</span>
        </div>

        {/* Alertas Inteligentes (SmartDashboard) */}
        <SmartDashboard onNavigate={tab => navigate(`/finance?tab=${tab}`)} />

        {/* Section header: Margem */}
        <div className="flex items-baseline gap-3 pt-2">
          <span className="font-display text-2xl text-muted-foreground tabular-nums">03</span>
          <span className="section-label">Margem Líquida</span>
        </div>

        {/* KPI: Margem líquida por período (round 10) */}
        <NetMarginChart />

        {/* Section header: Vencimentos */}
        <div className="flex items-baseline gap-3 pt-2">
          <span className="font-display text-2xl text-muted-foreground tabular-nums">04</span>
          <span className="section-label">Vencimentos</span>
        </div>

        {/* Vencidos + Próximos Vencimentos */}
        {data && (
          <div className="grid sm:grid-cols-1 md:grid-cols-2 gap-4">
            <Panel
              eyebrow="FINANCEIRO · VENCIMENTOS"
              title="Vencidos"
              actions={
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/finance?tab=payable')}>
                  Ver todos <ChevronRight className="h-3 w-3" />
                </Button>
              }
              flush
            >
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
                          <p className="text-xs text-primary tabular-nums">
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
                          <p className="text-xs text-amber-600 dark:text-amber-400 tabular-nums">
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
            </Panel>

            <Panel
              eyebrow="FINANCEIRO · VENCIMENTOS"
              title="Próximos vencimentos · 7 dias"
              actions={
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/finance?tab=payable')}>
                  Ver todos <ChevronRight className="h-3 w-3" />
                </Button>
              }
              flush
            >
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
                          <p className="text-xs text-muted-foreground tabular-nums">
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
            </Panel>
          </div>
        )}

        {/* Section header: Atalhos */}
        <div className="flex items-baseline gap-3 pt-2">
          <span className="font-display text-2xl text-muted-foreground tabular-nums">05</span>
          <span className="section-label">Atalhos</span>
        </div>

        {/* Atalhos para sub-módulos */}
        <Panel eyebrow="FINANCEIRO · NAVEGAÇÃO" title="Atalhos">
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3">
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
          </div>
        </Panel>
      </div>
    </AppLayout>
  );
}

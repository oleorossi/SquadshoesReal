import AppLayout from "@/components/layout/AppLayout";
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DollarSign, TrendingUp, TrendingDown, AlertCircle, CreditCard, Receipt, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function useFinanceiroData() {
  return useQuery({
    queryKey: ['dashboard-financeiro'],
    queryFn: async () => {
      const now = new Date();
      const monthStart = startOfMonth(now).toISOString().slice(0, 10);
      const monthEnd = endOfMonth(now).toISOString().slice(0, 10);

      const [payablesRes, receivablesRes, entriesRes, bankRes, poRes] = await Promise.all([
        supabase.from('accounts_payable').select('*').limit(2000),
        supabase.from('accounts_receivable').select('*').limit(2000),
        supabase.from('financial_entries').select('*').gte('entry_date', monthStart).lte('entry_date', monthEnd),
        supabase.from('bank_accounts').select('*').eq('active', true),
        supabase.from('purchase_orders').select('*').eq('status', 'pending'),
      ]);

      const payables = payablesRes.data || [];
      const receivables = receivablesRes.data || [];
      const entries = entriesRes.data || [];
      const banks = bankRes.data || [];
      const pendingPOs = poRes.data || [];

      // Totals
      const totalPayable = payables.filter(p => !['paid', 'cancelled'].includes(p.status)).reduce((s, p) => s + Math.max(0, p.amount - p.amount_paid), 0);
      const totalReceivable = receivables.filter(r => !['received', 'cancelled'].includes(r.status)).reduce((s, r) => s + Math.max(0, r.amount - r.amount_received), 0);
      const totalBankBalance = banks.reduce((s, b) => s + b.current_balance, 0);
      const pendingPOValue = pendingPOs.reduce((s, p) => s + p.total_value, 0);

      // Month entries — exclude cancelled so they don't inflate totals
      const monthRevenue = entries.filter(e => e.type === 'receita' && e.status !== 'cancelado').reduce((s, e) => s + e.amount, 0);
      const monthExpenses = entries.filter(e => e.type === 'despesa' && e.status !== 'cancelado').reduce((s, e) => s + e.amount, 0);

      // Overdue
      const today = now.toISOString().slice(0, 10);
      const overduePayables = payables.filter(p => !['paid', 'cancelled'].includes(p.status) && p.due_date < today);
      const overdueReceivables = receivables.filter(r => !['received', 'cancelled'].includes(r.status) && r.due_date < today);

      // Upcoming payables (next 7 days)
      const nextWeek = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
      const upcomingPayables = payables
        .filter(p => !['paid', 'cancelled'].includes(p.status) && p.due_date >= today && p.due_date <= nextWeek)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 8);

      // Top expense categories — saldo pendente real por categoria
      const catTotals = new Map<string, number>();
      for (const p of payables.filter(x => !['paid', 'cancelled'].includes(x.status))) {
        catTotals.set(p.category, (catTotals.get(p.category) || 0) + Math.max(0, p.amount - p.amount_paid));
      }
      const topCategories = Array.from(catTotals.entries())
        .map(([cat, total]) => ({ category: cat, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      return {
        totalPayable,
        totalReceivable,
        totalBankBalance,
        pendingPOValue,
        pendingPOCount: pendingPOs.length,
        monthRevenue,
        monthExpenses,
        overduePayables,
        overdueReceivables,
        upcomingPayables,
        topCategories,
        banks,
      };
    },
  });
}

const CAT_LABELS: Record<string, string> = {
  material: 'Material', servico: 'Serviço', imposto: 'Imposto', salario: 'Salário',
  aluguel: 'Aluguel', energia: 'Energia', outros: 'Outros', venda: 'Venda',
};

export default function FinanceiroDashboard() {
  const { data, isLoading } = useFinanceiroData();

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm">Carregando...</span>
    </div>
  );
  if (!data) return null;

  const netBalance = data.totalReceivable - data.totalPayable;

  return (
    
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Resumo Financeiro</h1>
          <p className="text-sm text-muted-foreground">Fluxo de caixa, contas e obrigações</p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center"><ArrowUpRight className="h-5 w-5 text-green-600" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">A Receber</p>
                  <p className="text-lg font-bold text-green-600">{fmt(data.totalReceivable)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center"><ArrowDownRight className="h-5 w-5 text-destructive" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">A Pagar</p>
                  <p className="text-lg font-bold text-destructive">{fmt(data.totalPayable)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><DollarSign className="h-5 w-5 text-primary" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">Saldo Bancos</p>
                  <p className="text-lg font-bold">{fmt(data.totalBankBalance)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg ${netBalance >= 0 ? 'bg-green-500/10' : 'bg-destructive/10'} flex items-center justify-center`}>
                  {netBalance >= 0 ? <TrendingUp className="h-5 w-5 text-green-600" /> : <TrendingDown className="h-5 w-5 text-destructive" />}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Saldo Líquido</p>
                  <p className={`text-lg font-bold ${netBalance >= 0 ? 'text-green-600' : 'text-destructive'}`}>{fmt(netBalance)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Month summary */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Receitas do Mês</p>
              <p className="text-xl font-bold text-green-600">{fmt(data.monthRevenue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Despesas do Mês</p>
              <p className="text-xl font-bold text-destructive">{fmt(data.monthExpenses)}</p>
            </CardContent>
          </Card>
          <Card className="col-span-2 md:col-span-1">
            <CardContent className="pt-5 pb-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">OCs Pendentes</p>
              <p className="text-xl font-bold">{data.pendingPOCount} — {fmt(data.pendingPOValue)}</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Overdue */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" /> Vencidos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.overduePayables.length === 0 && data.overdueReceivables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum título vencido 🎉</p>
                ) : (
                  <>
                    {data.overduePayables.slice(0, 5).map(p => (
                      <div key={p.id} className="flex items-center justify-between text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.description}</p>
                          <p className="text-xs text-destructive">Venceu: {format(new Date(p.due_date), 'dd/MM/yyyy')}</p>
                        </div>
                        <Badge variant="destructive">{fmt(p.amount - p.amount_paid)}</Badge>
                      </div>
                    ))}
                    {data.overdueReceivables.slice(0, 5).map(r => (
                      <div key={r.id} className="flex items-center justify-between text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.client_name}</p>
                          <p className="text-xs text-amber-600">A receber vencido: {format(new Date(r.due_date), 'dd/MM/yyyy')}</p>
                        </div>
                        <Badge variant="outline" className="border-amber-500 text-amber-600">{fmt(r.amount - r.amount_received)}</Badge>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Upcoming payments */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4 text-primary" /> Próximos Vencimentos (7 dias)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.upcomingPayables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum vencimento nos próximos 7 dias</p>
                ) : data.upcomingPayables.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.description}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(p.due_date), 'dd/MM/yyyy')}</p>
                    </div>
                    <span className="font-semibold shrink-0">{fmt(p.amount - p.amount_paid)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Bank accounts */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" /> Contas Bancárias</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.banks.map(b => (
                  <div key={b.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{b.name}</p>
                      <p className="text-xs text-muted-foreground">{b.bank_name}</p>
                    </div>
                    <span className={`font-semibold ${b.current_balance >= 0 ? 'text-green-600' : 'text-destructive'}`}>{fmt(b.current_balance)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top categories */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" /> Principais Categorias de Despesa</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.topCategories.map((c, i) => (
                  <div key={c.category} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{i + 1}</span>
                      <span className="text-sm font-medium">{CAT_LABELS[c.category] || c.category}</span>
                    </div>
                    <span className="text-sm font-semibold">{fmt(c.total)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    
  );
}

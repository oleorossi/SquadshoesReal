import { useState, useMemo } from 'react';
import { escapeHtml } from '@/lib/htmlUtils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  TrendingUp, Users, Clock, AlertTriangle, Printer,
  BarChart3, ArrowUpDown, DollarSign, Building2,
} from 'lucide-react';
import { differenceInDays, parseISO, format, startOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAccountsPayable, useAccountsReceivable } from '@/hooks/useFinance';
import { DREAuto } from '@/components/finance/DREAuto';
import { CashFlowProjection } from '@/components/finance/CashFlowProjection';
import { cn } from '@/lib/utils';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$${(v / 1_000).toFixed(0)}k`;
  return fmt(v);
};

const CHART_COLORS = [
  'hsl(var(--primary))', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#06B6D4', '#F97316', '#EC4899',
];

const CATEGORY_LABELS: Record<string, string> = {
  material: 'Material',
  servico: 'Serviço',
  frete: 'Frete',
  imposto: 'Imposto',
  mao_de_obra: 'Mão de Obra',
  overhead: 'Overhead',
  outro: 'Outros',
};

// F8 (audit): paleta de aging com variantes dark mode pra atingir contraste
// WCAG AA. text-{amber/orange/red}-600 em fundo dark caía pra ratio < 4.5:1.
// As variantes -400 mantêm legibilidade em ambos os modos.
const AGING_BUCKETS = [
  { key: 'current',  label: 'A Vencer',    min: -Infinity, max: 0,        color: 'text-foreground',                        bg: 'bg-muted/40' },
  { key: 'b1_30',   label: '1–30 dias',   min: 1,         max: 30,       color: 'text-amber-700 dark:text-amber-400',     bg: 'bg-amber-500/10' },
  { key: 'b31_60',  label: '31–60 dias',  min: 31,        max: 60,       color: 'text-orange-700 dark:text-orange-400',   bg: 'bg-orange-500/10' },
  { key: 'b61_90',  label: '61–90 dias',  min: 61,        max: 90,       color: 'text-red-700 dark:text-red-400',         bg: 'bg-red-500/10' },
  { key: 'b90plus', label: '> 90 dias',   min: 91,        max: Infinity, color: 'text-destructive',                        bg: 'bg-destructive/10' },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg p-3 shadow-lg text-xs space-y-1">
      {label && <p className="font-bold text-muted-foreground mb-1">{label}</p>}
      {payload.map((item: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.fill || item.color }} />
          <span className="text-muted-foreground">{item.name}:</span>
          <span className="font-semibold">{fmtShort(item.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Aging Tab ────────────────────────────────────────────────────────────────

function AgingTab() {
  const { data: receivables = [] } = useAccountsReceivable();
  const { data: payables = [] } = useAccountsPayable();
  const [view, setView] = useState<'receivable' | 'payable'>('receivable');
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const receivableAging = useMemo(() => AGING_BUCKETS.map(b => {
    const items = receivables.filter(r => {
      if (r.status === 'received' || r.status === 'cancelled') return false;
      if (!r.due_date) return false;
      const days = differenceInDays(today, parseISO(r.due_date));
      return days >= b.min && days <= b.max;
    });
    const amount = items.reduce((s, r) => s + Math.max(0, (r.amount || 0) - (r.amount_received || 0)), 0);
    return { ...b, amount, count: items.length, items };
  }), [receivables]);

  const payableAging = useMemo(() => AGING_BUCKETS.map(b => {
    const items = payables.filter(p => {
      if (p.status === 'paid' || p.status === 'cancelled') return false;
      if (!p.due_date) return false;
      const days = differenceInDays(today, parseISO(p.due_date));
      return days >= b.min && days <= b.max;
    });
    const amount = items.reduce((s, p) => s + Math.max(0, (p.amount || 0) - (p.amount_paid || 0)), 0);
    return { ...b, amount, count: items.length, items };
  }), [payables]);

  const aging = view === 'receivable' ? receivableAging : payableAging;
  const overdueTotal = aging.filter(b => b.key !== 'current').reduce((s, b) => s + b.amount, 0);
  const totalPending = aging.reduce((s, b) => s + b.amount, 0);

  const detailItems = useMemo(() => {
    if (view === 'receivable') {
      return receivables
        .filter(r => r.status !== 'received' && r.status !== 'cancelled' && r.due_date)
        .map(r => ({
          name: r.client_name || '—',
          description: r.description,
          due_date: r.due_date,
          amount: Math.max(0, (r.amount || 0) - (r.amount_received || 0)),
          days: differenceInDays(today, parseISO(r.due_date!)),
        }))
        .filter(r => r.days > 0)
        .sort((a, b) => b.days - a.days);
    }
    return payables
      .filter(p => p.status !== 'paid' && p.status !== 'cancelled' && p.due_date)
      .map(p => ({
        name: p.suppliers?.name || '—',
        description: p.description,
        due_date: p.due_date,
        amount: Math.max(0, (p.amount || 0) - (p.amount_paid || 0)),
        days: differenceInDays(today, parseISO(p.due_date!)),
      }))
      .filter(p => p.days > 0)
      .sort((a, b) => b.days - a.days);
  }, [view, receivables, payables]);

  const handlePrint = () => {
    const rows = detailItems.map(item => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.description) || '—'}</td>
      <td>${format(parseISO(item.due_date!), 'dd/MM/yyyy')}</td>
      <td style="text-align:center;color:${item.days > 90 ? '#ef4444' : item.days > 60 ? '#dc2626' : item.days > 30 ? '#ea580c' : '#d97706'}">${item.days} dias</td>
      <td style="text-align:right;font-weight:700">${fmt(item.amount)}</td>
    </tr>`).join('');
    const total = detailItems.reduce((s, i) => s + i.amount, 0);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Aging — ${view === 'receivable' ? 'A Receber' : 'A Pagar'}</title>
    <style>@page{size:A4;margin:10mm}body{font-family:system-ui;font-size:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #e5e7eb;padding:5px 8px}th{background:#f9fafb;font-weight:600}</style>
    </head><body>
    <h2 style="margin:0 0 8px">Relatório de Aging — ${view === 'receivable' ? 'Contas a Receber' : 'Contas a Pagar'}</h2>
    <p style="color:#6b7280;margin:0 0 16px">Gerado em ${format(today, "dd/MM/yyyy 'às' HH:mm")}</p>
    <table><thead><tr><th>Cliente/Fornecedor</th><th>Descrição</th><th>Vencimento</th><th>Atraso</th><th>Valor em Aberto</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">TOTAL VENCIDO</td><td style="text-align:right;font-weight:700">${fmt(total)}</td></tr></tfoot>
    </table></body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 300); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Select value={view} onValueChange={v => setView(v as any)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="receivable">Contas a Receber</SelectItem>
              <SelectItem value="payable">Contas a Pagar</SelectItem>
            </SelectContent>
          </Select>
          {overdueTotal > 0 && (
            <Badge variant="destructive" className="text-xs">
              {fmt(overdueTotal)} vencido
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={handlePrint}>
          <Printer className="h-4 w-4" /> Imprimir
        </Button>
      </div>

      {/* Summary buckets */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {aging.map(b => (
          <Card key={b.key} className={cn('border', b.key !== 'current' && b.amount > 0 ? b.bg : '')}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{b.label}</p>
              <p className={cn('text-base font-bold font-mono mt-0.5', b.key !== 'current' && b.amount > 0 ? b.color : '')}>
                {fmtShort(b.amount)}
              </p>
              <p className="text-xs text-muted-foreground">{b.count} conta(s)</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Overdue detail table */}
      {detailItems.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Itens Vencidos ({detailItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>{view === 'receivable' ? 'Cliente' : 'Fornecedor'}</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-center">Atraso</TableHead>
                    <TableHead className="text-right">Em Aberto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailItems.slice(0, 50).map((item, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{item.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-48 truncate">{item.description}</TableCell>
                      <TableCell className="text-xs">{format(parseISO(item.due_date!), 'dd/MM/yyyy')}</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn('text-xs',
                            item.days > 90 ? 'border-destructive/50 text-destructive bg-destructive/10' :
                            item.days > 60 ? 'border-red-500/50 text-red-600 bg-red-500/10' :
                            item.days > 30 ? 'border-orange-500/50 text-orange-600 bg-orange-500/10' :
                            'border-amber-500/50 text-amber-600 bg-amber-500/10'
                          )}
                        >
                          {item.days}d
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">{fmt(item.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Clock className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhum item vencido. Tudo em dia!</p>
        </div>
      )}
    </div>
  );
}

// ─── Categories Tab ───────────────────────────────────────────────────────────

function CategoriesTab() {
  const { data: payables = [] } = useAccountsPayable();
  const { data: receivables = [] } = useAccountsReceivable();
  const [months, setMonths] = useState('3');

  const cutoff = useMemo(() => subMonths(new Date(), Number(months)), [months]);

  const expenseByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    payables.forEach(p => {
      if (p.status === 'cancelled') return;
      if (p.due_date && parseISO(p.due_date) < cutoff) return;
      const cat = p.category || 'outro';
      map[cat] = (map[cat] || 0) + (p.amount || 0);
    });
    return Object.entries(map)
      .map(([key, value]) => ({ name: CATEGORY_LABELS[key] || key, value, key }))
      .sort((a, b) => b.value - a.value);
  }, [payables, cutoff]);

  const monthlyTrend = useMemo(() => {
    const periods: Record<string, { period: string; receita: number; despesa: number }> = {};
    for (let i = Number(months) - 1; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      const key = format(d, 'yyyy-MM');
      periods[key] = { period: format(d, 'MMM/yy', { locale: ptBR }), receita: 0, despesa: 0 };
    }
    receivables.forEach(r => {
      if (r.status === 'cancelled' || !r.due_date) return;
      const key = r.due_date.slice(0, 7);
      if (periods[key]) periods[key].receita += (r.amount || 0);
    });
    payables.forEach(p => {
      if (p.status === 'cancelled' || !p.due_date) return;
      const key = p.due_date.slice(0, 7);
      if (periods[key]) periods[key].despesa += (p.amount || 0);
    });
    return Object.values(periods);
  }, [payables, receivables, months]);

  const totalExpense = expenseByCategory.reduce((s, c) => s + c.value, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={months} onValueChange={setMonths}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Último mês</SelectItem>
            <SelectItem value="3">Últimos 3 meses</SelectItem>
            <SelectItem value="6">Últimos 6 meses</SelectItem>
            <SelectItem value="12">Últimos 12 meses</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Expense by category — bar chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Despesas por Categoria</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={expenseByCategory} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" fontSize={10} tickFormatter={fmtShort} />
                <YAxis type="category" dataKey="name" fontSize={10} width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Valor" radius={[0, 4, 4, 0]}>
                  {expenseByCategory.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Pie distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Distribuição de Despesas</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={expenseByCategory}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                  fontSize={10}
                >
                  {expenseByCategory.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Receita vs Despesa por mês */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Receita vs Despesa por Mês</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="period" fontSize={10} />
              <YAxis fontSize={10} tickFormatter={fmtShort} />
              <Tooltip content={<CustomTooltip />} />
              <Legend fontSize={10} />
              <Bar dataKey="receita" name="Receita" fill="#10B981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="despesa" name="Despesa" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Category breakdown table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Detalhamento por Categoria</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">% do Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenseByCategory.map((cat, i) => (
                <TableRow key={cat.key}>
                  <TableCell className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="font-medium">{cat.name}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold">{fmt(cat.value)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {totalExpense > 0 ? ((cat.value / totalExpense) * 100).toFixed(1) : '0'}%
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

// ─── Ranking Tab ──────────────────────────────────────────────────────────────

function RankingTab() {
  const { data: receivables = [] } = useAccountsReceivable();
  const { data: payables = [] } = useAccountsPayable();

  const clientRanking = useMemo(() => {
    const map: Record<string, { name: string; total: number; received: number; count: number }> = {};
    receivables.forEach(r => {
      if (r.status === 'cancelled') return;
      const key = r.client_name || 'Sem nome';
      if (!map[key]) map[key] = { name: key, total: 0, received: 0, count: 0 };
      map[key].total += (r.amount || 0);
      map[key].received += (r.amount_received || 0);
      map[key].count++;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 15);
  }, [receivables]);

  const supplierRanking = useMemo(() => {
    const map: Record<string, { name: string; total: number; paid: number; count: number }> = {};
    payables.forEach(p => {
      if (p.status === 'cancelled') return;
      const key = p.suppliers?.name || 'Sem fornecedor';
      if (!map[key]) map[key] = { name: key, total: 0, paid: 0, count: 0 };
      map[key].total += (p.amount || 0);
      map[key].paid += (p.amount_paid || 0);
      map[key].count++;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 15);
  }, [payables]);

  const topClientsChart = clientRanking.slice(0, 8).map(c => ({ name: c.name.split(' ')[0], value: c.total }));
  const topSuppliersChart = supplierRanking.slice(0, 8).map(s => ({ name: s.name.split(' ')[0], value: s.total }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Clients chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Top Clientes por Faturamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topClientsChart} layout="vertical" margin={{ left: 4, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" fontSize={10} tickFormatter={fmtShort} />
                <YAxis type="category" dataKey="name" fontSize={10} width={70} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Total" fill="#10B981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Suppliers chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Top Fornecedores por Gasto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topSuppliersChart} layout="vertical" margin={{ left: 4, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" fontSize={10} tickFormatter={fmtShort} />
                <YAxis type="category" dataKey="name" fontSize={10} width={70} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Total" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Client table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Ranking de Clientes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientRanking.map((c, i) => (
                  <TableRow key={c.name}>
                    <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                    <TableCell className="font-medium text-sm">{c.name}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtShort(c.total)}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn('text-xs font-mono', c.received >= c.total ? 'text-green-600' : 'text-muted-foreground')}>
                        {fmtShort(c.received)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Supplier table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Ranking de Fornecedores</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Pago</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplierRanking.map((s, i) => (
                  <TableRow key={s.name}>
                    <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                    <TableCell className="font-medium text-sm">{s.name}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtShort(s.total)}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn('text-xs font-mono', s.paid >= s.total ? 'text-green-600' : 'text-muted-foreground')}>
                        {fmtShort(s.paid)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Main FinanceReportsTab ───────────────────────────────────────────────────

export function FinanceReportsTab() {
  const [reportTab, setReportTab] = useState('dre');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Relatórios e Análises
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          DRE, projeção de fluxo de caixa, análise de inadimplência, categorias e ranking
        </p>
      </div>

      <Tabs value={reportTab} onValueChange={setReportTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="dre" className="gap-1 text-xs">
            <TrendingUp className="h-3.5 w-3.5" /> DRE
          </TabsTrigger>
          <TabsTrigger value="cashflow" className="gap-1 text-xs">
            <ArrowUpDown className="h-3.5 w-3.5" /> Fluxo de Caixa
          </TabsTrigger>
          <TabsTrigger value="aging" className="gap-1 text-xs">
            <Clock className="h-3.5 w-3.5" /> Inadimplência
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-1 text-xs">
            <DollarSign className="h-3.5 w-3.5" /> Categorias
          </TabsTrigger>
          <TabsTrigger value="ranking" className="gap-1 text-xs">
            <Users className="h-3.5 w-3.5" /> Ranking
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dre"><DREAuto /></TabsContent>
        <TabsContent value="cashflow"><CashFlowProjection /></TabsContent>
        <TabsContent value="aging"><AgingTab /></TabsContent>
        <TabsContent value="categories"><CategoriesTab /></TabsContent>
        <TabsContent value="ranking"><RankingTab /></TabsContent>
      </Tabs>
    </div>
  );
}

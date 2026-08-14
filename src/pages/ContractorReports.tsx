import { useEffect, useMemo, useState } from 'react';
import {
  Buildings, CheckCircle, Warning as AlertTriangle,
  Clock, CurrencyDollar as DollarSign, Printer, Calendar, Funnel, X,
  Camera, CaretLeft, CaretRight,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { cn, formatCurrency } from '@/lib/utils';
import {
  useContractorMetrics, useContractorHistory, useContractorOsFinancials,
  type ContractorMetric, type ContractorHistoryOrder,
  type OsFinancialRow, type OsDateField, type OsPaymentState,
} from '@/hooks/useContractorReports';
import { useContractors } from '@/hooks/useContractors';
import { printServiceOrderReceipt } from '@/lib/printServiceOrderReceipt';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function lastNDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function firstOfMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function calcPunctualityRate(m: ContractorMetric): number | null {
  const finishedWithDeadline = m.on_time_count + m.late_count;
  if (finishedWithDeadline === 0) return null;
  return Math.round((m.on_time_count / finishedWithDeadline) * 100);
}

/** Rótulo + estilo de cada estado de pagamento (cores semânticas — CLAUDE.md). */
const PAYMENT_STATE_META: Record<OsPaymentState, { label: string; className: string; hint: string }> = {
  paid: {
    label: 'Paga',
    className: 'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400',
    hint: 'Conta a pagar quitada',
  },
  partially_paid: {
    label: 'Parcial',
    className: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
    hint: 'Parte das contas quitada — OS dividida paga por retorno, uma conta por devolução',
  },
  unpaid: {
    label: 'A pagar',
    className: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
    hint: 'Conta a pagar em aberto',
  },
  not_billed: {
    label: 'Não faturada',
    className: 'bg-muted text-muted-foreground border-border',
    hint: 'OS ainda aberta — a conta a pagar nasce na finalização',
  },
  missing_ap: {
    label: 'Sem conta a pagar',
    className: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400',
    hint: 'OS finalizada sem conta a pagar — verificar o lançamento no financeiro',
  },
};

const DATE_FIELD_LABEL: Record<OsDateField, string> = {
  due: 'Vencimento',
  service: 'Data do serviço',
  payment: 'Data do pagamento',
};

const PUNCTUALITY_STYLE: Record<string, string> = {
  on_time: 'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400',
  late: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400',
  no_deadline: 'bg-muted text-muted-foreground border-border',
};

const REPORT_ROWS_PER_PAGE = 25;

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / REPORT_ROWS_PER_PAGE));
}

function rowsForPage<T>(rows: T[], page: number): T[] {
  const safePage = Math.min(Math.max(0, page), pageCount(rows.length) - 1);
  const start = safePage * REPORT_ROWS_PER_PAGE;
  return rows.slice(start, start + REPORT_ROWS_PER_PAGE);
}

interface ReportPagerProps {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
  label: string;
}

function ReportPager({ page, total, onPageChange, label }: ReportPagerProps) {
  const totalPages = pageCount(total);
  if (totalPages <= 1) return null;

  const safePage = Math.min(page, totalPages - 1);
  const first = safePage * REPORT_ROWS_PER_PAGE + 1;
  const last = Math.min(total, first + REPORT_ROWS_PER_PAGE - 1);

  return (
    <nav
      aria-label={`Paginar ${label}`}
      className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-center text-xs text-muted-foreground sm:text-left" aria-live="polite">
        {first.toLocaleString('pt-BR')}–{last.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 gap-1.5 md:h-8"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage === 0}
        >
          <CaretLeft className="h-4 w-4" /> Anterior
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 gap-1.5 md:h-8"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages - 1}
        >
          Próxima <CaretRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}

function PunctualityBadge({ punctuality, daysLate }: { punctuality: ContractorHistoryOrder['punctuality']; daysLate: number }) {
  if (punctuality === 'no_deadline') {
    return <Badge variant="outline" className={cn(PUNCTUALITY_STYLE.no_deadline, 'text-xs')}>Sem prazo</Badge>;
  }
  if (punctuality === 'on_time') {
    return <Badge variant="outline" className={cn(PUNCTUALITY_STYLE.on_time, 'text-xs')}>No prazo</Badge>;
  }
  return <Badge variant="outline" className={cn(PUNCTUALITY_STYLE.late, 'text-xs')}>+{daysLate}d</Badge>;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ContractorReportsPage({ embedded }: { embedded?: boolean } = {}) {
  const { data: metrics = [], isLoading: loadingMetrics } = useContractorMetrics();
  const { data: contractors = [] } = useContractors();

  // Filtros
  const [contractorFilter, setContractorFilter] = useState<string>('all');
  const [periodPreset, setPeriodPreset] = useState<string>('30d');
  const [customStart, setCustomStart] = useState<string>(lastNDaysISO(30));
  const [customEnd, setCustomEnd] = useState<string>(new Date().toISOString().slice(0, 10));
  const [financialPage, setFinancialPage] = useState(0);
  const [rankingPage, setRankingPage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);

  const period = useMemo(() => {
    switch (periodPreset) {
      case '7d':    return { start: lastNDaysISO(7),    end: new Date().toISOString().slice(0, 10), label: 'Últimos 7 dias' };
      case '30d':   return { start: lastNDaysISO(30),   end: new Date().toISOString().slice(0, 10), label: 'Últimos 30 dias' };
      case '90d':   return { start: lastNDaysISO(90),   end: new Date().toISOString().slice(0, 10), label: 'Últimos 90 dias' };
      case 'month': return { start: firstOfMonthISO(),  end: new Date().toISOString().slice(0, 10), label: 'Mês atual' };
      case 'all':   return { start: null,               end: null,                                  label: 'Todo o período' };
      case 'custom':return { start: customStart,        end: customEnd,                             label: `${formatDateBR(customStart)} – ${formatDateBR(customEnd)}` };
      default:      return { start: lastNDaysISO(30),   end: new Date().toISOString().slice(0, 10), label: 'Últimos 30 dias' };
    }
  }, [periodPreset, customStart, customEnd]);

  const { data: history = [], isLoading: loadingHistory } = useContractorHistory({
    contractor_id: contractorFilter !== 'all' ? contractorFilter : null,
    period_start:  period.start,
    period_end:    period.end,
  });

  // Filtra métricas pelo contractor selecionado (pra cards)
  const filteredMetrics = useMemo(() => {
    if (contractorFilter === 'all') return metrics;
    return metrics.filter((m) => m.contractor_id === contractorFilter);
  }, [metrics, contractorFilter]);

  // KPIs gerais
  const summary = useMemo(() => {
    const totalOrders = filteredMetrics.reduce((s, m) => s + m.completed_orders, 0);
    // total_value_paid = dinheiro efetivamente pago (accounts_payable quitadas).
    const totalValue  = filteredMetrics.reduce((s, m) => s + Number(m.total_value_paid || 0), 0);
    const totalCompleted = filteredMetrics.reduce((s, m) => s + Number(m.total_value_completed || 0), 0);
    const totalOnTime = filteredMetrics.reduce((s, m) => s + m.on_time_count, 0);
    const totalLate   = filteredMetrics.reduce((s, m) => s + m.late_count, 0);
    const punctualityRate = (totalOnTime + totalLate) > 0
      ? Math.round((totalOnTime / (totalOnTime + totalLate)) * 100)
      : null;
    const openOverdue = filteredMetrics.reduce((s, m) => s + m.open_overdue_count, 0);
    return { totalOrders, totalValue, totalCompleted, totalOnTime, totalLate, punctualityRate, openOverdue };
  }, [filteredMetrics]);

  // ── Pagamentos: filtros próprios (eixo de data + estado) ───────────────────
  const [dateField, setDateField] = useState<OsDateField>('service');
  const [paymentState, setPaymentState] = useState<'all' | OsPaymentState | 'overdue'>('all');

  useEffect(() => {
    setFinancialPage(0);
    setHistoryPage(0);
  }, [contractorFilter, periodPreset, customStart, customEnd]);

  useEffect(() => {
    setFinancialPage(0);
  }, [dateField, paymentState]);

  useEffect(() => {
    setRankingPage(0);
  }, [contractorFilter]);

  const { data: financials = [], isLoading: loadingFinancials } = useContractorOsFinancials({
    contractor_id: contractorFilter !== 'all' ? contractorFilter : null,
    date_field:    dateField,
    period_start:  period.start,
    period_end:    period.end,
    payment_state: paymentState,
  });

  const finSummary = useMemo(() => {
    let paid = 0, unpaid = 0, overdue = 0, notBilled = 0, anomalies = 0, totalDue = 0;
    for (const r of financials) {
      const due = Number(r.amount_due || 0);
      const alreadyPaid = Number(r.amount_paid_effective || 0);
      totalDue += due;
      if (r.payment_state === 'paid') {
        paid += alreadyPaid;
      } else if (r.payment_state === 'partially_paid') {
        // OS dividida: parte já quitada, o resto continua sendo passivo.
        paid += alreadyPaid;
        const rest = Math.max(0, due - alreadyPaid);
        unpaid += rest;
        if (r.is_overdue) overdue += rest;
      } else if (r.payment_state === 'unpaid') {
        unpaid += due;
        if (r.is_overdue) overdue += due;
      } else if (r.payment_state === 'not_billed') {
        notBilled += due;
      } else {
        anomalies += 1; // missing_ap
      }
    }
    return { paid, unpaid, overdue, notBilled, anomalies, totalDue, count: financials.length };
  }, [financials]);

  // History do período (linha por OS) — usado pra tabela de histórico
  const periodHistory = useMemo(() => history, [history]);
  const periodTotalValue = useMemo(
    () => periodHistory.reduce((s, h) => s + Number(h.total_value || 0), 0),
    [periodHistory],
  );
  const visibleFinancials = useMemo(
    () => rowsForPage(financials, financialPage),
    [financials, financialPage],
  );
  const visibleMetrics = useMemo(
    () => rowsForPage(filteredMetrics, rankingPage),
    [filteredMetrics, rankingPage],
  );
  const visibleHistory = useMemo(
    () => rowsForPage(periodHistory, historyPage),
    [periodHistory, historyPage],
  );

  const handlePrintReceipt = (o: ContractorHistoryOrder) => {
    const contractor = contractors.find((c) => c.id === o.contractor_id);
    // Papel único (Modelo A): sem preço nem total — só quantidade. Ver
    // printServiceOrderReceipt.ts. Aqui não há itens do PV à mão, então o papel
    // sai pela descrição e o canhoto confere pelo total.
    printServiceOrderReceipt(
      {
        id: o.id,
        order_number: o.order_number,
        description: o.description,
        service_date: o.service_date,
        quoted_deadline: o.quoted_deadline,
        quantity: o.quantity,
        target_sector: o.sector,
        materials_sent: Array.isArray(o.materials_sent) ? o.materials_sent : [],
      },
      {
        name: contractor?.name || o.contractor_name,
        trade_name: contractor?.trade_name,
        cnpj_cpf: contractor?.cnpj_cpf,
        phone: contractor?.phone,
      },
    );
  };

  if (loadingMetrics) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        Calculando métricas...
      </div>
    );
  }

  return (
    <div className={cn('space-y-5', !embedded && 'page-enter')}>
      {!embedded && (
        <EditorialPageHeader
          sectionLabel="PRODUÇÃO · RELATÓRIOS · TERCEIROS"
          title="Relatório de Terceirizados"
          description="Métricas agregadas por prestador + histórico de OSs finalizadas no período. Filtre por contratada e janela de tempo."
        />
      )}

      {/* Filtros */}
      <Panel
        eyebrow="RECORTE DO RELATÓRIO"
        title={
          <span className="inline-flex items-center gap-2">
            <Funnel className="h-4 w-4 text-primary" aria-hidden="true" /> Filtros
          </span>
        }
        subtitle="Escolha a contratada e a janela de tempo que orientam o histórico e os pagamentos."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.25fr)_minmax(180px,0.8fr)_auto] xl:items-end">
          <div className="space-y-1.5">
            <Label id="contractor-report-contractor-label" className="text-xs text-muted-foreground">Contratada</Label>
            <Select value={contractorFilter} onValueChange={setContractorFilter}>
              <SelectTrigger aria-labelledby="contractor-report-contractor-label" className="h-11 w-full text-sm md:h-9">
                <SelectValue placeholder="Todas as contratadas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as contratadas</SelectItem>
                {contractors.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.trade_name || c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label id="contractor-report-period-label" className="text-xs text-muted-foreground">Período</Label>
            <Select value={periodPreset} onValueChange={setPeriodPreset}>
              <SelectTrigger aria-labelledby="contractor-report-period-label" className="h-11 w-full text-sm md:h-9">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="90d">Últimos 90 dias</SelectItem>
                <SelectItem value="month">Mês atual</SelectItem>
                <SelectItem value="all">Todo o período</SelectItem>
                <SelectItem value="custom">Personalizado…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(contractorFilter !== 'all' || periodPreset !== '30d') && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 w-full gap-1 text-xs text-muted-foreground md:h-9 xl:w-auto"
              onClick={() => { setContractorFilter('all'); setPeriodPreset('30d'); }}
            >
              <X className="h-3.5 w-3.5" />
              Limpar filtros
            </Button>
          )}
        </div>
        {periodPreset === 'custom' && (
          <fieldset className="mt-3 grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs font-semibold text-muted-foreground">Intervalo personalizado</legend>
            <div className="space-y-1.5">
              <Label htmlFor="contractor-report-start" className="text-xs text-muted-foreground">Data inicial</Label>
              <Input
                id="contractor-report-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-11 w-full text-sm md:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contractor-report-end" className="text-xs text-muted-foreground">Data final</Label>
              <Input
                id="contractor-report-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-11 w-full text-sm md:h-9"
              />
            </div>
          </fieldset>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Os indicadores gerais refletem a contratada selecionada; histórico e pagamentos também respeitam o período.
        </p>
      </Panel>

      {/* KPIs */}
      <StatGrid>
        <StatCard
          label="OSs finalizadas"
          value={summary.totalOrders}
          icon={CheckCircle}
          hint="all-time agregado"
        />
        <StatCard
          label="Valor pago (all-time)"
          value={formatCurrency(summary.totalValue)}
          icon={DollarSign}
          hint={`conta quitada · ${formatCurrency(summary.totalCompleted)} concluído`}
        />
        <StatCard
          label="Taxa de pontualidade"
          value={summary.punctualityRate === null ? '—' : `${summary.punctualityRate}%`}
          icon={Clock}
          tone={
            summary.punctualityRate === null ? 'default'
            : summary.punctualityRate >= 90 ? 'success'
            : summary.punctualityRate >= 70 ? 'warning'
            : 'destructive'
          }
          hint={`${summary.totalOnTime} no prazo · ${summary.totalLate} atrasadas`}
        />
        <StatCard
          label="OSs abertas vencidas"
          value={summary.openOverdue}
          icon={AlertTriangle}
          tone={summary.openOverdue > 0 ? 'destructive' : 'default'}
          hint="prazo passou + não recebida"
        />
      </StatGrid>

      {/* Pagamentos — pagas × não pagas por prestador e período */}
      <Panel
        eyebrow={`${DATE_FIELD_LABEL[dateField]} · ${period.label}`}
        title="Pagamentos aos prestadores"
        subtitle="Estado real vindo das contas a pagar — não do status da OS."
      >
        <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/20 p-3">
          <div className="space-y-1.5">
            <Label id="contractor-report-date-field-label" className="text-xs text-muted-foreground">Organizar período por</Label>
            <Select value={dateField} onValueChange={(v) => setDateField(v as OsDateField)}>
              <SelectTrigger aria-labelledby="contractor-report-date-field-label" className="h-11 w-full text-sm md:h-9 md:max-w-xs">
                <SelectValue placeholder="Filtrar data por" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="service">Data do serviço</SelectItem>
                <SelectItem value="due">Vencimento</SelectItem>
                <SelectItem value="payment">Data do pagamento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div role="group" aria-label="Estado do pagamento" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {([
                ['all', 'Todas'], ['paid', 'Pagas'], ['unpaid', 'A pagar'],
                ['partially_paid', 'Parciais'], ['overdue', 'Vencidas'],
                ['not_billed', 'Não faturadas'],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  variant={paymentState === value ? 'default' : 'outline'}
                  size="sm"
                  className="h-11 w-full text-xs md:h-9 sm:w-auto"
                  aria-pressed={paymentState === value}
                  onClick={() => setPaymentState(value as typeof paymentState)}
                >
                  {label}
                </Button>
              ))}
          </div>
        </div>
        <StatGrid>
          <StatCard label="Pago no período" value={formatCurrency(finSummary.paid)} icon={CheckCircle} tone="success" hint="contas quitadas" />
          <StatCard label="A pagar" value={formatCurrency(finSummary.unpaid)} icon={DollarSign} tone={finSummary.unpaid > 0 ? 'warning' : 'default'} hint="conta emitida, ainda não quitada" />
          <StatCard label="Vencido" value={formatCurrency(finSummary.overdue)} icon={AlertTriangle} tone={finSummary.overdue > 0 ? 'destructive' : 'default'} hint="a pagar com vencimento passado" />
          <StatCard label="Ainda não faturado" value={formatCurrency(finSummary.notBilled)} icon={Clock} hint="OS aberta — conta nasce na finalização" />
        </StatGrid>

        {dateField === 'payment' && paymentState !== 'paid' && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            Filtrando por <strong>data do pagamento</strong>: OS ainda não pagas não têm essa data e ficam de fora.
            Para ver o que está em aberto, filtre por <strong>vencimento</strong> ou <strong>data do serviço</strong>.
          </p>
        )}
        {finSummary.anomalies > 0 && (
          <p className="mt-3 text-xs text-red-700 dark:text-red-400">
            {finSummary.anomalies} OS finalizada(s) sem conta a pagar válida — o valor não entra em nenhum total acima. Verifique o lançamento no financeiro.
          </p>
        )}
      </Panel>

      <Panel
        eyebrow={`${financials.length} OS`}
        title="Detalhamento de pagamentos"
        subtitle={`Período por ${DATE_FIELD_LABEL[dateField].toLowerCase()}.`}
        flush
      >
        {loadingFinancials ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Carregando pagamentos...</div>
        ) : financials.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            title="Nenhuma OS no período"
            description="Ajuste o prestador, o período ou o eixo de data para ver os pagamentos."
          />
        ) : (
          <>
          <div className="divide-y divide-border md:hidden">
            {visibleFinancials.map((r: OsFinancialRow) => {
              const meta = PAYMENT_STATE_META[r.payment_state];
              return (
                <article
                  key={r.os_id}
                  aria-label={`OS ${r.order_number || 'sem número'} de ${r.contractor_name}`}
                  className="space-y-3 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold">{r.order_number || '—'}</p>
                      <p className="truncate text-sm font-medium">{r.contractor_name}</p>
                      <p className="mt-0.5 text-xs capitalize text-muted-foreground">{r.sector || 'Setor não informado'}{r.is_avulsa ? ' · OS avulsa' : ''}</p>
                    </div>
                    <Badge variant="outline" className={cn('shrink-0 text-xs', meta.className)} title={meta.hint}>
                      {meta.label}
                    </Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-muted/30 p-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Valor</dt>
                      <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums">{formatCurrency(Number(r.amount_due || 0))}</dd>
                    </div>
                    <div className="text-right">
                      <dt className="text-muted-foreground">Quantidade</dt>
                      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{Number(r.quantity).toLocaleString('pt-BR')}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Serviço</dt>
                      <dd className="mt-0.5 tabular-nums">{formatDateBR(r.service_date)}</dd>
                    </div>
                    <div className="text-right">
                      <dt className="text-muted-foreground">Vencimento</dt>
                      <dd className={cn('mt-0.5 tabular-nums', r.is_overdue && 'font-semibold text-red-700 dark:text-red-400')}>
                        {formatDateBR(r.due_date)}{r.is_overdue ? ` · +${r.days_overdue}d` : ''}
                      </dd>
                    </div>
                    {r.payment_date && (
                      <div className="col-span-2 border-t border-border pt-2">
                        <dt className="text-muted-foreground">Pago em</dt>
                        <dd className="mt-0.5 tabular-nums">{formatDateBR(r.payment_date)}</dd>
                      </div>
                    )}
                  </dl>
                </article>
              );
            })}
            <div className="grid grid-cols-2 gap-3 bg-muted/40 p-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Total do período</p>
                <p className="font-mono font-bold tabular-nums">{formatCurrency(finSummary.totalDue)}</p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>{formatCurrency(finSummary.paid)} pago</p>
                <p>{formatCurrency(finSummary.unpaid)} a pagar</p>
              </div>
            </div>
          </div>
          <div className="hidden md:block">
          <Table aria-label="Detalhamento de pagamentos por ordem de serviço">
            <TableHeader>
              <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead>OS</TableHead>
                <TableHead>Prestador</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Pago em</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleFinancials.map((r: OsFinancialRow) => {
                const meta = PAYMENT_STATE_META[r.payment_state];
                return (
                  <TableRow key={r.os_id} className="hover:bg-muted/30">
                    <TableCell className="text-sm font-mono">
                      {r.order_number || '—'}
                      {r.is_avulsa && <span className="ml-1 text-[10px] text-muted-foreground">avulsa</span>}
                    </TableCell>
                    <TableCell className="text-sm">{r.contractor_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground capitalize">{r.sector}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{r.quantity}</TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {formatCurrency(Number(r.amount_due || 0))}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateBR(r.service_date)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateBR(r.due_date)}
                      {r.is_overdue && (
                        <span className="ml-1 text-red-600 dark:text-red-400 font-semibold">
                          +{r.days_overdue}d
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateBR(r.payment_date)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('text-[10px]', meta.className)} title={meta.hint}>
                        {meta.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={4} className="text-xs uppercase tracking-wider text-muted-foreground">
                  Total do período
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {formatCurrency(finSummary.totalDue)}
                </TableCell>
                <TableCell colSpan={4} className="text-xs text-muted-foreground">
                  {formatCurrency(finSummary.paid)} pago · {formatCurrency(finSummary.unpaid)} a pagar
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          </div>
          <ReportPager page={financialPage} total={financials.length} onPageChange={setFinancialPage} label="detalhamento de pagamentos" />
          </>
        )}
      </Panel>

      {/* Ranking por contractor */}
      {filteredMetrics.length > 0 && (
        <Panel
          eyebrow="All-time"
          title="Ranking de contratadas"
          subtitle="Ordenado por valor total. Concluído = produzido · Pago = conta quitada · A pagar = conta em aberto."
          flush
        >
          <div className="divide-y divide-border md:hidden">
            {visibleMetrics.map((m) => {
              const rate = calcPunctualityRate(m);
              return (
                <article
                  key={m.contractor_id}
                  aria-label={`Indicadores de ${m.contractor_name}`}
                  className="space-y-3 p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Buildings className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold">{m.contractor_name}</h4>
                        {!m.active && <Badge variant="outline" className="bg-muted text-xs">Inativa</Badge>}
                      </div>
                      {m.service_type && <p className="text-xs text-muted-foreground">{m.service_type}</p>}
                    </div>
                    {rate !== null && (
                      <Badge
                        variant="outline"
                        className={cn(
                          'shrink-0 text-xs',
                          rate >= 90 ? PUNCTUALITY_STYLE.on_time
                          : rate >= 70 ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                          : PUNCTUALITY_STYLE.late,
                        )}
                      >
                        {rate}% no prazo
                      </Badge>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md bg-muted/30 p-2.5">
                      <dt className="text-muted-foreground">Produzido</dt>
                      <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums">{formatCurrency(m.total_value_completed)}</dd>
                    </div>
                    <div className="rounded-md bg-muted/30 p-2.5 text-right">
                      <dt className="text-muted-foreground">Pago</dt>
                      <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-green-700 dark:text-green-400">{formatCurrency(m.total_value_paid)}</dd>
                    </div>
                    <div className="rounded-md bg-muted/30 p-2.5">
                      <dt className="text-muted-foreground">A pagar</dt>
                      <dd className={cn('mt-0.5 font-mono text-sm font-bold tabular-nums', Number(m.total_value_unpaid) > 0 && 'text-amber-700 dark:text-amber-400')}>{formatCurrency(m.total_value_unpaid)}</dd>
                    </div>
                    <div className="rounded-md bg-muted/30 p-2.5 text-right">
                      <dt className="text-muted-foreground">OSs / pares</dt>
                      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{m.completed_orders.toLocaleString('pt-BR')} / {Number(m.total_quantity).toLocaleString('pt-BR')}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{m.open_orders} em aberto{m.open_overdue_count > 0 ? ` · ${m.open_overdue_count} vencidas` : ''}</span>
                    <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" aria-hidden="true" /> Última OS {formatDateBR(m.last_order_at)}</span>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="hidden md:block">
          <Table aria-label="Ranking de desempenho das contratadas">
            <TableHeader>
              <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead>Contratada</TableHead>
                <TableHead className="text-right">OSs finalizadas</TableHead>
                <TableHead className="text-right">Pares totais</TableHead>
                <TableHead className="text-right">Concluído</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="text-right">A pagar</TableHead>
                <TableHead className="text-right">Em aberto</TableHead>
                <TableHead className="text-right">Pontualidade</TableHead>
                <TableHead className="text-right">Atraso médio</TableHead>
                <TableHead>Última OS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleMetrics.map((m) => {
                const rate = calcPunctualityRate(m);
                return (
                  <TableRow key={m.contractor_id} className="hover:bg-muted/30">
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-7 w-7 flex items-center justify-center bg-muted text-muted-foreground rounded-md shrink-0">
                          <Buildings className="h-3.5 w-3.5" />
                        </span>
                        <div>
                          <div className="font-semibold">{m.contractor_name}</div>
                          {m.service_type && (
                            <div className="text-xs text-muted-foreground">{m.service_type}</div>
                          )}
                        </div>
                        {!m.active && (
                          <Badge variant="outline" className="h-4 text-[10px] uppercase tracking-wide bg-muted">
                            Inativa
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {m.completed_orders.toLocaleString('pt-BR')}
                      {m.cancelled_orders > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-1">
                          (−{m.cancelled_orders} canc.)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      {Number(m.total_quantity).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground mono">
                      {formatCurrency(m.total_value_completed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-semibold mono text-green-700 dark:text-green-400">
                      {formatCurrency(m.total_value_paid)}
                    </TableCell>
                    <TableCell className={cn(
                      'text-right tabular-nums text-sm mono',
                      Number(m.total_value_unpaid) > 0 && 'text-amber-700 dark:text-amber-400 font-semibold',
                    )}>
                      {formatCurrency(m.total_value_unpaid)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {m.open_orders}
                      {m.open_overdue_count > 0 && (
                        <Badge variant="outline" className={cn('text-[10px] ml-1', PUNCTUALITY_STYLE.late)}>
                          {m.open_overdue_count} venc.
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {rate === null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs',
                            rate >= 90 ? PUNCTUALITY_STYLE.on_time
                            : rate >= 70 ? 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400'
                            : PUNCTUALITY_STYLE.late,
                          )}
                        >
                          {rate}%
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      {m.avg_late_days > 0 ? `${Number(m.avg_late_days).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}d` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <Calendar className="inline h-3 w-3 mr-1" />
                      {formatDateBR(m.last_order_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
          <ReportPager page={rankingPage} total={filteredMetrics.length} onPageChange={setRankingPage} label="ranking de contratadas" />
        </Panel>
      )}

      {filteredMetrics.length === 0 && (
        <EmptyState
          icon={Buildings}
          title="Nenhuma contratada com OSs registradas"
          description="Cadastre contratadas em /terceirizados e crie OSs pra ver as métricas aqui."
        />
      )}

      {/* Histórico do período (com filtro aplicado) */}
      <Panel
        eyebrow={`Histórico · ${period.label}`}
        title="OSs finalizadas no período"
        subtitle={
          contractorFilter !== 'all'
            ? `Filtrado por contratada${period.start ? ` · entre ${formatDateBR(period.start)} e ${formatDateBR(period.end)}` : ''}`
            : `${periodHistory.length} ${periodHistory.length === 1 ? 'OS' : 'OSs'} · ${formatCurrency(periodTotalValue)} no total`
        }
        flush
      >
        {loadingHistory ? (
          <div className="py-12 text-center text-muted-foreground text-sm">Carregando histórico...</div>
        ) : periodHistory.length === 0 ? (
          <EmptyState
            icon={CheckCircle}
            title="Sem OSs finalizadas no período"
            description="Ajuste o filtro de período ou aguarde a conclusão das OSs em aberto."
            size="sm"
          />
        ) : (
          <>
          <div className="divide-y divide-border md:hidden">
            {visibleHistory.map((o) => (
              <article
                key={o.id}
                aria-label={`OS ${o.order_number || o.receipt_number || 'sem número'} de ${o.contractor_name}`}
                className="space-y-3 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-mono text-sm font-bold">{o.receipt_number || o.order_number || '—'}</p>
                      {o.is_artisanal && (
                        <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-xs text-purple-700 dark:text-purple-300">
                          Artesanal
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm font-medium">{o.contractor_name}</p>
                  </div>
                  <PunctualityBadge punctuality={o.punctuality} daysLate={o.days_late} />
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground" title={o.description || undefined}>
                  {o.description || 'Sem descrição informada.'}
                </p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-muted/30 p-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Setor</dt>
                    <dd className="mt-0.5 font-medium">{o.sector || '—'}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-muted-foreground">Concluída</dt>
                    <dd className="mt-0.5 tabular-nums">{formatDateBR(o.finished_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Pares</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums">{Number(o.quantity).toLocaleString('pt-BR')}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-muted-foreground">Valor</dt>
                    <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums">{formatCurrency(Number(o.total_value || 0))}</dd>
                  </div>
                </dl>
                <div className={cn('grid gap-2', o.signed_photo_url ? 'grid-cols-2' : 'grid-cols-1')}>
                  {o.signed_photo_url ? (
                    <Button asChild variant="outline" size="sm" className="h-11 gap-1.5">
                      <a
                        href={o.signed_photo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Ver foto assinada da OS ${o.order_number || o.receipt_number || ''}`}
                      >
                        <Camera className="h-4 w-4" /> Foto assinada
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 gap-1.5"
                    onClick={() => handlePrintReceipt(o)}
                    aria-label={`Imprimir recibo da OS ${o.order_number || o.receipt_number || ''}`}
                  >
                    <Printer className="h-4 w-4" /> Imprimir
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <div className="hidden md:block">
            <Table aria-label="Histórico de ordens de serviço finalizadas">
              <TableHeader>
                <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead>Recibo / OS</TableHead>
                  <TableHead>Contratada</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead className="text-right">Pares</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Concluída</TableHead>
                  <TableHead>Pontualidade</TableHead>
                  <TableHead className="w-10"><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleHistory.map((o) => (
                  <TableRow key={o.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {o.receipt_number || o.order_number || '—'}
                      {o.is_artisanal && (
                        <Badge variant="outline" className="ml-1.5 h-4 text-[10px] uppercase tracking-wide bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300">
                          Artesanal
                        </Badge>
                      )}
                      {o.signed_photo_url && (
                        <a
                          href={o.signed_photo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center ml-1.5 text-emerald-700 dark:text-emerald-400"
                          title="Ver foto do recibo assinado"
                          aria-label={`Ver foto assinada da OS ${o.order_number || o.receipt_number || ''}`}
                        >
                          <Camera className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{o.contractor_name}</TableCell>
                    <TableCell className="text-xs max-w-[260px] truncate" title={o.description || ''}>
                      {o.description || '—'}
                    </TableCell>
                    <TableCell className="text-xs">{o.sector}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {Number(o.quantity).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs font-semibold mono">
                      {formatCurrency(Number(o.total_value || 0))}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateBR(o.finished_at)}
                    </TableCell>
                    <TableCell>
                      <PunctualityBadge punctuality={o.punctuality} daysLate={o.days_late} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handlePrintReceipt(o)}
                        title="Imprimir recibo"
                        aria-label={`Imprimir recibo da OS ${o.order_number || o.receipt_number || ''}`}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ReportPager page={historyPage} total={periodHistory.length} onPageChange={setHistoryPage} label="histórico de ordens de serviço" />
          </>
        )}
      </Panel>
    </div>
  );
}

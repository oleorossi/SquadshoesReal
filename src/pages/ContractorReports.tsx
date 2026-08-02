import { useMemo, useState } from 'react';
import {
  ChartBar as BarChart3, Buildings, CheckCircle, Warning as AlertTriangle,
  Clock, CurrencyDollar as DollarSign, Printer, Calendar, Funnel, X,
  Package as Boxes, ArrowSquareOut, Camera,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
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

// ─────────────────────────────────────────────────────────────────────────────

export default function ContractorReportsPage({ embedded }: { embedded?: boolean } = {}) {
  const { data: metrics = [], isLoading: loadingMetrics } = useContractorMetrics();
  const { data: contractors = [] } = useContractors();

  // Filtros
  const [contractorFilter, setContractorFilter] = useState<string>('all');
  const [periodPreset, setPeriodPreset] = useState<string>('30d');
  const [customStart, setCustomStart] = useState<string>(lastNDaysISO(30));
  const [customEnd, setCustomEnd] = useState<string>(new Date().toISOString().slice(0, 10));

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

  const { data: financials = [], isLoading: loadingFinancials } = useContractorOsFinancials({
    contractor_id: contractorFilter !== 'all' ? contractorFilter : null,
    date_field:    dateField,
    period_start:  period.start,
    period_end:    period.end,
    payment_state: paymentState,
  });

  const finSummary = useMemo(() => {
    let paid = 0, unpaid = 0, overdue = 0, notBilled = 0, anomalies = 0;
    for (const r of financials) {
      const due = Number(r.amount_due || 0);
      const alreadyPaid = Number(r.amount_paid_effective || 0);
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
    return { paid, unpaid, overdue, notBilled, anomalies, count: financials.length };
  }, [financials]);

  // History do período (linha por OS) — usado pra tabela de histórico
  const periodHistory = useMemo(() => history, [history]);
  const periodTotalValue = useMemo(
    () => periodHistory.reduce((s, h) => s + Number(h.total_value || 0), 0),
    [periodHistory],
  );

  const handlePrintReceipt = (o: ContractorHistoryOrder) => {
    const contractor = contractors.find((c: any) => c.id === o.contractor_id) as any;
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
        title="Filtros"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Funnel className="h-4 w-4 text-muted-foreground" />
            <Select value={contractorFilter} onValueChange={setContractorFilter}>
              <SelectTrigger className="h-9 w-[200px] text-xs">
                <SelectValue placeholder="Contratada" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as contratadas</SelectItem>
                {contractors.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.trade_name || c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={periodPreset} onValueChange={setPeriodPreset}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
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
            {periodPreset === 'custom' && (
              <>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-9 text-xs w-[140px]"
                />
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-9 text-xs w-[140px]"
                />
              </>
            )}
            {(contractorFilter !== 'all' || periodPreset !== '30d') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs gap-1 text-muted-foreground"
                onClick={() => { setContractorFilter('all'); setPeriodPreset('30d'); }}
              >
                <X className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </div>
        }
      >
        <p className="text-xs text-muted-foreground">
          Métricas all-time abaixo refletem o filtro de contratada. Histórico filtra <strong>período</strong> e <strong>contratada</strong>.
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
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={dateField} onValueChange={(v) => setDateField(v as OsDateField)}>
              <SelectTrigger className="h-8 w-[168px] text-xs">
                <SelectValue placeholder="Filtrar data por" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="service">Data do serviço</SelectItem>
                <SelectItem value="due">Vencimento</SelectItem>
                <SelectItem value="payment">Data do pagamento</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1 flex-wrap">
              {([
                ['all', 'Todas'], ['paid', 'Pagas'], ['unpaid', 'A pagar'],
                ['overdue', 'Vencidas'], ['not_billed', 'Não faturadas'],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  variant={paymentState === value ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setPaymentState(value as typeof paymentState)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        }
      >
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
          <Table>
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
              {financials.map((r: OsFinancialRow) => {
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
                  {formatCurrency(financials.reduce((s, r) => s + Number(r.amount_due || 0), 0))}
                </TableCell>
                <TableCell colSpan={4} className="text-xs text-muted-foreground">
                  {formatCurrency(finSummary.paid)} pago · {formatCurrency(finSummary.unpaid)} a pagar
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
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
          <Table>
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
              {filteredMetrics.map((m) => {
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
          <div className="overflow-x-auto">
            <Table>
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
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periodHistory.map((o) => (
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
                      {o.punctuality === 'no_deadline' ? (
                        <Badge variant="outline" className={cn(PUNCTUALITY_STYLE.no_deadline, 'text-xs')}>
                          Sem prazo
                        </Badge>
                      ) : o.punctuality === 'on_time' ? (
                        <Badge variant="outline" className={cn(PUNCTUALITY_STYLE.on_time, 'text-xs')}>
                          No prazo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={cn(PUNCTUALITY_STYLE.late, 'text-xs')}>
                          +{o.days_late}d
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handlePrintReceipt(o)}
                        title="Imprimir recibo"
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}

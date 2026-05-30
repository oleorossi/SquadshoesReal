import { Fragment, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  CircleNotch as Loader2, MagnifyingGlass as Search, DownloadSimple as Download,
  CaretDown, CaretRight, Warning as AlertTriangle, TrendUp, TrendDown,
  Wallet, PiggyBank, Check,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useMonthlyClosing, MonthlyClosingRow, ClosingStatus,
} from '@/hooks/useMonthlyClosing';
import { useAddBankHoursMovement, usePayBankHours } from '@/hooks/useRH';

// ── Helpers ─────────────────────────────────────────────────────────────
function fmtMin(min: number): string {
  const sign = min < 0 ? '-' : '';
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${m.toString().padStart(2, '0')}`;
}

function fmtBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}

function firstDayOfMonth(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function lastDayOfMonth(year: number, month0: number): string {
  return new Date(year, month0 + 1, 0).toISOString().slice(0, 10);
}

const STATUS_META: Record<ClosingStatus, { label: string; cls: string }> = {
  extra:    { label: 'Hora extra',    cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400' },
  devedor:  { label: 'Horas a menos', cls: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400' },
  misto:    { label: 'Misto',         cls: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400' },
  em_dia:   { label: 'Em dia',        cls: 'bg-muted text-muted-foreground border-border' },
  sem_ponto:{ label: 'Sem ponto',     cls: 'bg-muted/50 text-muted-foreground border-border/60' },
};

type StatusFilter = 'all' | ClosingStatus;

// ── Componente ──────────────────────────────────────────────────────────
export default function FechamentoMensal() {
  const [from, setFrom] = useState<string>(() => firstDayOfMonth());
  const [to, setTo] = useState<string>(() => todayISO());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [actionRow, setActionRow] = useState<MonthlyClosingRow | null>(null);

  const { rows, totals, isLoading } = useMonthlyClosing(from, to);

  const periodLabel = useMemo(() => {
    const f = new Date(from + 'T12:00:00').toLocaleDateString('pt-BR');
    const t = new Date(to + 'T12:00:00').toLocaleDateString('pt-BR');
    return `${f} — ${t}`;
  }, [from, to]);

  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter !== 'all') r = r.filter(x => x.status === statusFilter);
    const term = search.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (term) {
      r = r.filter(x =>
        x.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(term) ||
        x.department.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(term),
      );
    }
    return r;
  }, [rows, statusFilter, search]);

  const setQuickMonth = (offset: number) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    setFrom(firstDayOfMonth(d));
    setTo(offset === 0 ? todayISO() : lastDayOfMonth(d.getFullYear(), d.getMonth()));
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const header = [
      'Funcionário', 'Setor', 'Escala', 'Trabalhado (h)', 'Previsto (h)',
      'Hora extra (h)', 'Horas a menos (h)', 'Saldo (h)',
      'R$ HE a pagar', 'R$ desconto sugerido', 'Status',
    ];
    const lines = filtered.map(r => [
      r.name, r.department, r.scheduleName,
      (r.workedMin / 60).toFixed(2), (r.expectedMin / 60).toFixed(2),
      (r.overtimeMin / 60).toFixed(2), (r.deficitMin / 60).toFixed(2), (r.netMin / 60).toFixed(2),
      r.overtimeValue.toFixed(2), r.deficitValue.toFixed(2), STATUS_META[r.status].label,
    ]);
    const csv = [header, ...lines]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fechamento_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Controles */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Apuração do período</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">De</Label>
              <Input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="h-9 w-40" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Até</Label>
              <Input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="h-9 w-40" />
            </div>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="h-9" onClick={() => setQuickMonth(0)}>Mês atual</Button>
              <Button variant="outline" size="sm" className="h-9" onClick={() => setQuickMonth(-1)}>Mês passado</Button>
            </div>
            <div className="space-y-1.5 min-w-[180px]">
              <Label className="text-xs">Situação</Label>
              <Select value={statusFilter} onValueChange={(v: StatusFilter) => setStatusFilter(v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="extra">Hora extra</SelectItem>
                  <SelectItem value="devedor">Horas a menos</SelectItem>
                  <SelectItem value="misto">Misto</SelectItem>
                  <SelectItem value="em_dia">Em dia</SelectItem>
                  <SelectItem value="sem_ponto">Sem ponto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 min-w-[180px] flex-1">
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Nome ou setor..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-8" />
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Período: <strong>{periodLabel}</strong> · apuração com base no ponto importado e na escala de cada funcionário.
            O desconto por horas a menos é uma <strong>sugestão</strong> — o RH decide pagar, compensar no banco ou abonar.
          </p>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Hora extra a pagar"
          value={fmtBRL(totals.overtimeValue)}
          sub={`${fmtMin(totals.overtimeMin)} · ${totals.withOvertime} func.`}
          tone="positive"
          icon={<TrendUp className="h-4 w-4" />}
        />
        <KpiCard
          label="Desconto sugerido"
          value={fmtBRL(totals.deficitValue)}
          sub={`${fmtMin(totals.deficitMin)} · ${totals.withDeficit} func.`}
          tone="negative"
          icon={<TrendDown className="h-4 w-4" />}
        />
        <KpiCard
          label="Saldo líquido"
          value={fmtBRL(totals.netValue)}
          sub={totals.netValue >= 0 ? 'a pagar (extra − devedor)' : 'a favor da empresa'}
          tone={totals.netValue >= 0 ? 'positive' : 'negative'}
          icon={<Wallet className="h-4 w-4" />}
        />
        <KpiCard
          label="Em dia / Sem ponto"
          value={`${totals.balanced} / ${totals.withoutRecords}`}
          sub={`${totals.employees} funcionários ativos`}
          tone="neutral"
          icon={<Check className="h-4 w-4" />}
        />
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Nenhum funcionário neste filtro/período. Importe o ponto na aba <strong>Ponto</strong> ou ajuste o intervalo.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Funcionário</TableHead>
                    <TableHead className="text-right">Trabalhado</TableHead>
                    <TableHead className="text-right">Previsto</TableHead>
                    <TableHead className="text-right">Hora extra</TableHead>
                    <TableHead className="text-right">Horas a menos</TableHead>
                    <TableHead className="text-right">R$ a pagar</TableHead>
                    <TableHead className="text-right">R$ desconto</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => {
                    const open = expanded.has(r.employeeId);
                    return (
                      <Fragment key={r.employeeId}>
                        <TableRow className="cursor-pointer" onClick={() => toggleExpand(r.employeeId)}>
                          <TableCell className="py-2">
                            {open ? <CaretDown className="h-3.5 w-3.5 text-muted-foreground" /> : <CaretRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="font-medium text-sm leading-tight">{r.name}</div>
                            <div className="text-xs text-muted-foreground">{r.department} · {r.scheduleName}</div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmtMin(r.workedMin)}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmtMin(r.expectedMin)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {r.overtimeMin > 0 ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{fmtMin(r.overtimeMin)}</span> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {r.deficitMin > 0 ? <span className="text-red-600 dark:text-red-400 font-semibold">{fmtMin(r.deficitMin)}</span> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {r.overtimeValue > 0 ? <span className="text-emerald-600 dark:text-emerald-400">{fmtBRL(r.overtimeValue)}</span> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {r.deficitValue > 0 ? <span className="text-red-600 dark:text-red-400">{fmtBRL(r.deficitValue)}</span> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="py-2">
                            <Badge variant="outline" className={cn('text-xs', STATUS_META[r.status].cls)}>{STATUS_META[r.status].label}</Badge>
                          </TableCell>
                          <TableCell className="text-right py-2">
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs"
                              disabled={r.status === 'sem_ponto' || r.status === 'em_dia'}
                              onClick={(e) => { e.stopPropagation(); setActionRow(r); }}
                            >
                              Resolver
                            </Button>
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={9} className="py-3">
                              <EmployeeDetail row={r} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <ResolveDialog row={actionRow} from={from} to={to} onClose={() => setActionRow(null)} />
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────────────────
function KpiCard({ label, value, sub, tone, icon }: {
  label: string; value: string; sub: string;
  tone: 'positive' | 'negative' | 'neutral'; icon: React.ReactNode;
}) {
  const toneCls = tone === 'positive'
    ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'negative'
      ? 'text-red-600 dark:text-red-400'
      : 'text-foreground';
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className={cn('opacity-70', toneCls)}>{icon}</span>
        </div>
        <div className={cn('text-lg font-bold font-mono tabular-nums mt-1', toneCls)}>{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function EmployeeDetail({ row }: { row: MonthlyClosingRow }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>Dias com ponto: <strong className="text-foreground">{row.daysWithRecords}</strong></span>
        <span>Faltas/ausências: <strong className="text-foreground">{row.absences}</strong></span>
        <span>Batidas incompletas: <strong className="text-foreground">{row.incompleteDays}</strong></span>
        <span>Feriados trabalhados: <strong className="text-foreground">{row.holidaysWorked}</strong></span>
        <span>Valor hora: <strong className="text-foreground">{fmtBRL(row.normalHourRate)}</strong></span>
        <span>Multiplicador HE: <strong className="text-foreground">×{row.overtimeMultiplier.toFixed(2)}</strong></span>
        {row.bankMovementsMin !== 0 && (
          <span>Já lançado no banco: <strong className="text-foreground">{fmtMin(row.bankMovementsMin)}</strong></span>
        )}
      </div>
      {row.weeks.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border/60">
                <th className="text-left font-medium py-1">Semana</th>
                <th className="text-right font-medium py-1">Trabalhado</th>
                <th className="text-right font-medium py-1">Previsto</th>
                <th className="text-right font-medium py-1">Extra</th>
                <th className="text-right font-medium py-1">A menos</th>
              </tr>
            </thead>
            <tbody>
              {row.weeks.map(w => (
                <tr key={w.weekLabel} className="border-b border-border/30 last:border-0">
                  <td className="py-1 font-mono">
                    {new Date(w.startDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    {' – '}
                    {new Date(w.endDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  </td>
                  <td className="py-1 text-right font-mono">{fmtMin(w.workedMinutes)}</td>
                  <td className="py-1 text-right font-mono text-muted-foreground">{fmtMin(w.expectedMinutes)}</td>
                  <td className="py-1 text-right font-mono text-emerald-600 dark:text-emerald-400">{w.overtimeMinutes > 0 ? fmtMin(w.overtimeMinutes) : '—'}</td>
                  <td className="py-1 text-right font-mono text-red-600 dark:text-red-400">{w.deficitMinutes > 0 ? fmtMin(w.deficitMinutes) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type ResolveMode = 'bank' | 'pay';
type BankKind = 'credit' | 'debit' | 'compensation' | 'adjustment';

function ResolveDialog({ row, from, to, onClose }: {
  row: MonthlyClosingRow | null; from: string; to: string; onClose: () => void;
}) {
  const addMovement = useAddBankHoursMovement();
  const payHours = usePayBankHours();

  const [mode, setMode] = useState<ResolveMode>('bank');
  const [bankKind, setBankKind] = useState<BankKind>('credit');
  const [minutes, setMinutes] = useState<number>(0);
  const [reason, setReason] = useState('');
  const [payHoursVal, setPayHoursVal] = useState<number>(0);
  const [payRate, setPayRate] = useState<number>(0);

  // Reinicializa quando abre uma nova linha.
  const rowId = row?.employeeId;
  useEffect(() => {
    if (!row) return;
    const defaultKind: BankKind = row.deficitMin > row.overtimeMin ? 'debit' : 'credit';
    setMode('bank');
    setBankKind(defaultKind);
    setMinutes(defaultKind === 'debit' ? row.deficitMin : row.overtimeMin);
    setReason('');
    setPayHoursVal(Number((row.overtimeMin / 60).toFixed(2)));
    setPayRate(Number((row.otHourRate * row.overtimeMultiplier).toFixed(2)));
  }, [rowId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return null;

  const movementDate = to; // lança o saldo no fim do período apurado
  const signedMinutes = bankKind === 'debit'
    ? -Math.abs(minutes)
    : Math.abs(minutes);
  const payAmount = payHoursVal * payRate;

  const handleBank = async () => {
    try {
      await addMovement.mutateAsync({
        employee_id: row.employeeId,
        movement_date: movementDate,
        minutes: signedMinutes,
        movement_type: bankKind,
        reason: reason || `Fechamento ${from}–${to}`,
        overtime_pct: null,
      });
      onClose();
    } catch { /* toast tratado no hook */ }
  };

  const handlePay = async () => {
    try {
      await payHours.mutateAsync({
        employee_id: row.employeeId,
        hours: payHoursVal,
        hourly_rate: payRate,
        payment_date: movementDate,
        notes: reason || `HE fechamento ${from}–${to}`,
      });
      onClose();
    } catch { /* toast tratado no hook */ }
  };

  const busy = addMovement.isPending || payHours.isPending;

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Resolver — {row.name}</DialogTitle>
          <DialogDescription className="text-xs">
            HE apurada <strong className="text-emerald-600 dark:text-emerald-400">{fmtMin(row.overtimeMin)}</strong>
            {' · '}horas a menos <strong className="text-red-600 dark:text-red-400">{fmtMin(row.deficitMin)}</strong>
            {' · '}saldo {fmtMin(row.netMin)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button variant={mode === 'bank' ? 'default' : 'outline'} size="sm" className="flex-1 gap-1.5" onClick={() => setMode('bank')}>
            <PiggyBank className="h-4 w-4" /> Banco de horas
          </Button>
          <Button variant={mode === 'pay' ? 'default' : 'outline'} size="sm" className="flex-1 gap-1.5" onClick={() => setMode('pay')}>
            <Wallet className="h-4 w-4" /> Pagar HE
          </Button>
        </div>

        {mode === 'bank' ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo de lançamento</Label>
              <Select value={bankKind} onValueChange={(v: BankKind) => {
                setBankKind(v);
                setMinutes(v === 'debit' ? row.deficitMin : row.overtimeMin);
              }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Crédito — hora extra a favor do funcionário</SelectItem>
                  <SelectItem value="debit">Débito — horas a menos (devedoras)</SelectItem>
                  <SelectItem value="compensation">Compensação</SelectItem>
                  <SelectItem value="adjustment">Ajuste manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Minutos {bankKind === 'debit' && '(serão debitados)'}</Label>
              <Input
                type="number" min={0} className="h-9 font-mono"
                value={minutes}
                onChange={e => setMinutes(Math.max(0, Number(e.target.value || 0)))}
              />
              <p className="text-xs text-muted-foreground">= {fmtMin(signedMinutes)} ({(Math.abs(minutes) / 60).toFixed(2)} h)</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo (opcional)</Label>
              <Input className="h-9" placeholder="Ex.: acordo de compensação" value={reason} onChange={e => setReason(e.target.value)} />
            </div>
            <Button className="w-full" disabled={busy || minutes <= 0} onClick={handleBank}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Lançar no banco de horas'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Horas a pagar</Label>
                <Input type="number" min={0} step="0.01" className="h-9 font-mono" value={payHoursVal}
                  onChange={e => setPayHoursVal(Math.max(0, Number(e.target.value || 0)))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor da hora (R$)</Label>
                <Input type="number" min={0} step="0.01" className="h-9 font-mono" value={payRate}
                  onChange={e => setPayRate(Math.max(0, Number(e.target.value || 0)))} />
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">Total a pagar</span>
              <strong className="font-mono text-primary">{fmtBRL(payAmount)}</strong>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Observação (opcional)</Label>
              <Input className="h-9" placeholder="Ex.: HE autorizada pelo gestor" value={reason} onChange={e => setReason(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Cria uma despesa no financeiro e debita as horas do banco. O valor da hora já vem com o multiplicador (×{row.overtimeMultiplier.toFixed(2)}).
            </p>
            <Button className="w-full" disabled={busy || payHoursVal <= 0 || payRate <= 0} onClick={handlePay}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Pagar ${fmtBRL(payAmount)}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

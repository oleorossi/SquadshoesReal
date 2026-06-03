import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CircleNotch as Loader2, CurrencyDollar as DollarSign, Calculator, CheckCircle as CheckCircle2, Receipt, Warning as AlertTriangle, Wallet, Clock } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEmployees } from '@/hooks/useEmployees';
import { useHolidays, useTimesheetCoverage, useWorkSchedules } from '@/hooks/useTimesheet';
import { usePayrollRuns, useUpsertPayrollRun, useUpdatePayrollStatus } from '@/hooks/useRH';
import { calculateSalaryPayroll, type SalaryDayInput, worksOnDow, expectedDayMinutes } from '@/lib/salaryPayroll';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

const fmt = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** Minutos → "7h00". */
const fmtHoras = (min: number) => {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Último dia do mês "YYYY-MM" como "YYYY-MM-DD". */
function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return '';
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

/** Dias CORRIDOS no intervalo [from, to] inclusive → [{date, dow}]. Cobre quinzena/mês/range livre. */
function getDaysInRange(from: string, to: string): { date: string; dow: number }[] {
  if (!from || !to || from > to) return [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return [];
  const out: { date: string; dow: number }[] = [];
  for (const dt = new Date(fy, fm - 1, fd); dt <= new Date(ty, tm - 1, td); dt.setDate(dt.getDate() + 1)) {
    const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
    out.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, dow: dt.getDay() });
  }
  return out;
}

/** Nº de dias corridos no intervalo (base proporcional da quinzena). */
function daysBetween(from: string, to: string): number {
  return getDaysInRange(from, to).length;
}

/**
 * Chave/armazenamento do período em `payroll_runs.period` (UNIQUE employee_id+period):
 * mês cheio (01→último dia) vira "YYYY-MM" (compat com folhas mensais já gravadas);
 * qualquer outro intervalo vira "YYYY-MM-DD_YYYY-MM-DD".
 */
function rangeToPeriod(from: string, to: string): string {
  if (!from || !to) return '';
  const fm = from.slice(0, 7);
  if (from.slice(8) === '01' && fm === to.slice(0, 7) && to === lastDayOfMonth(fm)) return fm;
  return `${from}_${to}`;
}

/** Inverso de rangeToPeriod: "YYYY-MM" ou "YYYY-MM-DD_YYYY-MM-DD" → {from, to}. */
function periodToRange(period: string): { from: string; to: string } {
  if (/^\d{4}-\d{2}$/.test(period)) return { from: `${period}-01`, to: lastDayOfMonth(period) };
  const m = period.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (m) return { from: m[1], to: m[2] };
  return { from: '', to: '' };
}

/** Rótulo amigável: mês cheio → "mai/2026"; senão → "01/05–15/05/2026". */
function periodLabel(from: string, to: string): string {
  if (!from || !to) return '—';
  if (rangeToPeriod(from, to).length === 7) {
    const [y, m] = from.slice(0, 7).split('-').map(Number);
    return `${MONTHS_PT[m - 1]}/${y}`;
  }
  const dm = (d: string) => d.slice(8) + '/' + d.slice(5, 7);
  return `${dm(from)}–${dm(to)}/${to.slice(0, 4)}`;
}

const STATUS_BADGES = {
  rascunho: { label: 'Rascunho', variant: 'secondary' as const },
  aprovado: { label: 'Aprovado', variant: 'default' as const },
  pago: { label: 'Pago', variant: 'outline' as const },
};

export default function Payroll() {
  const today = new Date();
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  // Período pago por INTERVALO de datas (paga quinzenal). Default = mês corrente inteiro.
  const [range, setRange] = useState(() => ({ from: `${defaultPeriod}-01`, to: lastDayOfMonth(defaultPeriod) }));
  const [calcRunning, setCalcRunning] = useState(false);
  const [detailRun, setDetailRun] = useState<string | null>(null);
  const [approveRun, setApproveRun] = useState<string | null>(null);

  const periodRange = range;
  // Chave de armazenamento (compat mês: "YYYY-MM") + rótulo + nº de dias (base proporcional).
  const period = useMemo(() => rangeToPeriod(range.from, range.to), [range.from, range.to]);
  const periodTitle = useMemo(() => periodLabel(range.from, range.to), [range.from, range.to]);
  const periodDays = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to]);
  // Atalhos de quinzena ancorados no mês do "de".
  const applyPreset = (preset: '1q' | '2q' | 'mes') => {
    const ym = (range.from || `${defaultPeriod}-01`).slice(0, 7);
    if (preset === '1q') setRange({ from: `${ym}-01`, to: `${ym}-15` });
    else if (preset === '2q') setRange({ from: `${ym}-16`, to: lastDayOfMonth(ym) });
    else setRange({ from: `${ym}-01`, to: lastDayOfMonth(ym) });
  };

  const { data: employees = [] } = useEmployees();
  const { data: schedules = [] } = useWorkSchedules();
  const defaultSchedule = useMemo(() => (schedules as any[]).find(s => s.is_default) || (schedules as any[])[0] || null, [schedules]);
  const { data: runs = [], isLoading } = usePayrollRuns(period);
  const { data: holidaysList = [] } = useHolidays();
  const upsertRun = useUpsertPayrollRun();
  const updateStatus = useUpdatePayrollStatus();

  // Feriados OBRIGATÓRIOS (optional !== true) → dia inteiro 1,5×.
  const holidaysSet = useMemo(
    () => new Set((holidaysList as { holiday_date: string; optional?: boolean }[])
      .filter(h => h.optional !== true)
      .map(h => h.holiday_date)),
    [holidaysList],
  );

  // Cobertura: até onde o ponto foi importado neste mês (dias com batida).
  const { data: coverage } = useTimesheetCoverage(periodRange.from, periodRange.to);

  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const totals = useMemo(() => {
    const proventos = runs.reduce((s, r) => s + (r.total_proventos || 0), 0);
    const descontos = runs.reduce((s, r) => s + ((r.absence_discount || 0) + (r.deductions_amount || 0)), 0);
    const advances = runs.reduce((s, r) => s + (r.advances_total || 0), 0);
    const liquido = runs.reduce((s, r) => s + (r.total_liquido || 0), 0);
    const advancesCount = runs.filter(r => (r.advances_total || 0) > 0).length;
    return { proventos, descontos, advances, liquido, advancesCount };
  }, [runs]);

  async function calculateAll() {
    if (!periodRange.from || !periodRange.to) {
      toast.error('Selecione um mês válido para calcular a folha.');
      return;
    }
    setCalcRunning(true);
    try {
      const monthDays = getDaysInRange(range.from, range.to);
      // Clamp à cobertura: só conta dias já importados (≤ última data com batida).
      // Dias após isso NÃO entram — senão contaria 0h e subpagaria quem ainda não
      // teve o ponto baixado. A folha fica "parcial" até importar o resto.
      const maxCov = coverage?.maxCovered || null;
      const coveredDays = maxCov ? monthDays.filter(d => d.date <= maxCov) : monthDays;
      const clamped = !!(maxCov && periodRange.to && maxCov < periodRange.to);

      // Batidas do período. time_records não tem FK pra employees — casa por
      // matrícula (employee_external_id) ou nome.
      const { data: timeRecords, error } = await supabase
        .from('time_records')
        .select('employee_external_id, employee_name, record_date, punches')
        .gte('record_date', periodRange.from!)
        .lte('record_date', periodRange.to!);
      if (error) throw error;

      const byExternalId = new Map<string, Map<string, string[]>>();
      const byExtIdName = new Map<string, Map<string, string[]>>(); // chave `${extId}|${nome}`
      const byName = new Map<string, Map<string, string[]>>();
      const extIdNames = new Map<string, Set<string>>(); // extId → nomes distintos (detecta matrícula compartilhada)
      for (const r of (timeRecords || []) as any[]) {
        const punches: string[] = Array.isArray(r.punches) ? r.punches : [];
        const nameKey = (r.employee_name || '').toLowerCase().trim();
        if (r.employee_external_id) {
          const k = String(r.employee_external_id);
          if (!byExternalId.has(k)) byExternalId.set(k, new Map());
          byExternalId.get(k)!.set(r.record_date, punches);
          if (!extIdNames.has(k)) extIdNames.set(k, new Set());
          if (nameKey) extIdNames.get(k)!.add(nameKey);
          const kn = `${k}|${nameKey}`;
          if (!byExtIdName.has(kn)) byExtIdName.set(kn, new Map());
          byExtIdName.get(kn)!.set(r.record_date, punches);
        }
        if (nameKey) {
          if (!byName.has(nameKey)) byName.set(nameKey, new Map());
          byName.get(nameKey)!.set(r.record_date, punches);
        }
      }

      // Adiantamentos pendentes do período (único desconto). Vales já amarrados
      // a outra folha (payroll_run_id) não entram de novo.
      const { data: advances } = await supabase
        .from('employee_advances')
        .select('employee_id, amount, advance_date, status, payroll_run_id')
        .gte('advance_date', periodRange.from!)
        .lte('advance_date', periodRange.to!)
        .or('payroll_run_id.is.null,status.eq.pending');
      const advancesByEmp = new Map<string, number>();
      for (const a of (advances || []) as any[]) {
        advancesByEmp.set(a.employee_id, (advancesByEmp.get(a.employee_id) || 0) + Number(a.amount || 0));
      }

      let calculated = 0;
      let withIncomplete = 0;
      let sharedMatricula = 0;
      for (const emp of employees.filter(e => e.active)) {
        // Match das batidas por MATRÍCULA + NOME. Se a matrícula é compartilhada por
        // mais de um nome (ex.: ext_id 1 = "valdilene" + "Dona Val"), pega SÓ as
        // batidas com o nome DESTE funcionário — senão herdaria o ponto do outro.
        // Matrícula única → casa pela matrícula (robusto a divergência de grafia).
        const extKey = (emp as any).external_id ? String((emp as any).external_id) : '';
        const nameKey = emp.name.toLowerCase().trim();
        const extShared = !!extKey && (extIdNames.get(extKey)?.size || 0) > 1;
        if (extShared) sharedMatricula++;
        const empPunches = (extKey ? byExtIdName.get(`${extKey}|${nameKey}`) : null)
          || (!extShared && extKey ? byExternalId.get(extKey) : null)
          || byName.get(nameKey)
          || new Map<string, string[]>();

        // Escala do funcionário (própria ou a padrão — ex.: Dona Val não tem própria).
        const sch = (emp.work_schedule_id && (schedules as any[]).find(s => s.id === emp.work_schedule_id)) || defaultSchedule;

        const days: SalaryDayInput[] = coveredDays.map(d => {
          const isHoliday = holidaysSet.has(d.date);
          const isWorkday = worksOnDow(sch, d.dow) && !isHoliday;
          return {
            date: d.date,
            dayOfWeek: d.dow,
            isHoliday,
            isWorkday,
            expectedMinutes: isWorkday ? expectedDayMinutes(sch) : 0,
            punches: empPunches.get(d.date) || [],
          };
        });

        const result = calculateSalaryPayroll(
          Number(emp.salary) || 0,
          days,
          advancesByEmp.get(emp.id) || 0,
          undefined,        // dayDivisor (padrão 30)
          undefined,        // hourDivisor (padrão 220)
          periodDays,       // base proporcional aos dias do período (quinzena)
        );
        if (result.pending_days > 0) withIncomplete++;

        await upsertRun.mutateAsync({
          employee_id: emp.id,
          period,
          base_salary: Number(emp.salary) || 0,
          hourly_rate: result.valor_hora,
          worked_minutes: result.worked_minutes,
          normal_minutes: result.normal_minutes,
          premium_minutes: result.premium_minutes,
          normal_value: 0,
          premium_value: result.he_value,
          expected_minutes: result.expected_minutes,
          business_days: result.workdays,
          business_days_worked: result.worked_days,
          absent_days: result.falta_days,
          absence_discount: result.falta_desconto,
          deductions_amount: result.atraso_desconto,
          overtime_amount: result.he_value,
          advances_total: result.advances_total,
          total_proventos: result.total_proventos,
          total_descontos: result.total_descontos,
          total_liquido: result.net_value,
          net_salary: result.net_value,
          notes: result.pending_days > 0 ? `${result.pending_days} dia(s) pendente(s) — resolver no Pendências` : null,
          status: 'rascunho',
        });
        calculated++;
      }
      toast.success(
        `Folha calculada: ${calculated} funcionário(s).` +
        (clamped ? ` Parcial: ponto importado só até ${maxCov!.split('-').reverse().join('/')}.` : '') +
        (withIncomplete > 0 ? ` ${withIncomplete} com batida incompleta — confira no Ponto.` : '') +
        (sharedMatricula > 0 ? ` ⚠ ${sharedMatricula} com matrícula compartilhada — confira o cadastro (pode haver ponto de 2 pessoas na mesma matrícula).` : ''),
      );
    } catch (err: any) {
      toast.error(`Erro ao calcular folha: ${err.message}`);
    } finally {
      setCalcRunning(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Carregando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Base proporcional aos dias − descontos</span> · base = salário÷30 × dias do período · falta = −1 dia · atraso/saída cedo = min × (salário÷220) ·
          {' '}hora extra após 18h / fim de semana / feriado = <span className="font-semibold text-foreground">1,5×</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-9" onClick={() => applyPreset('1q')}>1ª quinz.</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => applyPreset('2q')}>2ª quinz.</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => applyPreset('mes')}>Mês</Button>
          </div>
          <div className="flex items-center gap-1">
            <Input type="date" value={range.from} max={range.to || undefined} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="w-36 h-9" aria-label="Data inicial" />
            <span className="text-muted-foreground text-xs">até</span>
            <Input type="date" value={range.to} min={range.from || undefined} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="w-36 h-9" aria-label="Data final" />
            <span className="text-xs text-muted-foreground whitespace-nowrap ml-1">{periodDays} dia(s)</span>
          </div>
          <Button size="sm" onClick={calculateAll} disabled={calcRunning || !range.from || !range.to}>
            {calcRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calculator className="h-4 w-4 mr-2" />}
            Calcular folha
          </Button>
        </div>
      </div>

      {coverage && coverage.count === 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Nenhuma batida importada para {periodTitle}. Importe o arquivo do relógio (aba Ponto) antes de calcular.</span>
        </div>
      )}
      {coverage && coverage.maxCovered && periodRange.to && coverage.maxCovered < periodRange.to && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Ponto importado só até <strong>{coverage.maxCovered.split('-').reverse().join('/')}</strong> neste período —
            os dias seguintes <strong>não entram</strong> na folha (evita subpagar). Fica <strong>parcial</strong> até você importar o resto.
          </span>
        </div>
      )}

      <PayrollPendingAdvancesAlert from={range.from} to={range.to} />

      <StatGrid>
        <StatCard label="Funcionários" value={runs.length} hint="na folha do período" />
        <StatCard label="Proventos" value={fmt(totals.proventos)} hint="salário + horas extras" tone="success" />
        <StatCard label="Descontos" value={fmt(totals.descontos)} hint="faltas + atrasos" tone="warning" />
        <StatCard
          label="Adiantamentos"
          value={fmt(totals.advances)}
          hint={totals.advances > 0 ? `${totals.advancesCount} func. com vale` : undefined}
          tone="warning"
          icon={Wallet}
        />
        <StatCard label="Total líquido" value={fmt(totals.liquido)} tone="primary" />
      </StatGrid>

      <Panel title={`Folha · ${periodTitle}`} flush>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
              <TableHead>Funcionário</TableHead>
              <TableHead className="text-right">Salário</TableHead>
              <TableHead className="text-right">Faltas</TableHead>
              <TableHead className="text-right">Atrasos</TableHead>
              <TableHead className="text-right">Hora extra</TableHead>
              <TableHead className="text-right">Adiant.</TableHead>
              <TableHead className="text-right">Líquido</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="p-0">
                  <EmptyState
                    icon={Calculator}
                    title="Nenhuma folha calculada"
                    description={`Não há folha para ${periodTitle}. Clique em "Calcular folha" para gerar a partir das batidas.`}
                  />
                </TableCell>
              </TableRow>
            ) : runs.map(r => {
              const emp = employeeMap.get(r.employee_id);
              const sb = STATUS_BADGES[r.status] || STATUS_BADGES.rascunho;
              const hasAdvance = (r.advances_total || 0) > 0;
              return (
                <TableRow key={r.id} className={hasAdvance ? 'hover:bg-muted/30 bg-amber-500/5' : 'hover:bg-muted/30'}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5">
                      {emp?.name || '—'}
                      {hasAdvance && <Wallet className="h-3.5 w-3.5 text-amber-600" aria-label="Possui adiantamento" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground tabular-nums" title={`Salário mensal ${fmt(r.base_salary)}`}>{fmt((r.total_proventos || 0) - (r.overtime_amount || 0))}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {(r.absent_days || 0) > 0
                      ? <span className="text-red-600 font-semibold">{r.absent_days}d · −{fmt(r.absence_discount)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {(r.deductions_amount || 0) > 0
                      ? <span className="text-red-600">−{fmt(r.deductions_amount)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {(r.overtime_amount || 0) > 0
                      ? <span className="text-emerald-600 font-semibold">+{fmt(r.overtime_amount)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className={`text-right font-mono tabular-nums ${hasAdvance ? 'text-amber-700 font-semibold' : 'text-muted-foreground'}`}>
                    {hasAdvance ? `− ${fmt(r.advances_total)}` : fmt(0)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums font-bold">{fmt(r.total_liquido)}</TableCell>
                  <TableCell><Badge variant={sb.variant}>{sb.label}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setDetailRun(r.id)}>
                        <Receipt className="h-4 w-4" />
                      </Button>
                      {r.status === 'rascunho' && (
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => {
                            if (hasAdvance) setApproveRun(r.id);
                            else updateStatus.mutate({ id: r.id, status: 'aprovado' });
                          }}
                          title={hasAdvance ? 'Revisar adiantamento antes de aprovar' : 'Aprovar folha'}
                        >
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        </Button>
                      )}
                      {r.status === 'aprovado' && (
                        <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: r.id, status: 'pago' })}>
                          <DollarSign className="h-4 w-4 text-primary" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Panel>

      {/* Confirmação de aprovação quando há adiantamento */}
      <AlertDialog open={!!approveRun} onOpenChange={(o) => !o && setApproveRun(null)}>
        <AlertDialogContent>
          {(() => {
            const r = runs.find(x => x.id === approveRun);
            if (!r) return null;
            const emp = employeeMap.get(r.employee_id);
            const adv = r.advances_total || 0;
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-amber-700">
                    <AlertTriangle className="h-5 w-5" />
                    Adiantamento já pago — confirmar?
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3 pt-2 text-sm">
                      <p>
                        <strong>{emp?.name}</strong> recebeu <strong className="text-amber-700">{fmt(adv)}</strong> de
                        adiantamento neste período. O líquido a pagar JÁ desconta esse valor.
                      </p>
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Bruto (salário + HE):</span>
                          <span className="font-mono tabular-nums">{fmt(r.total_proventos)}</span>
                        </div>
                        <div className="flex justify-between text-amber-700">
                          <span>Adiantamento já recebido:</span>
                          <span className="font-mono tabular-nums font-semibold">− {fmt(adv)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-1 mt-1">
                          <span className="font-semibold">Líquido a pagar:</span>
                          <span className="font-mono tabular-nums font-bold text-primary">{fmt(r.total_liquido)}</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Pague apenas o líquido acima. O vale já foi entregue.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { updateStatus.mutate({ id: r.id, status: 'aprovado' }); setApproveRun(null); }}>
                    Ciente, aprovar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>

      {/* Detalhe do holerite */}
      <Dialog open={!!detailRun} onOpenChange={(o) => !o && setDetailRun(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Holerite — salário − descontos</DialogTitle></DialogHeader>
          {(() => {
            const r = runs.find(x => x.id === detailRun);
            if (!r) return null;
            const emp = employeeMap.get(r.employee_id);
            // Base PAGA no período (proporcional): proventos − HE = valor-dia × dias.
            const pr = periodToRange(r.period);
            const pdays = daysBetween(pr.from, pr.to);
            const periodBase = (r.total_proventos || 0) - (r.overtime_amount || 0);
            const isFullMonth = pdays === 0 || pdays === 30;
            const lines = [
              {
                label: isFullMonth ? 'Salário base' : `Salário do período (${pdays} dia(s) × ${fmt((r.base_salary || 0) / 30)})`,
                value: periodBase, type: 'p' as const, always: true,
              },
              { label: `Horas extras 1,5× (${fmtHoras(r.premium_minutes)})`, value: r.overtime_amount || 0, type: 'p' as const },
              { label: `Faltas (${r.absent_days || 0} dia(s) × ${fmt((r.base_salary || 0) / 30)})`, value: r.absence_discount || 0, type: 'd' as const, highlight: (r.absent_days || 0) > 0 },
              { label: 'Atrasos / saídas cedo', value: r.deductions_amount || 0, type: 'd' as const },
              { label: 'Adiantamentos do período', value: r.advances_total || 0, type: 'd' as const, highlight: true },
            ].filter(l => l.value > 0 || (l as any).always);

            return (
              <div className="space-y-3">
                <div className="text-sm">
                  <p className="font-bold text-base">{emp?.name}</p>
                  <p className="text-muted-foreground">{emp?.role || '—'} • {emp?.department || '—'} • Período {periodLabel(periodToRange(r.period).from, periodToRange(r.period).to)}</p>
                  <p className="text-muted-foreground flex items-center gap-1 mt-1">
                    <Clock className="h-3.5 w-3.5" />
                    Total trabalhado: <span className="font-mono font-semibold text-foreground">{fmtHoras(r.worked_minutes)}</span>
                    {' '}· valor-hora <span className="font-mono font-semibold text-foreground">{fmt(r.hourly_rate)}</span>
                    {' '}· salário mensal <span className="font-mono font-semibold text-foreground">{fmt(r.base_salary)}</span>
                  </p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Descrição</TableHead><TableHead className="text-right">Provento</TableHead><TableHead className="text-right">Desconto</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={i} className={(l as any).highlight ? 'bg-amber-500/10' : ''}>
                        <TableCell className={(l as any).highlight ? 'font-semibold text-amber-700' : ''}>
                          {(l as any).highlight && <Wallet className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />}
                          {l.label}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{l.type === 'p' ? fmt(l.value) : ''}</TableCell>
                        <TableCell className={`text-right font-mono tabular-nums ${(l as any).highlight ? 'text-amber-700 font-semibold' : 'text-destructive'}`}>
                          {l.type === 'd' ? fmt(l.value) : ''}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-between border-t pt-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Bruto</p>
                    <p className="font-bold text-emerald-600">{fmt(r.total_proventos)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Descontos</p>
                    <p className="font-bold text-destructive">{fmt(r.total_descontos)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Líquido a receber</p>
                    <p className="font-bold text-lg text-primary">{fmt(r.total_liquido)}</p>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Aviso no topo da Folha: vales pendentes do período (serão descontados ao
 * aprovar). HE/banco de horas foram aposentados — só adiantamento sobra.
 */
function PayrollPendingAdvancesAlert({ from, to }: { from: string; to: string }) {
  // Intervalo pode estar incompleto enquanto o usuário ajusta as datas — só consulta
  // quando from/to são datas válidas e from ≤ to.
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const periodStart = valid ? from : '';
  const periodEnd = valid ? to : '';

  const { data } = useQuery({
    queryKey: ['payroll_pending_advances', from, to],
    enabled: valid,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('employee_advances')
        .select('id, amount, status, payroll_run_id')
        .gte('advance_date', periodStart)
        .lte('advance_date', periodEnd);
      const pending = (data || []).filter((a: any) => a.payroll_run_id == null && a.status === 'pending');
      return {
        count: pending.length,
        total: pending.reduce((s: number, a: any) => s + Number(a.amount || 0), 0),
      };
    },
    staleTime: 30_000,
  });

  if (!data || data.count === 0) return null;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-xs text-amber-800">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          <strong className="font-bold">{data.count} vale(s)</strong> pendente(s) neste período —
          total {data.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.
          Serão descontados automaticamente ao aprovar a folha.
        </span>
      </div>
    </div>
  );
}

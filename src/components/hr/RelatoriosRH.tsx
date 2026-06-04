import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Clock, CurrencyDollar as DollarSign, CaretRight, CaretDown,
  Warning as AlertTriangle, Users as Users2, Printer,
  CalendarBlank as Calendar, IdentificationCard,
} from '@phosphor-icons/react';
import { useEmployees } from '@/hooks/useEmployees';
import { useHolidays, useTimesheetCoverage, useWorkSchedules, calculateDaySummary, type DaySummary } from '@/hooks/useTimesheet';
import { useBankHoursBalances } from '@/hooks/useRH';
import { splitDayMinutes, MONTHLY_HOURS_DIVISOR } from '@/lib/hourlyPayroll';
import { computePeriodFolha, expectedDayMinutes, type SalaryPayrollResult } from '@/lib/salaryPayroll';
import {
  printEmployeeTimesheet, printConsolidatedHoursReport,
  printEmployeeEvaluationDetailed, printEmployeeEvaluationSummary,
  printCalendarReport, printIndividualCalendarReport,
  type EmployeeTimesheetData,
} from '@/lib/printTimesheet';
import { printTimeMirror } from '@/lib/printTimeMirror';
import { usePersistedState } from '@/hooks/usePersistedState';

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const ALL = '__all__';

/** Período inválido (ex.: "2026-00") → [] (não gera datas tortas). */
function getMonthDays(period: string): { date: string; dow: number }[] {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return [];
  const last = new Date(y, m, 0).getDate();
  const out: { date: string; dow: number }[] = [];
  for (let d = 1; d <= last; d++) {
    const dt = new Date(y, m - 1, d);
    out.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, dow: dt.getDay() });
  }
  return out;
}

const fmtH = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtBR = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : '—');
const cleanPunch = (p: string) => String(p).replace(/\*$/, '');

interface EmpRow {
  id: string;
  name: string;
  role?: string;
  days: { date: string; dow: number; isHoliday: boolean; punches: string[]; normal: number; premium: number }[];
  result: SalaryPayrollResult;
}

/**
 * RELATÓRIO DE PONTO — um relatório só, com 4 VISÕES e um seletor Individual ↔ Todos:
 *   1. HORAS      — horas trabalhadas por funcionário (resumo + detalhe/dia). Imprime
 *                   consolidado (todos) ou a folha-ponto individual.
 *   2. PAGAMENTO  — o MESMO cálculo da aba Folha (salário − descontos, hora extra
 *                   LÍQUIDA do período) via `computePeriodFolha`. Imprime a Avaliação
 *                   de Jornada (resumo de todos ou detalhada do indivíduo).
 *   3. CALENDÁRIO — grade visual mês × dia, ideal pra impressão (todos ou individual).
 *   4. ESPELHO    — documento legal individual (Portaria 671): CPF/PIS, batidas, banco
 *                   de horas. Regime CLT/528 (`calculateDaySummary`), assinável.
 *
 * Unificado em 2026-06-04: antes os ~9 relatórios viviam espalhados na tela do Ponto.
 * Pagamento/Horas alinhados à Folha; Espelho/Banco seguem no regime legal CLT.
 */
export default function RelatoriosRH() {
  const today = new Date();
  const [period, setPeriod] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
  const [tab, setTab] = usePersistedState<string>('rh-relatorios-tab', 'ponto');
  const [scope, setScope] = useState<string>(ALL);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: employees = [] } = useEmployees();
  const { data: holidaysList = [] } = useHolidays();
  const { data: schedules = [] } = useWorkSchedules();
  const { data: bankBalances = [] } = useBankHoursBalances();
  const defaultSchedule = useMemo(() => (schedules as any[]).find(s => s.is_default) || (schedules as any[])[0] || null, [schedules]);

  const holidaysSet = useMemo(
    () => new Set((holidaysList as { holiday_date: string; optional?: boolean }[])
      .filter(h => h.optional !== true).map(h => h.holiday_date)),
    [holidaysList],
  );
  const monthDays = useMemo(() => getMonthDays(period), [period]);
  const periodRange = useMemo(
    () => ({ from: monthDays[0]?.date, to: monthDays[monthDays.length - 1]?.date }),
    [monthDays],
  );
  const periodLabel = useMemo(() => {
    const [y, m] = period.split('-');
    const mi = Number(m) - 1;
    return MONTHS_PT[mi] ? `${MONTHS_PT[mi]}/${y}` : period;
  }, [period]);
  const { data: coverage } = useTimesheetCoverage(periodRange.from, periodRange.to);

  const { data: timeRecords = [], isLoading } = useQuery({
    queryKey: ['rh-report-records', periodRange.from, periodRange.to],
    enabled: !!(periodRange.from && periodRange.to),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_records')
        .select('employee_external_id, employee_name, record_date, punches')
        .gte('record_date', periodRange.from!)
        .lte('record_date', periodRange.to!);
      if (error) throw error;
      return (data || []) as { employee_external_id: string | null; employee_name: string | null; record_date: string; punches: string[] }[];
    },
  });

  const rows: EmpRow[] = useMemo(() => {
    // Mapas batida → dia, por matrícula e por nome (mesmo casamento da Folha).
    const byExternalId = new Map<string, Map<string, string[]>>();
    const byName = new Map<string, Map<string, string[]>>();
    for (const r of timeRecords) {
      const punches: string[] = Array.isArray(r.punches) ? r.punches : [];
      if (r.employee_external_id) {
        const k = String(r.employee_external_id);
        if (!byExternalId.has(k)) byExternalId.set(k, new Map());
        byExternalId.get(k)!.set(r.record_date, punches);
      }
      const nk = (r.employee_name || '').toLowerCase().trim();
      if (nk) {
        if (!byName.has(nk)) byName.set(nk, new Map());
        byName.get(nk)!.set(r.record_date, punches);
      }
    }
    // Clamp à cobertura: só conta até o último dia com ponto importado.
    const maxCov = coverage?.maxCovered || null;
    const coveredDays = maxCov ? monthDays.filter(d => d.date <= maxCov) : monthDays;

    return employees
      .filter(e => e.active)
      .map(emp => {
        const extKey = (emp as { external_id?: string }).external_id ? String((emp as { external_id?: string }).external_id) : '';
        const empPunches = (extKey && byExternalId.get(extKey))
          || byName.get(emp.name.toLowerCase().trim())
          || new Map<string, string[]>();

        const days = coveredDays.map(d => {
          const punches = empPunches.get(d.date) || [];
          const { normal, premium } = punches.length >= 2
            ? splitDayMinutes(punches, d.dow, holidaysSet.has(d.date))
            : { normal: 0, premium: 0 };
          return { date: d.date, dow: d.dow, isHoliday: holidaysSet.has(d.date), punches, normal, premium };
        });

        // PAGAMENTO = mesmo motor da Folha (HE líquida do período, esperado da escala).
        const sch = ((emp as { work_schedule_id?: string }).work_schedule_id && (schedules as any[]).find(s => s.id === (emp as any).work_schedule_id)) || defaultSchedule;
        const result = computePeriodFolha({
          salary: Number(emp.salary) || 0,
          from: coveredDays[0]?.date || '',
          to: coveredDays[coveredDays.length - 1]?.date || '',
          schedule: sch, holidaysSet, punchesByDate: empPunches,
        });

        return { id: emp.id, name: emp.name, role: (emp as { role?: string }).role, days, result };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [employees, timeRecords, monthDays, coverage, holidaysSet, schedules, defaultSchedule]);

  // Linhas visíveis conforme o escopo (Todos ou 1 funcionário).
  const visibleRows = useMemo(() => (scope === ALL ? rows : rows.filter(r => r.id === scope)), [rows, scope]);
  const scopedRow = useMemo(() => (scope === ALL ? null : rows.find(r => r.id === scope) || null), [rows, scope]);

  const totals = useMemo(() => ({
    normalMin: visibleRows.reduce((s, r) => s + r.result.normal_minutes, 0),
    premiumMin: visibleRows.reduce((s, r) => s + r.result.premium_minutes, 0),
    heMin: visibleRows.reduce((s, r) => s + r.result.he_minutes, 0),
    salarioBase: visibleRows.reduce((s, r) => s + r.result.base_salary, 0),
    faltaDesc: visibleRows.reduce((s, r) => s + r.result.falta_desconto, 0),
    atrasoDesc: visibleRows.reduce((s, r) => s + r.result.atraso_desconto, 0),
    heVal: visibleRows.reduce((s, r) => s + r.result.he_value, 0),
    pagar: visibleRows.reduce((s, r) => s + r.result.gross_value, 0),
  }), [visibleRows]);

  const toggle = (id: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const isPartial = !!(coverage?.maxCovered && periodRange.to && coverage.maxCovered < periodRange.to);

  // ── Monta o EmployeeTimesheetData (que as funções de impressão consomem) ──
  const buildPrintData = (row: EmpRow): EmployeeTimesheetData => {
    const emp = employees.find(e => e.id === row.id);
    const sch = ((emp as any)?.work_schedule_id && (schedules as any[]).find(s => s.id === (emp as any).work_schedule_id)) || defaultSchedule;
    const days: DaySummary[] = row.days.map(d => {
      const summary = calculateDaySummary(d.punches, d.dow, sch as any, d.isHoliday);
      return { ...summary, date: d.date, punches: d.punches } as DaySummary;
    });
    return {
      name: row.name,
      days,
      schedule: {
        overtime_multiplier: (sch as any)?.overtime_multiplier ?? 1.5,
        holiday_multiplier: (sch as any)?.holiday_multiplier ?? 2,
        minimum_overtime_minutes: (sch as any)?.minimum_overtime_minutes || 0,
      },
      hourlySalary: (Number(emp?.salary) || 0) / MONTHLY_HOURS_DIVISOR,
      overtimeHourlyRate: (emp as any)?.overtime_hourly_rate ?? null,
      expectedDayMin: expectedDayMinutes(sch),
    };
  };

  const printEspelho = (row: EmpRow) => {
    const data = buildPrintData(row);
    const emp = employees.find(e => e.id === row.id);
    const balance = bankBalances.find((b: any) => b.employee_id === row.id);
    const days = data.days.map(d => ({
      date: d.date, dayOfWeek: d.dayOfWeek, punches: d.punches,
      workedMinutes: d.workedMinutes, expectedMinutes: d.expectedMinutes,
      overtimeMinutes: d.overtimeMinutes, status: d.status,
      notes: d.isHoliday ? 'FERIADO' : '',
    }));
    printTimeMirror({
      employee: {
        name: emp?.name || row.name,
        external_id: (emp as any)?.external_id,
        role: emp?.role,
        department: (emp as any)?.department,
        cpf: (emp as any)?.cpf,
        pis: (emp as any)?.pis,
        admission_date: (emp as any)?.admission_date,
      },
      company: { name: (typeof window !== 'undefined' && (window as any).COMPANY_NAME) || 'Empresa' },
      period,
      days,
      bankHoursBalance: (balance as any)?.balance_min,
    });
  };

  // Dispara a impressão da visão ativa, respeitando o escopo.
  const handlePrint = () => {
    if (visibleRows.length === 0) return;
    const allData = visibleRows.map(buildPrintData);
    if (tab === 'ponto') {
      if (scope === ALL) printConsolidatedHoursReport(allData, periodLabel);
      else if (scopedRow) printEmployeeTimesheet(buildPrintData(scopedRow), periodLabel);
    } else if (tab === 'pagamento') {
      if (scope === ALL) printEmployeeEvaluationSummary(allData, periodLabel);
      else if (scopedRow) printEmployeeEvaluationDetailed([buildPrintData(scopedRow)], periodLabel);
    } else if (tab === 'calendario') {
      if (scope === ALL) printCalendarReport(allData, periodLabel);
      else if (scopedRow) printIndividualCalendarReport(buildPrintData(scopedRow), periodLabel);
    } else if (tab === 'espelho') {
      if (scopedRow) printEspelho(scopedRow);
    }
  };

  const espelhoNeedsEmployee = tab === 'espelho' && scope === ALL;
  const printDisabled = visibleRows.length === 0 || espelhoNeedsEmployee;
  const printLabel = tab === 'ponto' ? 'Imprimir horas'
    : tab === 'pagamento' ? 'Imprimir pagamento'
    : tab === 'calendario' ? 'Imprimir calendário'
    : 'Imprimir espelho';

  const Toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-40 h-9" />
      <Select value={scope} onValueChange={setScope}>
        <SelectTrigger className="w-56 h-9">
          <Users2 className="h-4 w-4 mr-1.5 text-muted-foreground" />
          <SelectValue placeholder="Funcionário" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos os funcionários</SelectItem>
          {rows.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" className="h-9 gap-1.5 ml-auto" onClick={handlePrint} disabled={printDisabled}>
        <Printer className="h-4 w-4" /> {printLabel}
      </Button>
    </div>
  );

  const CoverageBanner = isPartial ? (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        Ponto importado só até <strong>{fmtBR(coverage!.maxCovered!)}</strong> neste mês — os dias seguintes ainda
        não entram (importe o resto na aba Ponto). Os números abaixo são <strong>parciais</strong>.
      </span>
    </div>
  ) : null;

  const Empty = (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">
        <Users2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
        Nenhum funcionário ativo com ponto neste período.
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {Toolbar}
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
        <DollarSign className="h-4 w-4 shrink-0" />
        <span>
          <strong>Horas e Pagamento alinhados à Folha</strong> — salário − descontos, hora extra só no excedente do período
          (valor-hora = salário ÷ {MONTHLY_HOURS_DIVISOR}). O <strong>Espelho de Ponto</strong> segue no regime legal CLT (44h/semana), assinável.
        </span>
      </div>
      {CoverageBanner}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'ponto', label: 'Horas', icon: Clock },
          { value: 'pagamento', label: 'Pagamento', icon: DollarSign },
          { value: 'calendario', label: 'Calendário', icon: Calendar },
          { value: 'espelho', label: 'Espelho (legal)', icon: IdentificationCard },
        ]} />

        {/* ── HORAS: resumo por funcionário + detalhe por dia ── */}
        <TabsContent value="ponto">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Carregando…</div>
          ) : visibleRows.length === 0 ? Empty : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Horas por funcionário — clique para ver dia a dia
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Funcionário</TableHead>
                        <TableHead className="text-right">Dias trab.</TableHead>
                        <TableHead className="text-right">Horas normais</TableHead>
                        <TableHead className="text-right">Horas 1,5×</TableHead>
                        <TableHead className="text-right">Total horas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleRows.map(r => {
                        const open = expanded.has(r.id) || scope === r.id;
                        return [
                          <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(r.id)}>
                            <TableCell className="text-muted-foreground">
                              {open ? <CaretDown className="h-4 w-4" /> : <CaretRight className="h-4 w-4" />}
                            </TableCell>
                            <TableCell className="font-medium">
                              {r.name}
                              {r.result.pending_days > 0 && (
                                <Badge className="ml-2 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-normal gap-1">
                                  <AlertTriangle className="h-3 w-3" />{r.result.pending_days} incompleto(s)
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{r.result.worked_days}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtH(r.result.normal_minutes)}</TableCell>
                            <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-400">
                              {r.result.premium_minutes > 0 ? fmtH(r.result.premium_minutes) : '—'}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{fmtH(r.result.worked_minutes)}</TableCell>
                          </TableRow>,
                          open && (
                            <TableRow key={`${r.id}-detail`} className="bg-muted/20">
                              <TableCell />
                              <TableCell colSpan={5} className="py-2">
                                <div className="rounded-md border border-border/60 overflow-hidden">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="text-xs">Data</TableHead>
                                        <TableHead className="text-xs">Dia</TableHead>
                                        <TableHead className="text-xs">Batidas</TableHead>
                                        <TableHead className="text-xs text-right">Normais</TableHead>
                                        <TableHead className="text-xs text-right">1,5×</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {r.days.filter(d => d.punches.length > 0).length === 0 ? (
                                        <TableRow><TableCell colSpan={5} className="text-xs text-muted-foreground py-2">Sem batidas no período coberto.</TableCell></TableRow>
                                      ) : r.days.filter(d => d.punches.length > 0).map(d => (
                                        <TableRow key={d.date}>
                                          <TableCell className="text-xs tabular-nums">{fmtBR(d.date)}</TableCell>
                                          <TableCell className="text-xs">
                                            {DAYS_PT[d.dow]}{d.isHoliday && <span className="ml-1 text-amber-600">feriado</span>}
                                          </TableCell>
                                          <TableCell className="text-xs font-mono">{d.punches.map(cleanPunch).join(' · ')}</TableCell>
                                          <TableCell className="text-xs text-right tabular-nums">{fmtH(d.normal)}</TableCell>
                                          <TableCell className="text-xs text-right tabular-nums text-amber-700 dark:text-amber-400">{d.premium > 0 ? fmtH(d.premium) : '—'}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          ),
                        ];
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── PAGAMENTO: a MESMA conta da Folha (salário − descontos, HE líquida) ── */}
        <TabsContent value="pagamento">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Carregando…</div>
          ) : visibleRows.length === 0 ? Empty : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> Pagamento pela conta da Folha (salário − descontos)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Funcionário</TableHead>
                        <TableHead className="text-right">Salário</TableHead>
                        <TableHead className="text-right">Faltas</TableHead>
                        <TableHead className="text-right">Atrasos</TableHead>
                        <TableHead className="text-right">HE líq.</TableHead>
                        <TableHead className="text-right">Líquido</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleRows.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{fmtBRL(r.result.base_salary)}</TableCell>
                          <TableCell className="text-right tabular-nums text-destructive">{r.result.falta_desconto > 0 ? '-' + fmtBRL(r.result.falta_desconto) : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums text-destructive">{r.result.atraso_desconto > 0 ? '-' + fmtBRL(r.result.atraso_desconto) : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{r.result.he_value > 0 ? '+' + fmtBRL(r.result.he_value) : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{fmtBRL(r.result.gross_value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <tfoot>
                      <TableRow className="border-t-2 font-semibold bg-muted/30">
                        <TableCell>Total ({visibleRows.length})</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{fmtBRL(totals.salarioBase)}</TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">{totals.faltaDesc > 0 ? '-' + fmtBRL(totals.faltaDesc) : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">{totals.atrasoDesc > 0 ? '-' + fmtBRL(totals.atrasoDesc) : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{totals.heVal > 0 ? '+' + fmtBRL(totals.heVal) : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmtBRL(totals.pagar)}</TableCell>
                      </TableRow>
                    </tfoot>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── CALENDÁRIO: grade visual mês × dia (impressão) ── */}
        <TabsContent value="calendario">
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <Calendar className="h-10 w-10 mx-auto text-muted-foreground opacity-50" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Calendário de ponto — {periodLabel}</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Grade visual dia a dia {scope === ALL ? 'de todos os funcionários' : `de ${scopedRow?.name || ''}`}, ideal para impressão e conferência
                  rápida (cores por status: normal, hora extra, falta, feriado).
                </p>
              </div>
              <Button size="sm" className="gap-1.5" onClick={handlePrint} disabled={printDisabled}>
                <Printer className="h-4 w-4" /> Imprimir calendário
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ESPELHO: documento legal individual (Portaria 671) ── */}
        <TabsContent value="espelho">
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <IdentificationCard className="h-10 w-10 mx-auto text-muted-foreground opacity-50" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Espelho de Ponto — documento legal</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Documento individual assinável (Portaria 671): dados do funcionário (CPF/PIS), batidas dia a dia,
                  horas esperadas × trabalhadas e saldo de banco de horas. Segue o <strong>regime legal CLT (44h/semana)</strong>.
                </p>
              </div>
              {espelhoNeedsEmployee ? (
                <div className="text-xs text-amber-700 dark:text-amber-400 flex items-center justify-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> Selecione um funcionário no seletor acima para gerar o espelho.
                </div>
              ) : (
                <Button size="sm" className="gap-1.5" onClick={handlePrint} disabled={printDisabled}>
                  <Printer className="h-4 w-4" /> Imprimir espelho de {scopedRow?.name || ''}
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

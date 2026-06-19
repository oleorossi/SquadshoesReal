import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
  CalendarBlank as Calendar, IdentificationCard, DownloadSimple,
  Scales, PencilSimple, Check, X as XIcon,
} from '@phosphor-icons/react';
import { useEmployees } from '@/hooks/useEmployees';
import { useHolidays, useTimesheetCoverage, useWorkSchedules, calculateDaySummary, type DaySummary } from '@/hooks/useTimesheet';
import { splitDayMinutes, MONTHLY_HOURS_DIVISOR } from '@/lib/hourlyPayroll';
import { computePeriodFolha, expectedDayMinutes, getDaysInRange, type SalaryPayrollResult } from '@/lib/salaryPayroll';
import {
  printEmployeeTimesheet, printConsolidatedHoursReport,
  printEmployeeEvaluationDetailed, printFolhaComparativo,
  printCalendarReport, printIndividualCalendarReport,
  type EmployeeTimesheetData,
} from '@/lib/printTimesheet';
import { printTimeMirror, type TimeMirrorDay } from '@/lib/printTimeMirror';
import { exportFolhaExcel } from '@/lib/exportFolhaExcel';
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

type SitTone = 'green' | 'amber' | 'red';
/** Flag de qualidade do ponto (Situação) — o que conferir antes de pagar. */
function computeSituacao(r: SalaryPayrollResult, matchedDays: number, maxCov: string | null, monthTo: string): { txt: string; tone: SitTone } {
  if (r.workdays === 0) return { txt: 'Sem escala / sem dias úteis', tone: 'red' };
  if (matchedDays === 0) return { txt: 'Sem ponto importado', tone: 'red' };
  if (matchedDays <= 5) return { txt: `Ponto faltando — só ${matchedDays} dia(s) batido(s)`, tone: 'red' };
  if (r.falta_days >= 10) return { txt: `Muitas faltas (${r.falta_days}) — conferir ponto`, tone: 'red' };
  if (r.pending_days >= 3) return { txt: `${r.pending_days} batidas ímpares — resolver em Pendências`, tone: 'amber' };
  if (maxCov && monthTo && maxCov < monthTo) return { txt: `Ponto só até ${fmtBR(maxCov)} — parcial`, tone: 'amber' };
  if (r.pending_days > 0) return { txt: `${r.pending_days} pendência(s) de batida`, tone: 'amber' };
  if (r.falta_days > 0) return { txt: `${r.falta_days} falta(s) no período`, tone: 'amber' };
  return { txt: 'OK', tone: 'green' };
}

interface EmpRow {
  id: string;
  ext?: string;
  name: string;
  role?: string;
  days: { date: string; dow: number; isHoliday: boolean; punches: string[]; normal: number; premium: number }[];
  result: SalaryPayrollResult;   // mês cheio (base = salário)
  q1: SalaryPayrollResult;       // 1ª quinzena (01–15, base ×15/30)
  q2: SalaryPayrollResult;       // 2ª quinzena (16–fim, base ×(fim−15)/30)
  matchedDays: number;           // dias com ponto importado no mês
  advMes: number;                // adiantamentos pendentes do mês (R$)
  sit: { txt: string; tone: SitTone };
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
  // Edição inline de batidas (resolver pendência de horário direto no relatório).
  // { empId, date } da linha em edição + o texto editável das batidas.
  const [editPunch, setEditPunch] = useState<{ empId: string; date: string; value: string } | null>(null);
  const qc = useQueryClient();

  const { data: employees = [] } = useEmployees();
  const { data: holidaysList = [] } = useHolidays();
  const { data: schedules = [] } = useWorkSchedules();
  const defaultSchedule = useMemo(() => (schedules as any[]).find(s => s.is_default) || (schedules as any[])[0] || null, [schedules]);

  const holidaysSet = useMemo(
    () => new Set((holidaysList as { holiday_date: string; optional?: boolean }[])
      .filter(h => h.optional !== true).map(h => h.holiday_date)),
    [holidaysList],
  );
  const monthDays = useMemo(() => getMonthDays(period), [period]);
  const monthBounds = useMemo(
    () => ({ from: monthDays[0]?.date || `${period}-01`, to: monthDays[monthDays.length - 1]?.date || `${period}-01` }),
    [monthDays, period],
  );
  // Intervalo SELECIONADO (dias). Default = mês inteiro; o usuário pode estreitar
  // pra qualquer faixa de dias (De/Até + atalhos). O `period` (mês) segue valendo
  // como referência da quinzena e do divisor proporcional do salário. (2026-06-19.)
  const [range, setRange] = useState<{ from: string; to: string }>(monthBounds);
  // Ao trocar o MÊS no seletor, realinha o range pro mês inteiro.
  useEffect(() => { setRange(monthBounds); }, [monthBounds.from, monthBounds.to]);
  const periodRange = range;
  const rangeDays = useMemo(() => getDaysInRange(range.from, range.to), [range]);
  const isFullMonth = range.from === monthBounds.from && range.to === monthBounds.to;
  const periodLabel = useMemo(() => {
    const [y, m] = period.split('-');
    const mi = Number(m) - 1;
    const monthLbl = MONTHS_PT[mi] ? `${MONTHS_PT[mi]}/${y}` : period;
    return isFullMonth ? monthLbl : `${fmtBR(range.from)} a ${fmtBR(range.to)}`;
  }, [period, isFullMonth, range.from, range.to]);
  const { data: coverage } = useTimesheetCoverage(periodRange.from, periodRange.to);

  const { data: timeRecords = [], isLoading } = useQuery({
    queryKey: ['rh-report-records', periodRange.from, periodRange.to],
    enabled: !!(periodRange.from && periodRange.to),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_records')
        .select('id, employee_external_id, employee_name, record_date, punches')
        .gte('record_date', periodRange.from!)
        .lte('record_date', periodRange.to!);
      if (error) throw error;
      return (data || []) as { id: string; employee_external_id: string | null; employee_name: string | null; record_date: string; punches: string[] }[];
    },
  });

  // Adiantamentos pendentes do período (único desconto além de faltas/atrasos) — mesma
  // regra da Folha: vales já amarrados a outra folha (payroll_run_id) não entram de novo.
  const { data: advancesList = [] } = useQuery({
    queryKey: ['rh-report-advances', periodRange.from, periodRange.to],
    enabled: !!(periodRange.from && periodRange.to),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_advances')
        .select('employee_id, amount, advance_date, status, payroll_run_id')
        .gte('advance_date', periodRange.from!)
        .lte('advance_date', periodRange.to!)
        .or('payroll_run_id.is.null,status.eq.pending');
      if (error) throw error;
      return (data || []) as { employee_id: string; amount: number; advance_date: string }[];
    },
  });

  // Lookup do id da row de time_records (UPDATE preciso). Casa por matrícula
  // (external_id) ou nome — mesmo critério do relatório.
  const recordIdByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of timeRecords) {
      if (!r.id) continue;
      if (r.employee_external_id) m.set(`x:${r.employee_external_id}::${r.record_date}`, r.id);
      const nk = (r.employee_name || '').toLowerCase().trim();
      if (nk) m.set(`n:${nk}::${r.record_date}`, r.id);
    }
    return m;
  }, [timeRecords]);

  const savePunches = useMutation({
    mutationFn: async ({ recordId, ext, name, date, punches }: { recordId: string | null; ext?: string; name: string; date: string; punches: string[] }) => {
      if (recordId) {
        const { error } = await supabase.from('time_records').update({ punches }).eq('id', recordId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('time_records')
          .insert({ employee_external_id: ext || null, employee_name: name, record_date: date, punches } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      // Recálculo AUTOMÁTICO: invalida a base de batidas (e cobertura/pendências)
      // — o motor (splitDayMinutes + computePeriodFolha) recomputa no refetch.
      qc.invalidateQueries({ predicate: (q) => {
        const k = String(q.queryKey?.[0] ?? '');
        return k.startsWith('rh-report') || k.includes('coverage') || k.includes('timesheet') || k.includes('pend') || k.includes('time_record');
      }});
      toast.success('Batidas atualizadas — relatório recalculado.');
      setEditPunch(null);
    },
    onError: (e: Error) => toast.error(`Erro ao salvar batidas: ${e.message}`),
  });

  // Texto "08:00 12:00 13:00 18:00" → array validado (HH:MM), par e ordenado.
  const saveEditedPunches = (empId: string, ext: string | undefined, name: string, date: string, raw: string) => {
    const tokens = raw.split(/[\s,;·]+/).map(t => t.trim()).filter(Boolean);
    const norm: string[] = [];
    for (const t of tokens) {
      const mt = t.match(/^(\d{1,2}):(\d{2})$/);
      if (!mt || Number(mt[1]) > 23 || Number(mt[2]) > 59) {
        toast.error(`Horário inválido: "${t}" — use HH:MM (ex.: 08:00).`);
        return;
      }
      norm.push(`${mt[1].padStart(2, '0')}:${mt[2]}`);
    }
    if (norm.length % 2 !== 0) {
      toast.error('Número ÍMPAR de batidas — falta uma entrada/saída (cada turno = entrada + saída).');
      return;
    }
    norm.sort();
    const recordId = (ext && recordIdByKey.get(`x:${ext}::${date}`))
      || recordIdByKey.get(`n:${name.toLowerCase().trim()}::${date}`) || null;
    savePunches.mutate({ recordId, ext, name, date, punches: norm });
  };

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
    // Itera sobre o INTERVALO selecionado (dias), não o mês inteiro.
    const coveredDays = (maxCov ? rangeDays.filter(d => d.date <= maxCov) : rangeDays);
    const rangeFrom = range.from;
    const rangeTo = range.to;
    // Limites do mês + quinzenas (1ª = 01–15, 2ª = 16–fim) — referência do mês
    // do `period`, independente do intervalo escolhido.
    const monthTo = monthDays[monthDays.length - 1]?.date || '';
    const q2Days = Math.max(0, monthDays.length - 15);
    // Adiantamentos do período por funcionário (descontados do líquido, como na Folha).
    const advByEmp = new Map<string, { advance_date: string; amount: number }[]>();
    for (const a of advancesList) {
      if (!advByEmp.has(a.employee_id)) advByEmp.set(a.employee_id, []);
      advByEmp.get(a.employee_id)!.push({ advance_date: a.advance_date, amount: Number(a.amount) || 0 });
    }

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

        // FOLHA em 3 períodos — MESMO motor (HE líquida do período), base PROPORCIONAL
        // na quinzena; clamp à cobertura pra não inventar falta em dia sem ponto importado.
        const sch = ((emp as { work_schedule_id?: string }).work_schedule_id && (schedules as any[]).find(s => s.id === (emp as any).work_schedule_id)) || defaultSchedule;
        const empAdvances = advByEmp.get(emp.id) || [];
        const folha = (from: string, to: string, periodDays?: number) => computePeriodFolha({
          salary: Number(emp.salary) || 0, from, to,
          schedule: sch, holidaysSet, punchesByDate: empPunches,
          periodDays, monthDays: monthDays.length, maxCoveredDate: maxCov,
          advancesTotal: empAdvances.filter(a => a.advance_date >= from && a.advance_date <= to).reduce((s, a) => s + a.amount, 0),
        });
        const result = folha(rangeFrom, rangeTo, rangeDays.length); // intervalo selecionado
        const q1 = folha(`${period}-01`, `${period}-15`, 15);  // 1ª quinzena (15/30)
        const q2 = folha(`${period}-16`, monthTo, q2Days);     // 2ª quinzena ((fim−15)/30)
        const matchedDays = Array.from(empPunches.keys()).filter(d => d >= rangeFrom && d <= rangeTo).length;
        const advMes = empAdvances.reduce((s, a) => s + a.amount, 0);
        const sit = computeSituacao(result, matchedDays, maxCov, rangeTo);

        return {
          id: emp.id, ext: extKey || undefined, name: emp.name,
          role: (emp as { role?: string }).role, days, result, q1, q2, matchedDays, advMes, sit,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [employees, timeRecords, advancesList, monthDays, period, range, rangeDays, coverage, holidaysSet, schedules, defaultSchedule]);

  // Linhas visíveis conforme o escopo (Todos ou 1 funcionário).
  const visibleRows = useMemo(() => (scope === ALL ? rows : rows.filter(r => r.id === scope)), [rows, scope]);
  const scopedRow = useMemo(() => (scope === ALL ? null : rows.find(r => r.id === scope) || null), [rows, scope]);

  // Saldo do banco de horas DO PERÍODO impresso (não o acumulado) por funcionário.
  // O Espelho é documento do mês, então o rodapé reflete o saldo do período
  // (calculate_employee_bank_balance com from/to do mês). Pré-carregado num Map
  // pra printEspelho ficar SÍNCRONO (sem await antes do window.open → sem popup
  // bloqueado). (auditoria 2026-06-17 — antes mostrava o acumulado desde 15/04.)
  const periodBankIds = visibleRows.map(r => r.id).join(',');
  const { data: periodBankBalance } = useQuery({
    queryKey: ['espelho_period_bank', periodRange.from, periodRange.to, periodBankIds],
    enabled: !!periodRange.from && !!periodRange.to && visibleRows.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const m = new Map<string, number>();
      await Promise.all(visibleRows.map(async (r) => {
        try {
          const { data } = await (supabase as any).rpc('calculate_employee_bank_balance', {
            p_employee_id: r.id, p_from: periodRange.from, p_to: periodRange.to, p_skip_missing: true,
          });
          const bal = (data as any)?.balance_min;
          if (typeof bal === 'number') m.set(r.id, bal);
        } catch { /* ignora — cai em '—' no rodapé do espelho */ }
      }));
      return m;
    },
  });

  const totals = useMemo(() => ({
    normalMin: visibleRows.reduce((s, r) => s + r.result.normal_minutes, 0),
    premiumMin: visibleRows.reduce((s, r) => s + r.result.premium_minutes, 0),
    workedMin: visibleRows.reduce((s, r) => s + r.result.worked_minutes, 0),
    expectedMin: visibleRows.reduce((s, r) => s + r.result.expected_minutes, 0),
    heMin: visibleRows.reduce((s, r) => s + r.result.he_minutes, 0),
    faltaDays: visibleRows.reduce((s, r) => s + r.result.falta_days, 0),
    pendingDays: visibleRows.reduce((s, r) => s + r.result.pending_days, 0),
    salarioBase: visibleRows.reduce((s, r) => s + r.result.base_salary, 0),
    faltaDesc: visibleRows.reduce((s, r) => s + r.result.falta_desconto, 0),
    atrasoDesc: visibleRows.reduce((s, r) => s + r.result.atraso_desconto, 0),
    heVal: visibleRows.reduce((s, r) => s + r.result.he_value, 0),
    pagar: visibleRows.reduce((s, r) => s + r.result.gross_value, 0),
    liqMes: visibleRows.reduce((s, r) => s + r.result.net_value, 0),
    liqQ1: visibleRows.reduce((s, r) => s + r.q1.net_value, 0),
    liqQ2: visibleRows.reduce((s, r) => s + r.q2.net_value, 0),
  }), [visibleRows]);

  // Pendências de ponto (batida ímpar/1 batida) — dias a resolver antes de fechar.
  const pendencias = useMemo(
    () => visibleRows.flatMap(r => r.days
      .filter(d => d.punches.length >= 1 && d.punches.length % 2 === 1)
      .map(d => ({ empId: r.id, emp: r.name, date: d.date, dow: d.dow, punches: d.punches }))),
    [visibleRows],
  );

  // Formata saldo de banco (minutos, com sinal): +9h00 / −1h30 / 0h00.
  const fmtSaldo = (min: number) => {
    const abs = Math.abs(min);
    const sign = min > 0 ? '+' : min < 0 ? '−' : '';
    return `${sign}${Math.floor(abs / 60)}h${String(Math.round(abs % 60)).padStart(2, '0')}`;
  };

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
    const days = data.days.map(d => ({
      date: d.date, dayOfWeek: d.dayOfWeek, punches: d.punches,
      workedMinutes: d.workedMinutes, expectedMinutes: d.expectedMinutes,
      // status vem como string em EmployeeTimesheetData; valores reais são os
      // de DaySummary (mesma união de TimeMirrorDay).
      overtimeMinutes: d.overtimeMinutes, status: d.status as TimeMirrorDay['status'],
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
      bankHoursBalance: periodBankBalance?.get(row.id),
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
      if (scope === ALL) {
        // Folha comparativa: Mês × 1ª × 2ª quinzena + Situação (1 tabela, paisagem).
        printFolhaComparativo(
          visibleRows.map(r => ({ ext: r.ext, name: r.name, salary: r.result.base_salary, mes: r.result.net_value, q1: r.q1.net_value, q2: r.q2.net_value, sit: r.sit })),
          periodLabel,
          { lastDay: monthDays.length, totals: { salarios: totals.salarioBase, mes: totals.liqMes, q1: totals.liqQ1, q2: totals.liqQ2 } },
        );
      } else if (scopedRow) {
        // Demonstrativo individual completo (folha + faltas/atrasos + HE + jornada + adiantamentos).
        printEmployeeEvaluationDetailed([buildPrintData(scopedRow)], periodLabel, [scopedRow.advMes]);
      }
    } else if (tab === 'calendario') {
      if (scope === ALL) printCalendarReport(allData, periodLabel);
      else if (scopedRow) printIndividualCalendarReport(buildPrintData(scopedRow), periodLabel);
    } else if (tab === 'espelho') {
      if (scopedRow) printEspelho(scopedRow);
    }
  };

  // Baixa o .xlsx com Resumo + Detalhe dia a dia (respeita o escopo: 1 funcionário ou todos).
  const handleExport = () => {
    if (visibleRows.length === 0) return;
    exportFolhaExcel(
      visibleRows.map(r => ({
        ext: r.ext, name: r.name, data: buildPrintData(r),
        mes: r.result, q1: r.q1, q2: r.q2, advMes: r.advMes, sit: r.sit.txt,
      })),
      periodLabel,
      `Folha_${period}.xlsx`,
    );
  };

  const espelhoNeedsEmployee = tab === 'espelho' && scope === ALL;
  const noPrintTab = tab === 'banco' || tab === 'pendencias';
  const printDisabled = visibleRows.length === 0 || espelhoNeedsEmployee || noPrintTab;
  const printLabel = tab === 'ponto' ? 'Imprimir horas'
    : tab === 'pagamento' ? (scope === ALL ? 'Imprimir folha (comparativo)' : 'Imprimir demonstrativo')
    : tab === 'calendario' ? 'Imprimir calendário'
    : tab === 'espelho' ? 'Imprimir espelho'
    : 'Imprimir';

  // Atalhos de intervalo dentro do mês de referência.
  const q1Bounds = { from: `${period}-01`, to: `${period}-15` };
  const q2Bounds = { from: `${period}-16`, to: monthBounds.to };
  const rangeShortcut = (b: { from: string; to: string }, label: string) => (
    <Button
      type="button" variant="outline" size="sm"
      className={`h-9 px-2.5 text-xs ${range.from === b.from && range.to === b.to ? 'border-primary text-primary bg-primary/5' : ''}`}
      onClick={() => setRange(b)}
    >
      {label}
    </Button>
  );

  const Toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-32 h-9" title="Mês de referência" />
      {/* Intervalo de DIAS dentro do mês (De/Até) + atalhos. Default = mês inteiro. */}
      <div className="flex items-center gap-1">
        <Input type="date" value={range.from} min={monthBounds.from} max={range.to}
          onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="w-36 h-9" title="De" />
        <span className="text-xs text-muted-foreground">até</span>
        <Input type="date" value={range.to} min={range.from} max={monthBounds.to}
          onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="w-36 h-9" title="Até" />
      </div>
      {rangeShortcut(monthBounds, 'Mês')}
      {rangeShortcut(q1Bounds, '1ª quinz')}
      {rangeShortcut(q2Bounds, '2ª quinz')}
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
      <Button size="sm" variant="outline" className="h-9 gap-1.5 ml-auto" onClick={handleExport} disabled={visibleRows.length === 0}>
        <DownloadSimple className="h-4 w-4" /> Exportar Excel
      </Button>
      <Button size="sm" className="h-9 gap-1.5" onClick={handlePrint} disabled={printDisabled}>
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
          <strong>Motor único</strong> — todos os relatórios partem da MESMA base por-dia (batidas + escala). Pagamento =
          salário − descontos, hora extra e atraso POR DIA, sem compensar entre dias (valor-hora = salário ÷ {MONTHLY_HOURS_DIVISOR}).
          Banco/Espelho usam a mesma base, agregando HE no regime semanal CLT (44h), assinável.
        </span>
      </div>
      {CoverageBanner}

      {/* RESUMO/KPIs DO PERÍODO — sempre visível, vale pra todas as abas. Vem do
          motor único (mesma base da folha) pro escopo selecionado (1 ou todos). */}
      {visibleRows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { label: 'Funcionários', value: String(visibleRows.length) },
            { label: 'Trabalhadas', value: fmtH(totals.workedMin) },
            { label: 'Esperadas', value: fmtH(totals.expectedMin) },
            { label: 'Hora extra', value: totals.heMin > 0 ? fmtH(totals.heMin) : '—', amber: totals.heMin > 0 },
            { label: 'Faltas', value: String(totals.faltaDays), red: totals.faltaDays > 0 },
            { label: 'Líquido período', value: fmtBRL(totals.liqMes), accent: true },
          ].map(k => (
            <div key={k.label} className={`rounded-md border p-2.5 ${k.accent ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{k.label}</p>
              <p className={`tabular-nums font-bold ${k.accent ? 'text-base text-primary' : k.amber ? 'text-sm text-amber-700 dark:text-amber-400' : k.red ? 'text-sm text-red-700 dark:text-red-400' : 'text-sm'}`}>{k.value}</p>
            </div>
          ))}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'ponto', label: 'Horas', icon: Clock },
          { value: 'pagamento', label: 'Pagamento', icon: DollarSign },
          { value: 'calendario', label: 'Calendário', icon: Calendar },
          { value: 'espelho', label: 'Espelho (legal)', icon: IdentificationCard },
          { value: 'banco', label: 'Banco de Horas', icon: Scales },
          { value: 'pendencias', label: 'Pendências', icon: AlertTriangle },
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
                                          <TableCell className="text-xs font-mono">
                                            {editPunch && editPunch.empId === r.id && editPunch.date === d.date ? (
                                              <div className="flex items-center gap-1 font-sans">
                                                <Input
                                                  value={editPunch.value}
                                                  onChange={e => setEditPunch({ ...editPunch, value: e.target.value })}
                                                  className="h-7 text-xs font-mono w-52" placeholder="08:00 12:00 13:00 18:00" autoFocus
                                                  onKeyDown={e => {
                                                    if (e.key === 'Enter') saveEditedPunches(r.id, r.ext, r.name, d.date, editPunch.value);
                                                    if (e.key === 'Escape') setEditPunch(null);
                                                  }}
                                                />
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" disabled={savePunches.isPending}
                                                  onClick={() => saveEditedPunches(r.id, r.ext, r.name, d.date, editPunch.value)} title="Salvar">
                                                  <Check className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground"
                                                  onClick={() => setEditPunch(null)} title="Cancelar">
                                                  <XIcon className="h-3.5 w-3.5" />
                                                </Button>
                                              </div>
                                            ) : (
                                              <div className="flex items-center gap-2">
                                                <span className={d.punches.length % 2 !== 0 ? 'text-amber-700 dark:text-amber-400 font-semibold' : ''}>
                                                  {d.punches.map(cleanPunch).join(' · ')}
                                                </span>
                                                {d.punches.length % 2 !== 0 && (
                                                  <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-normal text-[10px] px-1">ímpar</Badge>
                                                )}
                                                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                                  onClick={() => setEditPunch({ empId: r.id, date: d.date, value: d.punches.map(cleanPunch).join(' ') })}
                                                  title="Editar batidas">
                                                  <PencilSimple className="h-3 w-3" />
                                                </Button>
                                              </div>
                                            )}
                                          </TableCell>
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
            <div className="space-y-3">
              {/* KPIs do período */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { label: 'Funcionários', value: String(visibleRows.length) },
                  { label: 'Salários', value: fmtBRL(totals.salarioBase) },
                  { label: isFullMonth ? 'Líquido Mês' : 'Líquido período', value: fmtBRL(totals.liqMes), accent: true },
                  { label: 'Líq. 1ª quinz', value: fmtBRL(totals.liqQ1) },
                  { label: 'Líq. 2ª quinz', value: fmtBRL(totals.liqQ2) },
                ].map(k => (
                  <div key={k.label} className={`rounded-md border p-2.5 ${k.accent ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'}`}>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{k.label}</p>
                    <p className={`tabular-nums font-bold ${k.accent ? 'text-base text-primary' : 'text-sm'}`}>{k.value}</p>
                  </div>
                ))}
              </div>

              {/* Aviso antes de pagar */}
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Antes de pagar:</strong> hora extra e atraso são contados <strong>por dia</strong> — cada dia que passou do esperado
                  paga HE ×1,5 e cada dia que ficou abaixo desconta atraso, <strong>sem compensar entre dias</strong>; fim de semana / feriado
                  trabalhado = tudo HE; falta = −1 dia. Os valores refletem o ponto <strong>como foi importado</strong> —
                  confira a coluna <strong>Situação</strong> e corrija o ponto antes de pagar.
                </span>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4" /> Folha {periodLabel} — Mês × 1ª × 2ª quinzena (líquido por funcionário)
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Mesmo motor da Folha (HE/atraso por dia), <strong>líquido já com adiantamentos pendentes descontados</strong>. Base da quinzena é
                    <strong> proporcional aos dias</strong> (1ª = 15/30, 2ª = {monthDays.length - 15}/30).
                    <strong> Imprimir</strong>: Todos → esta tabela; um funcionário selecionado → o demonstrativo individual completo.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Matríc.</TableHead>
                          <TableHead>Funcionário</TableHead>
                          <TableHead className="text-right">Salário</TableHead>
                          <TableHead className="text-right">{isFullMonth ? `Mês (01–${monthDays.length})` : 'Período'}</TableHead>
                          <TableHead className="text-right">1ª quinz (01–15)</TableHead>
                          <TableHead className="text-right">2ª quinz (16–{monthDays.length})</TableHead>
                          <TableHead>Situação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleRows.map(r => (
                          <TableRow key={r.id}>
                            <TableCell className="tabular-nums text-xs text-muted-foreground">{r.ext || '—'}</TableCell>
                            <TableCell className="font-medium">{r.name}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{fmtBRL(r.result.base_salary)}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{fmtBRL(r.result.net_value)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtBRL(r.q1.net_value)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtBRL(r.q2.net_value)}</TableCell>
                            <TableCell>
                              <Badge className={`font-normal ${r.sit.tone === 'green' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' : r.sit.tone === 'red' ? 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'}`}>
                                {r.sit.txt}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <tfoot>
                        <TableRow className="border-t-2 font-semibold bg-muted/30">
                          <TableCell />
                          <TableCell>Total ({visibleRows.length})</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{fmtBRL(totals.salarioBase)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtBRL(totals.liqMes)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtBRL(totals.liqQ1)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtBRL(totals.liqQ2)}</TableCell>
                          <TableCell />
                        </TableRow>
                      </tfoot>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>Nota:</strong> a base é proporcional aos dias do mês (salário × dias do período ÷ {monthDays.length}),
                então 1ª ({15}/{monthDays.length}) + 2ª ({monthDays.length - 15}/{monthDays.length}) = salário exato; o mês cheio paga o salário.
                O detalhe dia a dia de cada funcionário sai no <strong>demonstrativo individual</strong> (selecione um funcionário e clique Imprimir).
              </p>
            </div>
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

        {/* ── BANCO DE HORAS: saldo DO PERÍODO via motor único ── */}
        <TabsContent value="banco">
          {visibleRows.length === 0 ? Empty : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Scales className="h-4 w-4" /> Banco de horas — saldo do período ({periodLabel})
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Saldo do período pelo <strong>motor único</strong> (mesma base da folha; agregação semanal CLT).
                  <span className="text-emerald-700 dark:text-emerald-400"> Verde</span> = a favor do funcionário;
                  <span className="text-red-700 dark:text-red-400"> vermelho</span> = devendo.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Matríc.</TableHead>
                        <TableHead>Funcionário</TableHead>
                        <TableHead className="text-right">Saldo do período</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleRows.map(r => {
                        const bal = periodBankBalance?.get(r.id);
                        const tone = bal == null ? 'text-muted-foreground'
                          : bal > 0 ? 'text-emerald-700 dark:text-emerald-400'
                          : bal < 0 ? 'text-red-700 dark:text-red-400' : '';
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="tabular-nums text-xs text-muted-foreground">{r.ext || '—'}</TableCell>
                            <TableCell className="font-medium">{r.name}</TableCell>
                            <TableCell className={`text-right tabular-nums font-semibold ${tone}`}>
                              {bal == null ? '…' : fmtSaldo(bal)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── PENDÊNCIAS: dias com batida ímpar/inconsistente a resolver ── */}
        <TabsContent value="pendencias">
          {visibleRows.length === 0 ? Empty : pendencias.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Nenhuma pendência de ponto no período {scope === ALL ? '' : `de ${scopedRow?.name || ''}`}.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> Pendências de ponto ({pendencias.length}) — resolver antes de fechar a folha
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Dias com nº <strong>ímpar de batidas</strong> (faltou entrada/saída): não somam horas nem descontam — corrija o ponto na aba <strong>Ponto</strong>.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Funcionário</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Dia</TableHead>
                        <TableHead>Batidas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendencias.map((p, i) => (
                        <TableRow key={`${p.empId}-${p.date}-${i}`}>
                          <TableCell className="font-medium">{p.emp}</TableCell>
                          <TableCell className="tabular-nums text-xs">{fmtBR(p.date)}</TableCell>
                          <TableCell className="text-xs">{DAYS_PT[p.dow]}</TableCell>
                          <TableCell className="text-xs font-mono">
                            {p.punches.map(cleanPunch).join(' · ')}
                            <Badge className="ml-2 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-normal">
                              {p.punches.length} batida(s)
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

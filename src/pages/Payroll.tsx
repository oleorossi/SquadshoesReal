import { StatGridSkeleton, TableSkeleton } from '@/components/layout/PageSkeleton';
import { Fragment, useMemo, useState, useEffect } from 'react';
import { eSemanaFechada } from '@/hooks/useFichaProducaoPagamento';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CircleNotch as Loader2, CurrencyDollar as DollarSign, Calculator, CheckCircle as CheckCircle2, Receipt, Warning as AlertTriangle, Wallet, Clock, Printer, DownloadSimple, IdentificationCard, CalendarBlank, Paperclip, FilePdf, Package } from '@phosphor-icons/react';
import { printRhReport, type RhCell } from '@/lib/printRhReport';
import { useQuery } from '@tanstack/react-query';
import { useEmployees } from '@/hooks/useEmployees';
import { useHolidays, useSwapSets, useTimesheetCoverage, useWorkSchedules } from '@/hooks/useTimesheet';
import { usePayrollRuns, useUpsertPayrollRun, useUpdatePayrollStatus } from '@/hooks/useRH';
import { usePayrollPaymentSummaries } from '@/hooks/usePayrollPayments';
import { RegistrarPagamentoDialog } from '@/components/hr/RegistrarPagamentoDialog';
import { computePeriodFolha, getDaysInRange, type SalaryPayrollResult } from '@/lib/salaryPayroll';
import { computeComparativoRows } from '@/lib/payrollComparativo';
import { aggregateProducaoByMontador, fetchMontadorProducaoInRange } from '@/lib/montadorProduction';
import { fetchTimeRecordsInRange } from '@/lib/ponto/fetchTimeRecords';
import { expandAbsenceDatesByEmployee, resolveHolidaysForPayrollRange } from '@/lib/ponto/periodDates';
import { printTimeMirror, type TimeMirrorDay } from '@/lib/printTimeMirror';
import { exportFolhaExcel } from '@/lib/exportFolhaExcel';
import { printPayrollBundle, buildPayrollHtml, fmtDeltaMin } from '@/lib/printPayrollBundle';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import RelatorioFaltas from '@/components/hr/RelatorioFaltas';
import RelatorioAtrasos from '@/components/hr/RelatorioAtrasos';

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

/** Nº de dias corridos no intervalo (base proporcional da quinzena).
 *  Usa a getDaysInRange CANÔNICA (UTC) de salaryPayroll.ts — antes havia uma
 *  cópia local em horário local (fonte dupla de verdade). */
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

/** Atrasa `value` em `ms` — usado pra não refazer as queries a cada tecla na data. */
function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const STATUS_BADGES = {
  rascunho: { label: 'Rascunho', variant: 'secondary' as const },
  aprovado: { label: 'Aprovado', variant: 'default' as const },
  pago: { label: 'Pago', variant: 'outline' as const },
};

export default function Payroll({ reportsOnly = false }: { reportsOnly?: boolean } = {}) {
  const today = new Date();
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  // Período pago por INTERVALO de datas (paga quinzenal). Default = mês corrente inteiro.
  const [range, setRange] = useState(() => ({ from: `${defaultPeriod}-01`, to: lastDayOfMonth(defaultPeriod) }));
  const [calcRunning, setCalcRunning] = useState(false);
  const [detailRun, setDetailRun] = useState<string | null>(null);
  const [approveRun, setApproveRun] = useState<string | null>(null);
  const [payRun, setPayRun] = useState<string | null>(null);
  // Visão do Relatório consolidado: tabela (Folha) · calendário de tempo · holerites.
  const [view, setView] = useState<'folha' | 'calendario' | 'holerite'>('folha');
  const [calEmp, setCalEmp] = useState<string>('');
  // Filtro de setor (department) da view Folha — '' = todos.
  const [setorFilter, setSetorFilter] = useState<string>('all');
  // Multi-seleção de relatórios — imprime os marcados NUM ARQUIVO só.
  const [reportSel, setReportSel] = useState({ folha: false, calendario: true, holerite: true, setor: false, espelho: false });
  // Sub-visão da aba Relatórios (reportsOnly): documentos (folha/calendário/holerite/
  // espelho) · faltas (calendário só com dias faltados) · atrasos (idem, atrasos).
  const [reportView, setReportView] = useState<'docs' | 'faltas' | 'atrasos'>('docs');
  const [docScope, setDocScope] = useState<string>('all'); // 'all' ou employee_id
  const [previewIdx, setPreviewIdx] = useState(0); // paginador da prévia em "Todos" (calendário/holerite)

  // Intervalo APLICADO (debounced 450ms): enquanto o usuário digita a data, as queries,
  // o título e os avisos só recarregam DEPOIS que ele para de digitar — senão a página
  // "atualiza" a cada tecla (e a cada ano intermediário: 2 → 20 → 202 → 2026). A
  // digitação (range) e o CÁLCULO no clique continuam imediatos.
  const appliedFrom = useDebouncedValue(range.from, 450);
  const appliedTo = useDebouncedValue(range.to, 450);
  const appliedPeriod = useMemo(() => rangeToPeriod(appliedFrom, appliedTo), [appliedFrom, appliedTo]);
  const periodTitle = useMemo(() => periodLabel(appliedFrom, appliedTo), [appliedFrom, appliedTo]);
  const periodDays = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to]); // hint imediato (sem query)
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
  const { data: runs = [], isLoading } = usePayrollRuns(appliedPeriod);
  const { data: holidaysList = [] } = useHolidays();
  const upsertRun = useUpsertPayrollRun();
  const updateStatus = useUpdatePayrollStatus();

  // Feriados OBRIGATÓRIOS (optional !== true) → dia inteiro 1,5×.
  const holidaysSet = useMemo(
    () => resolveHolidaysForPayrollRange(holidaysList as any[], appliedFrom, appliedTo),
    [holidaysList, appliedFrom, appliedTo],
  );

  // Trocas de dia (compensação): dia flex — normal quando trabalhado, neutro quando não.
  const { swapWorkedSet, swapOffSet } = useSwapSets();

  // Cobertura: até onde o ponto foi importado neste período (debounced, igual às queries).
  const { data: coverage } = useTimesheetCoverage(appliedFrom, appliedTo);

  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  // Resumo de pagamentos por folha (pago/parcial + recibo anexado) das runs visíveis.
  const runIds = useMemo(() => runs.map(r => r.id), [runs]);
  const { data: paySummaries = {} } = usePayrollPaymentSummaries(runIds);

  const totals = useMemo(() => {
    const proventos = runs.reduce((s, r) => s + (r.total_proventos || 0), 0);
    const descontos = runs.reduce((s, r) => s + ((r.absence_discount || 0) + (r.deductions_amount || 0)), 0);
    const advances = runs.reduce((s, r) => s + (r.advances_total || 0), 0);
    const liquido = runs.reduce((s, r) => s + (r.total_liquido || 0), 0);
    const advancesCount = runs.filter(r => (r.advances_total || 0) > 0).length;
    return { proventos, descontos, advances, liquido, advancesCount };
  }, [runs]);

  // Setor de uma run = department do funcionário (fallback "Sem setor").
  const setorOf = (employee_id: string) =>
    (employeeMap.get(employee_id) as any)?.department?.trim() || 'Sem setor';

  // Setores presentes na folha do período (pro filtro).
  const setoresDisponiveis = useMemo(() => {
    const s = new Set<string>();
    for (const r of runs) s.add(setorOf(r.employee_id));
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, employeeMap]);

  // Folha agrupada por setor + subtotais (Proventos/Descontos/Adiant./Líquido).
  // Respeita o filtro de setor. Ordenada alfabeticamente.
  const folhaGroups = useMemo(() => {
    const map = new Map<string, typeof runs>();
    for (const r of runs) {
      const dep = setorOf(r.employee_id);
      if (setorFilter !== 'all' && dep !== setorFilter) continue;
      if (!map.has(dep)) map.set(dep, []);
      map.get(dep)!.push(r);
    }
    return Array.from(map.entries())
      .map(([setor, rs]) => ({
        setor,
        runs: rs,
        proventos: rs.reduce((s, r) => s + (r.total_proventos || 0), 0),
        descontos: rs.reduce((s, r) => s + ((r.absence_discount || 0) + (r.deductions_amount || 0)), 0),
        advances: rs.reduce((s, r) => s + (r.advances_total || 0), 0),
        liquido: rs.reduce((s, r) => s + (r.total_liquido || 0), 0),
      }))
      .sort((a, b) => a.setor.localeCompare(b.setor, 'pt-BR'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, employeeMap, setorFilter]);

  // ── Comparativo Mês × 1ª × 2ª (pra IMPRIMIR / EXPORTAR a folha) ──────────────
  // Mesma fórmula da folha (computePeriodFolha) via lib compartilhada. Antes vivia
  // na aba Relatórios → Pagamento; consolidado aqui (2026-06-21).
  const compPeriod = useMemo(() => (appliedFrom || '').slice(0, 7), [appliedFrom]);
  const { data: compRecords = [] } = useQuery({
    queryKey: ['payroll-comp-records', appliedFrom, appliedTo],
    enabled: !!(appliedFrom && appliedTo),
    staleTime: 60_000,
    // PAGINADO via helper único (fetchTimeRecordsInRange) — antes esta query NÃO
    // paginava e o cap de 1000 do PostgREST cortava dias, fazendo o calendário
    // mostrar "falta" em dias que TINHAM ponto (bug 2026-07-01). Agora usa a
    // MESMA fonte da folha/atrasos → motores sincronizados.
    queryFn: () => fetchTimeRecordsInRange(appliedFrom, appliedTo),
  });
  const { data: compAdvances = [] } = useQuery({
    queryKey: ['payroll-comp-advances', appliedFrom, appliedTo],
    enabled: !!(appliedFrom && appliedTo),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_advances')
        .select('employee_id, amount, advance_date, status, payroll_run_id')
        .gte('advance_date', appliedFrom).lte('advance_date', appliedTo)
        // Mesmo critério de calculateAll (~:565): as DUAS condições, não uma OU outra.
        // Com `.or(...)` entrava vale já pago (status≠pending) e vale já amarrado a
        // outra folha (payroll_run_id preenchido) — o comparativo/Excel mostrava líquido
        // diferente da folha gravada. Ex.: vale de R$ 500 pending já vinculado a uma run
        // anterior → folha R$ 2.200, comparativo R$ 1.700 (D18, auditoria 2026-07-29).
        .is('payroll_run_id', null)
        .eq('status', 'pending');
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  // Produção por par (Ficha de Montadores) do período — alimenta o regime 'producao'
  // no comparativo (mês/quinzena). Só linhas 'chamada'; R$/par snapshot da linha.
  const { data: compProducao = [] } = useQuery({
    queryKey: ['payroll-comp-producao', appliedFrom, appliedTo],
    enabled: !!(appliedFrom && appliedTo),
    staleTime: 60_000,
    queryFn: async () => {
      return fetchMontadorProducaoInRange(appliedFrom, appliedTo);
    },
  });
  const comparativo = useMemo(() => computeComparativoRows({
    employees, schedules, defaultSchedule, holidaysSet, swapWorkedSet, swapOffSet,
    timeRecords: compRecords, advancesList: compAdvances, producaoRows: compProducao,
    range: { from: appliedFrom, to: appliedTo }, period: compPeriod,
    maxCovered: coverage?.maxCovered || null,
  }), [employees, schedules, defaultSchedule, holidaysSet, swapWorkedSet, swapOffSet, compRecords, compAdvances, compProducao, appliedFrom, appliedTo, compPeriod, coverage]);

  /** Detalhe de PRODUÇÃO por funcionário (dias produtivos, fichas, pares) para
   *  quem é regime por par. Sai do comparativo, que roda exatamente na mesma
   *  janela de `runs` (ambos em appliedFrom..appliedTo) — por isso os números da
   *  tela batem com os do PDF sem recalcular nada aqui.
   *
   *  A tabela guarda só o dinheiro (payroll_runs); pares e dias produtivos não
   *  têm coluna própria lá. Sem este mapa, a linha de quem é por par mostrava o
   *  bruto embaixo do rótulo "Salário" e mais nada — parecia mensalista. */
  const porParByEmp = useMemo(() => {
    const m = new Map<string, SalaryPayrollResult>();
    for (const r of comparativo.rows) {
      if (r.result?.payment_type === 'producao') m.set(r.id, r.result);
    }
    return m;
  }, [comparativo]);

  const handleExportExcel = () => {
    if (comparativo.rows.length === 0) { toast.error('Nada pra exportar.'); return; }
    exportFolhaExcel(
      comparativo.rows.map(r => ({ ext: r.ext, name: r.name, data: r.printData, mes: r.result, q1: r.q1, q2: r.q2, advMes: r.advMes, sit: r.sit.txt })),
      periodTitle,
      `Folha_${compPeriod}.xlsx`,
    );
  };

  // Funcionários do período no shape do bundle (run financeiro + dias do
  // calendário). Fonte única pra prévia E impressão.
  const bundleEmps = useMemo(() => runs.map(r => {
    const emp = employeeMap.get(r.employee_id);
    const crow = comparativo.rows.find(cr => cr.id === r.employee_id) as any;
    // Regime por par: o bundle recebe a produção junto do run financeiro. Sem
    // isso, o holerite IMPRESSO descrevia o bruto como "Salário base" e exibia
    // "trabalhado 0h · valor-hora R$ 0,00" — o mesmo defeito que a tela já não
    // tem. O bruto separado por dificuldade vem do comparativo (mesma janela
    // dos runs), não de rateio.
    const pp = porParByEmp.get(r.employee_id);
    return {
      id: r.employee_id,
      name: emp?.name || (r as any).employee_name || '—',
      role: (emp as any)?.role, department: (emp as any)?.department,
      run: (pp ? {
        ...r,
        por_par: true,
        dias_produtivos: Number(pp.paid_days) || 0,
        fichas: Number(pp.fichas) || 0,
        fichas_derivadas: !!pp.fichas_derivadas,
        pares_medio: Number(pp.pares_medio) || 0,
        pares_dificil: Number(pp.pares_dificil) || 0,
        bruto_medio: Number(pp.bruto_medio) || 0,
        bruto_dificil: Number(pp.bruto_dificil) || 0,
        taxa_medio: Number(pp.taxa_medio) || 0,
        taxa_dificil: Number(pp.taxa_dificil) || 0,
        taxa_variou: !!pp.taxa_variou,
      } : r) as any,
      days: (crow?.printData?.days || []) as any[],
    };
  }), [runs, employeeMap, comparativo.rows, porParByEmp]);

  // Espelho relógio de ponto: registro BRUTO das batidas importadas, agrupado por
  // matrícula (employee_external_id). Independe da folha calculada — usa direto o
  // compRecords (time_records do período), pra conferência do arquivo do relógio.
  const espelhoEmps = useMemo(() => {
    const norm = (s: string) => String(s ?? '').toLowerCase().trim();
    // Casa uma matrícula/nome do relógio com um funcionário CADASTRADO e ATIVO —
    // mesmo critério dos outros relatórios (matrícula, com external_id possivelmente
    // separado por vírgula, OU nome normalizado). Retorna o funcionário ou undefined.
    const matchEmployee = (extId: string, name: string) =>
      (employees as any[]).find(e => {
        if ((e as any).active === false) return false;
        const eExt = String((e as any).external_id ?? '').split(',').map(x => x.trim()).filter(Boolean);
        if (extId && eExt.includes(extId)) return true;
        return norm((e as any).name) === norm(name);
      });

    type EspGroup = { id: string; name: string; role?: string; department?: string; matchId?: string; rawDays: { date: string; punches: string[] }[] };
    const byExt = new Map<string, EspGroup>();
    for (const rec of (compRecords as any[])) {
      const ext = String(rec.employee_external_id ?? rec.employee_name ?? '—');
      const g = byExt.get(ext) || { id: ext, name: rec.employee_name || '—', rawDays: [] };
      g.rawDays.push({ date: rec.record_date, punches: Array.isArray(rec.punches) ? rec.punches : [] });
      byExt.set(ext, g);
    }
    const out: EspGroup[] = [];
    for (const g of byExt.values()) {
      const emp = matchEmployee(g.id, g.name);
      // Só entra no espelho quem é funcionário cadastrado — igual aos outros
      // relatórios. Usuário do relógio sem cadastro (ex.: "alex · matrícula 18")
      // fica de fora, mesmo tendo batido no ponto.
      if (!emp) continue;
      // matchId = id INTERNO do funcionário (mesmo de bundleEmps) — casa o Espelho
      // com o pacote da folha no modo por-funcionário do buildPayrollHtml.
      g.role = (emp as any).role; g.department = (emp as any).department; g.matchId = (emp as any).id;
      g.rawDays.sort((a, b) => a.date.localeCompare(b.date));
      out.push(g);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [compRecords, employees]);

  // Escopo do Espelho (Todos / um funcionário) — casa o employee_id escolhido com
  // a matrícula (external_id) do registro bruto.
  const scopedEspelho = useMemo(() => {
    if (!reportSel.espelho) return [];
    if (docScope === 'all') return espelhoEmps;
    // docScope = id interno do funcionário. matchId agora está sempre preenchido
    // (todo grupo do espelho é um funcionário cadastrado), então casa direto por ele.
    return espelhoEmps.filter(e => e.matchId === docScope);
  }, [reportSel.espelho, docScope, espelhoEmps]);

  // Documentos POR FUNCIONÁRIO (1 por pessoa) × RELATÓRIOS GERAIS (1 do período).
  const hasPerEmp = reportSel.calendario || reportSel.holerite;
  const hasAgg = reportSel.folha || reportSel.setor;
  const anySel = hasPerEmp || hasAgg || reportSel.espelho;
  // Funcionários do escopo (Todos ou um).
  const scopeEmps = useMemo(
    () => (docScope === 'all' ? bundleEmps : bundleEmps.filter(e => e.id === docScope)),
    [docScope, bundleEmps],
  );
  // Prévia pagina por funcionário quando há doc por-funcionário e mais de um no escopo.
  const previewPaged = hasPerEmp && scopeEmps.length > 1;

  // Funcionários + docs exibidos na PRÉVIA. Paginando: 1 funcionário por vez,
  // só os docs por-funcionário (Calendário/Holerite). Senão: o escopo inteiro
  // com os docs selecionados.
  const previewEmps = useMemo(() => {
    if (!anySel || scopeEmps.length === 0) return [];
    if (previewPaged) return [scopeEmps[Math.min(previewIdx, scopeEmps.length - 1)]];
    return scopeEmps;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anySel, scopeEmps, previewPaged, previewIdx]);

  const previewHtml = useMemo(() => {
    // Paginando (vários funcionários): mostra o funcionário da vez COM o Espelho
    // DELE (casa por matchId) — a prévia reflete o pacote por-funcionário do
    // print. Sem paginar: o escopo inteiro.
    const espList = !reportSel.espelho
      ? []
      : previewPaged
        ? scopedEspelho.filter((x: any) => x.matchId === previewEmps[0]?.id)
        : scopedEspelho;
    if (previewEmps.length === 0 && espList.length === 0) return '';
    const docs = previewPaged
      ? { folha: false, setor: false, calendario: reportSel.calendario, holerite: reportSel.holerite, espelho: reportSel.espelho }
      : reportSel;
    return buildPayrollHtml({ periodTitle, docs, employees: previewEmps as any, espelhoEmployees: espList as any, autoPrint: false, groupBy: 'employee' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewEmps, previewPaged, reportSel, periodTitle, scopedEspelho]);

  // Reseta o paginador quando muda a seleção/escopo.
  useEffect(() => { setPreviewIdx(0); }, [reportSel, docScope]);

  const toggleAllReports = (on: boolean) =>
    setReportSel({ folha: on, calendario: on, holerite: on, setor: on, espelho: on });
  const allReportsOn = reportSel.folha && reportSel.calendario && reportSel.holerite && reportSel.setor && reportSel.espelho;

  // Imprime os documentos marcados NUM ARQUIVO só, funcionário-a-funcionário
  // (Folha/Setor 1× no topo; Calendário+Holerite agrupados por pessoa).
  const handleGenerateReport = () => {
    if (!anySel) { toast.error('Marque ao menos um relatório.'); return; }
    const espelhoOnly = reportSel.espelho && !hasPerEmp && !hasAgg;
    if (scopeEmps.length === 0 && !(reportSel.espelho && scopedEspelho.length > 0)) {
      toast.error(espelhoOnly ? 'Nenhuma batida importada no período pra conferir.' : 'Nada pra gerar — calcule a folha do período primeiro.');
      return;
    }
    printPayrollBundle({ periodTitle, docs: reportSel, employees: scopeEmps as any, espelhoEmployees: scopedEspelho as any, groupBy: 'employee' });
  };

  // Banco de horas REMOVIDO (reforma 2026-07-09): o Espelho não mostra mais saldo
  // de banco — passa a exibir realizado × esperado do período.

  // Gerar PDF da FOLHA — tabela única de TODOS os funcionários com VALORES e HORAS
  // (salário, HE, faltas, atrasos, líquido + horas trabalhadas/extra), do mesmo motor
  // (computePeriodFolha via comparativo.rows). Respeita o filtro de setor da tela.
  const handlePrintFolhaPdf = () => {
    const fmtHm = (min: number) => {
      const m = Math.round(Number(min) || 0);
      if (m <= 0) return '—';
      const h = Math.floor(m / 60), mm = m % 60;
      return mm === 0 ? `${h}h` : h === 0 ? `${mm}min` : `${h}h${String(mm).padStart(2, '0')}`;
    };
    const dfmt = (iso: string) => (iso || '').split('-').reverse().join('/');
    const now = new Date();
    const generatedAt = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    const src = comparativo.rows.filter(r => setorFilter === 'all' || setorOf(r.id) === setorFilter);
    if (src.length === 0) { toast.error('Nenhum funcionário na folha do período.'); return; }

    // Duas formas de pagar, dois blocos: quem é medido pelo RELÓGIO DE PONTO
    // (mensalista/remoto/diarista) e quem é pago POR PAR, cujos números vêm da
    // Ficha de Montadores e não do ponto. Numa tabela só, cada linha teria metade
    // das colunas em "—". Bloco sem ninguém não é impresso.
    const isPorPar = (r: { result: SalaryPayrollResult }) => r.result?.payment_type === 'producao';
    const srcPonto = src.filter(r => !isPorPar(r));
    const srcPorPar = src.filter(r => isPorPar(r));

    let tSal = 0, tHe = 0, tFalta = 0, tAtraso = 0, tLiqPonto = 0, tWork = 0, tHeMin = 0;
    const rowsPonto = srcPonto.map((r): RhCell[] => {
      const res = r.result;
      // `base_salary` é o salário MENSAL cheio (referência p/ valor-dia/valor-hora);
      // o provento do período é `period_base` (= total_proventos − he_value). Sob o
      // rótulo "Salário do período" o mensal saía ~2× numa folha quinzenal e o bloco
      // não fechava com o Líquido. A tela já faz essa distinção (linha ~1453).
      const sal = Number(res.period_base) || 0, he = Number(res.he_value) || 0;
      const falta = Number(res.falta_desconto) || 0, atraso = Number(res.atraso_desconto) || 0;
      tSal += sal; tHe += he; tFalta += falta; tAtraso += atraso;
      tLiqPonto += Number(res.net_value) || 0; tWork += Number(res.worked_minutes) || 0; tHeMin += Number(res.he_minutes) || 0;
      return [
        { v: r.name },
        { v: setorOf(r.id) || '—' },
        { v: String(res.paid_days ?? 0), align: 'r' },
        { v: fmtHm(res.worked_minutes), align: 'r' },
        { v: fmtHm(res.he_minutes), align: 'r' },
        { v: fmt(sal), align: 'r' },
        { v: he > 0 ? fmt(he) : '—', align: 'r' },
        { v: falta > 0 ? `− ${fmt(falta)}` : '—', align: 'r', neg: falta > 0 },
        { v: atraso > 0 ? `− ${fmt(atraso)}` : '—', align: 'r', neg: atraso > 0 },
        { v: fmt(Number(res.net_value) || 0), align: 'r', strong: true },
      ];
    });

    let tDias = 0, tFichas = 0, tPMed = 0, tPDif = 0, tBruto = 0, tVale = 0, tLiqPar = 0;
    let algumaFichaDerivada = false;
    let algumaTaxaVariou = false;
    const rowsPorPar = srcPorPar.map((r): RhCell[] => {
      const res = r.result;
      const dias = Number(res.paid_days) || 0;
      const fichas = Number(res.fichas) || 0;
      const pMed = Number(res.pares_medio) || 0, pDif = Number(res.pares_dificil) || 0;
      const bruto = Number(res.total_proventos) || 0, vale = Number(res.advances_total) || 0;
      if (res.fichas_derivadas) algumaFichaDerivada = true;
      if (res.taxa_variou) algumaTaxaVariou = true;
      tDias += dias; tFichas += fichas; tPMed += pMed; tPDif += pDif;
      tBruto += bruto; tVale += vale; tLiqPar += Number(res.net_value) || 0;
      // A taxa vai COLADA nos pares que ela multiplica ("2.364 × 0,80"), e não
      // numa coluna "R$/par" solta. Duas razões: médio e difícil têm taxas
      // diferentes (uma coluna só teria de misturar as duas num número que não é
      // taxa de nenhum dos dois), e assim o conferente refaz a conta na própria
      // folha — pares × taxa tem de dar a coluna Produção.
      const marca = res.taxa_variou ? '†' : '';
      const cel = (pares: number, taxa: number) =>
        pares > 0 ? `${pares.toLocaleString('pt-BR')} × ${fmt(taxa)}${marca}` : '—';
      return [
        { v: r.name },
        { v: setorOf(r.id) || '—' },
        { v: String(dias), align: 'r' },
        { v: fichas > 0 ? `${fichas}${res.fichas_derivadas ? ' *' : ''}` : '—', align: 'r' },
        { v: cel(pMed, Number(res.taxa_medio) || 0), align: 'r' },
        { v: cel(pDif, Number(res.taxa_dificil) || 0), align: 'r' },
        { v: fmt(bruto), align: 'r' },
        { v: vale > 0 ? `− ${fmt(vale)}` : '—', align: 'r', neg: vale > 0 },
        { v: fmt(Number(res.net_value) || 0), align: 'r', strong: true },
      ];
    });

    const notas = [
      srcPonto.length > 0 ? 'Faltas e atrasos conforme dias úteis e jornada da escala · H.E. conforme taxa cadastrada.' : '',
      srcPorPar.length > 0 ? 'Por par: cada lançamento vale o R$/par gravado nele — o relógio de ponto não entra na conta. Pares × R$/par deve fechar com a coluna Produção.' : '',
      algumaFichaDerivada ? '* Fichas inferidas (lote de 12): o lançamento é anterior ao registro de tamanho. Os PARES, que são a base do pagamento, não dependem disso.' : '',
      algumaTaxaVariou ? '† O R$/par mudou dentro do período (reajuste): a taxa exibida é a média das gravadas em cada lançamento. A coluna Produção continua exata.' : '',
    ].filter(Boolean).join(' ');

    printRhReport({
      title: 'Folha — Relatório por Funcionário',
      subtitle: setorFilter !== 'all' ? `Setor: ${setorFilter}` : 'Todos os setores',
      periodo: `${dfmt(appliedFrom)} – ${dfmt(appliedTo)}`,
      generatedAt,
      kpis: [
        { label: 'Funcionários', value: String(rowsPonto.length + rowsPorPar.length) },
        { label: 'Horas trab.', value: fmtHm(tWork) },
        { label: 'Pares produzidos', value: (tPMed + tPDif).toLocaleString('pt-BR') },
        { label: 'Proventos', value: fmt(tSal + tHe + tBruto) },
        { label: 'Descontos', value: fmt(tFalta + tAtraso + tVale) },
        { label: 'Líquido', value: fmt(tLiqPonto + tLiqPar) },
      ],
      sections: [
        {
          title: 'Mensalistas, remotos e diaristas · pelo relógio de ponto',
          note: 'Salário do período, ajustado por faltas, atrasos e horas extras medidos contra a escala.',
          headers: [
            { label: 'Funcionário' }, { label: 'Setor' }, { label: 'Dias', align: 'r' },
            { label: 'H. trab.', align: 'r' }, { label: 'H. extra', align: 'r' },
            { label: 'Salário', align: 'r' }, { label: 'H.E. (R$)', align: 'r' },
            { label: 'Faltas', align: 'r' }, { label: 'Atrasos', align: 'r' }, { label: 'Líquido', align: 'r' },
          ],
          rows: rowsPonto,
          totals: [
            { v: `Subtotal · ${rowsPonto.length} func.`, strong: true },
            { v: '' }, { v: '', align: 'r' },
            { v: fmtHm(tWork), align: 'r', strong: true },
            { v: fmtHm(tHeMin), align: 'r', strong: true },
            { v: fmt(tSal), align: 'r', strong: true },
            { v: fmt(tHe), align: 'r', strong: true },
            { v: `− ${fmt(tFalta)}`, align: 'r', neg: true, strong: true },
            { v: `− ${fmt(tAtraso)}`, align: 'r', neg: true, strong: true },
            { v: fmt(tLiqPonto), align: 'r', strong: true },
          ],
        },
        {
          title: 'Por par · Ficha de Montadores',
          note: 'Pares apontados no período, valorados pelo R$/par gravado em cada lançamento. Dias = dias produtivos (com pares lançados), não dias de ponto.',
          headers: [
            { label: 'Funcionário' }, { label: 'Setor' }, { label: 'Dias prod.', align: 'r' },
            { label: 'Fichas', align: 'r' },
            { label: 'Pares méd × R$', align: 'r' }, { label: 'Pares dif × R$', align: 'r' },
            { label: 'Produção', align: 'r' },
            { label: 'Adiant.', align: 'r' }, { label: 'Líquido', align: 'r' },
          ],
          rows: rowsPorPar,
          totals: [
            { v: `Subtotal · ${rowsPorPar.length} func.`, strong: true },
            { v: '' },
            { v: String(tDias), align: 'r', strong: true },
            { v: String(tFichas), align: 'r', strong: true },
            { v: `${tPMed.toLocaleString('pt-BR')} pares`, align: 'r', strong: true },
            { v: tPDif > 0 ? `${tPDif.toLocaleString('pt-BR')} pares` : '—', align: 'r', strong: true },
            { v: fmt(tBruto), align: 'r', strong: true },
            { v: `− ${fmt(tVale)}`, align: 'r', neg: true, strong: true },
            { v: fmt(tLiqPar), align: 'r', strong: true },
          ],
        },
      ],
      grandTotal: {
        label: `Total geral · ${rowsPonto.length + rowsPorPar.length} funcionário(s)`,
        value: fmt(tLiqPonto + tLiqPar),
      },
      footNote: notas,
    });
  };

  // Espelho de ponto legal (Portaria MTP 671) — documento individual assinável com
  // batidas dia a dia, totais e saldo de banco. Usa o ponto do período selecionado
  // (escolha "Mês" pro espelho mensal). Reusa o printData já calculado pelo comparativo.
  const printEspelho = (empId: string) => {
    const row = comparativo.rows.find(r => r.id === empId);
    const emp = employeeMap.get(empId);
    if (!row || !emp) { toast.error('Sem dados de ponto pra gerar o espelho deste funcionário.'); return; }
    const days: TimeMirrorDay[] = row.printData.days.map((d: any) => ({
      date: d.date, dayOfWeek: d.dayOfWeek, punches: d.punches,
      workedMinutes: d.workedMinutes, expectedMinutes: d.expectedMinutes,
      overtimeMinutes: d.overtimeMinutes, status: d.status as TimeMirrorDay['status'],
      notes: d.isHoliday ? 'FERIADO' : '',
    }));
    printTimeMirror({
      employee: {
        name: emp.name,
        external_id: (emp as any).external_id,
        role: (emp as any).role,
        department: (emp as any).department,
        cpf: (emp as any).cpf,
        pis: (emp as any).pis,
        admission_date: (emp as any).admission_date,
      },
      company: { name: (typeof window !== 'undefined' && (window as any).COMPANY_NAME) || 'Empresa' },
      period: compPeriod,
      days,
      // Por par: NÃO alimentar o espelho com o salário do cadastro. O espelho usa
      // salário÷220×1,5 pra estimar o "Valor HE" — e quem é pago por par não
      // recebe hora extra nenhuma. Com o salário preenchido, o documento LEGAL
      // exibia um valor de HE que não será pago. Sem ele, o campo sai "—" e o
      // espelho fica sendo o que deve ser aqui: registro de presença.
      monthlySalary: porParByEmp.has(empId) ? 0 : Number((emp as any).salary) || 0,
    });
  };

  async function calculateAll() {
    // Usa o intervalo IMEDIATO (o que está nos inputs agora), não o debounced.
    const cFrom = range.from, cTo = range.to;
    if (!cFrom || !cTo || cFrom > cTo) {
      toast.error('Selecione um intervalo de datas válido para calcular a folha.');
      return;
    }
    const cPeriod = rangeToPeriod(cFrom, cTo);
    // Mês cheio paga salário (30 avos); período parcial (quinzena) = proporcional aos dias.
    let cBaseDays = /^\d{4}-\d{2}$/.test(cPeriod) ? undefined : daysBetween(cFrom, cTo);
    // Dias do mês p/ a base proporcional da quinzena: 1ª(15) + 2ª(mês−15) = salário EXATO
    // (sem pagar 1 dia a mais num mês de 31). Mês cheio ignora (cBaseDays undefined).
    const cMonthDays = daysBetween(`${cFrom.slice(0, 7)}-01`, lastDayOfMonth(cFrom.slice(0, 7)));
    // Guard cross-month: cMonthDays é só do mês de cFrom; um intervalo manual que
    // CRUZA meses faria base = salário × dias ÷ diasDoMêsDeFrom passar de 1 salário
    // (ex.: 01/05–20/06 = 51/31 = 1,65×). Os atalhos (1ª/2ª/Mês) ficam sempre num
    // mês só. Capamos a base em ≤ 1 salário e avisamos pra preferir os atalhos.
    if (cBaseDays !== undefined && cFrom.slice(0, 7) !== cTo.slice(0, 7)) {
      cBaseDays = Math.min(cBaseDays, cMonthDays);
      toast.warning('Intervalo cruza meses: a base é aproximada (capada em 1 salário). Para base exata, use os atalhos 1ª/2ª quinzena ou Mês.');
    }
    setCalcRunning(true);
    try {
      const calculationHolidays = resolveHolidaysForPayrollRange(holidaysList as any[], cFrom, cTo);
      // Clamp à cobertura: dias após a última data importada NÃO entram (evita contar
      // como falta quem ainda não teve o ponto baixado). Folha fica "parcial" até importar.
      const maxCov = coverage?.maxCovered || null;
      const clamped = !!(maxCov && maxCov < cTo);

      // Batidas do período. time_records não tem FK pra employees — casa por
      // matrícula (employee_external_id) ou nome.
      // Paginado: o cap default de 1000 rows do PostgREST cortava dias do fim
      // do período silenciosamente → dia sem ponto = falta descontada errada.
      // Fonte ÚNICA paginada (mesma do comparativo/calendário e do relatório de
      // atrasos) — motores do RH sincronizados.
      const timeRecords = await fetchTimeRecordsInRange(cFrom, cTo);

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
      const { data: advances, error: advancesError } = await supabase
        .from('employee_advances')
        .select('employee_id, amount, advance_date, status, payroll_run_id')
        .gte('advance_date', cFrom)
        .lte('advance_date', cTo)
        .is('payroll_run_id', null)
        .eq('status', 'pending');
      if (advancesError) throw advancesError;
      const advancesByEmp = new Map<string, number>();
      for (const a of (advances || []) as any[]) {
        advancesByEmp.set(a.employee_id, (advancesByEmp.get(a.employee_id) || 0) + Number(a.amount || 0));
      }

      // B4 (auditoria 2026-06-29): ausências JUSTIFICADAS (férias/atestado/licença)
      // no período → dias abonados (não descontam falta). Expande [start,end]∩[período].
      const { data: absences, error: absencesError } = await supabase
        .from('employee_absences')
        .select('employee_id, start_date, end_date')
        .lte('start_date', cTo)
        .gte('end_date', cFrom);
      if (absencesError) throw absencesError;
      const absencesByEmp = expandAbsenceDatesByEmployee((absences || []) as any[], cFrom, cTo);

      // Produção por par (Ficha de Montadores) do período — base do regime 'producao'
      // (Σ pares × R$/par snapshot de cada apontamento). Ignora salário/ponto.
      const producaoByEmp = aggregateProducaoByMontador(await fetchMontadorProducaoInRange(cFrom, cTo));

      let calculated = 0;
      let withIncomplete = 0;
      let skippedPorPar = 0;
      let sharedMatricula = 0;
      let withMissingHeRate = 0;  // HE em minutos mas taxa R$/h não cadastrada → HE R$0
      // Todos os regimes passam pelo MESMO motor (computePeriodFolha honra
      // payment_type): mensalista (salário − descontos por dia), remoto (salário
      // cheio, ignora ponto) e diarista (diária × dias trabalhados). (2026-06-19)
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

        const regime = String((emp as any).payment_type || 'mensalista').toLowerCase() as 'mensalista' | 'remoto' | 'diarista' | 'producao';

        // POR PAR É SEMANAL. Gerar a folha de um montador para o mês inteiro faz
        // a aprovação reivindicar julho todo de uma vez — e aí a trava de
        // sobreposição recusa, com razão, cada semanal daquele intervalo. O banco
        // barra isso (tg_payroll_producao_semana_fechada); aqui a gente evita o
        // erro cru e explica onde se paga. Os demais regimes seguem normalmente:
        // pular um montador não pode impedir a folha dos 17 mensalistas.
        if (regime === 'producao' && !eSemanaFechada(cFrom, cTo)) {
          skippedPorPar++;
          continue;
        }

        const prod = producaoByEmp.get(emp.id);

        // MESMO motor da tela do Ponto (computePeriodFolha): monta os dias da escala +
        // batidas e calcula a folha líquida, com clamp pela cobertura.
        const result = computePeriodFolha({
          salary: Number(emp.salary) || 0,
          from: cFrom, to: cTo,
          schedule: sch,
          holidaysSet: calculationHolidays,
          swapWorkedSet,
          swapOffSet,
          punchesByDate: empPunches,
          absenceDates: absencesByEmp.get(emp.id),
          advancesTotal: advancesByEmp.get(emp.id) || 0,
          activeFrom: (emp as any).admission_date || null,   // não descontar dias antes da admissão
          activeTo: (emp as any).termination_date || null,   // nem depois da demissão
          coveredDates: coverage?.coveredDates,              // falta só em dia lido pelo relógio (lacuna no meio ≠ falta)
          periodDays: cBaseDays,   // mês cheio = salário (undefined); quinzena = proporcional
          monthDays: cMonthDays,   // 1ª+2ª quinzena somam o salário exato (sem dia a mais)
          maxCoveredDate: maxCov,
          payRegime: regime,
          dailyRate: Number((emp as any).daily_rate) || 0,
          // Produção por par (regime 'producao') — bruto já valorado pelo snapshot.
          producaoBruto: prod?.bruto || 0,
          producaoParesMedio: prod?.paresMedio || 0,
          producaoParesDificil: prod?.paresDificil || 0,
          producaoDias: prod?.dias || 0,
          producaoFichas: prod?.fichas || 0,
          producaoFichasDerivadas: prod?.fichasDerivadas || false,
          producaoBrutoMedio: prod?.brutoMedio || 0,
          producaoBrutoDificil: prod?.brutoDificil || 0,
          producaoTaxaMedio: prod?.taxaMedio || 0,
          producaoTaxaDificil: prod?.taxaDificil || 0,
          producaoTaxaVariou: prod?.taxaVariou || false,
          // HE em R$/h ABSOLUTO por funcionário (spec 2026-07-09) — dia útil/sábado/noturno
          // e domingo/feriado. Falta/atraso passam a usar dias úteis do mês (motor).
          heNormalRate: Number((emp as any).he_normal_rate) || 0,
          heSundayHolidayRate: Number((emp as any).he_sunday_holiday_rate) || 0,
        });
        if (result.pending_days > 0) withIncomplete++;
        if ((result as any).he_rate_missing) withMissingHeRate++;

        const paresTot = (result.pares_medio || 0) + (result.pares_dificil || 0);
        await upsertRun.mutateAsync({
          employee_id: emp.id,
          period: cPeriod,
          base_salary: regime === 'producao' ? 0 : Number(emp.salary) || 0,
          hourly_rate: result.valor_hora,
          worked_minutes: result.worked_minutes,
          normal_minutes: result.normal_minutes,
          premium_minutes: result.premium_minutes,
          normal_value: 0,
          premium_value: result.he_value,
          expected_minutes: result.expected_minutes,
          business_days: result.workdays,
          // Por par: "dias trabalhados" = DIAS PRODUTIVOS (dias com pares
          // lançados), não dias com batida — o ponto não paga neste regime.
          business_days_worked: regime === 'producao' ? result.paid_days : result.worked_days,
          absent_days: result.falta_days,
          absence_discount: result.falta_desconto,
          // Pares do período (por par): congelados na folha para holerite e
          // recibo não dependerem de reprocessar a Ficha meses depois.
          pares_medio: result.pares_medio || 0,
          pares_dificil: result.pares_dificil || 0,
          // Minutos de HE que geraram overtime_amount (o holerite exibe esta
          // coluna; premium_minutes é outro conceito — pós-18h/fds).
          overtime_50_minutes: result.he_minutes,
          deductions_amount: result.atraso_desconto,
          overtime_amount: result.he_value,
          advances_total: result.advances_total,
          total_proventos: result.total_proventos,
          total_descontos: result.total_descontos,
          total_liquido: result.net_value,
          net_salary: result.net_value,
          notes: regime === 'producao'
            ? `Por par: ${paresTot} pares (${result.pares_medio || 0} méd + ${result.pares_dificil || 0} dif) · ${result.paid_days} dia(s) produtivo(s)`
            : (result.pending_days > 0 ? `${result.pending_days} dia(s) pendente(s) — resolver no Pendências` : null),
          status: 'rascunho',
        });
        calculated++;
      }
      toast.success(
        `Folha calculada: ${calculated} funcionário(s).` +
        (clamped ? ` Parcial: ponto importado só até ${maxCov!.split('-').reverse().join('/')}.` : '') +
        (withIncomplete > 0 ? ` ${withIncomplete} com batida incompleta — confira no Ponto.` : '') +
        (withMissingHeRate > 0 ? ` ⚠ ${withMissingHeRate} com hora extra mas SEM valor de HE cadastrado (HE saiu R$0) — preencha "Hora extra (R$/h)" no cadastro do funcionário.` : '') +
        (sharedMatricula > 0 ? ` ⚠ ${sharedMatricula} com matrícula compartilhada — confira o cadastro (pode haver ponto de 2 pessoas na mesma matrícula).` : ''),
      );
      if (skippedPorPar > 0) {
        toast.info(
          `${skippedPorPar} do regime por par ficaram de fora: o pagamento deles é semanal (segunda a domingo) e este período não é uma semana. ` +
          `Pague pela Ficha de Montadores, navegando até a semana.`,
          { duration: 8000 },
        );
      }
    } catch (err: any) {
      toast.error(`Erro ao calcular folha: ${err.message}`);
    } finally {
      setCalcRunning(false);
    }
  }

  if (isLoading) {
    return (
      // aba dentro do RHHub — o cabeçalho é do hub, então só o miolo entra aqui
      <div className="space-y-5">
        <StatGridSkeleton count={4} />
        <TableSkeleton rows={8} />
      </div>
    );
  }

  // Seletor de período (quinzena/mês/datas) + Calcular — reusado na aba Relatórios.
  const filtersBar = (
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
  );

  // Painel de relatórios (Folha · Calendário · Holerite · Consolidado · Espelho).
  // Antes vivia num Dialog na Folha; agora é a ABA "Relatórios" (reportsOnly).
  // Prévia = mesmo HTML da impressão (fonte única).
  const reportPanelContent = (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
        <CalendarBlank className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Período</span>
        <span className="font-semibold text-foreground">
          {(appliedFrom || '').split('-').reverse().join('/')} a {(appliedTo || '').split('-').reverse().join('/')}
        </span>
        <span className="text-muted-foreground uppercase tracking-wide ml-auto">{periodTitle}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Relatórios (num arquivo)</p>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => toggleAllReports(!allReportsOn)}>
              {allReportsOn ? 'Limpar' : 'Selecionar todos'}
            </button>
          </div>
          <div className="space-y-2">
            {([['calendario', 'Calendário de tempo'], ['holerite', 'Holerite'], ['folha', 'Folha'], ['setor', 'Consolidado por setor'], ['espelho', 'Espelho relógio de ponto']] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2.5 cursor-pointer text-sm rounded-md border bg-background px-3 h-9">
                <Checkbox checked={reportSel[k]} onCheckedChange={v => setReportSel(s => ({ ...s, [k]: !!v }))} />
                {label}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Calendário, Holerite e Espelho saem por funcionário; Folha e Consolidado por setor saem 1× no período.
            O <b>Espelho</b> é o registro bruto do relógio (sem cálculo) e não precisa da folha calculada.
          </p>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Funcionário</p>
          <SearchableSelect
            value={docScope}
            onChange={setDocScope}
            options={[
              { value: 'all', label: `Todos os funcionários (${runs.length || espelhoEmps.length})` },
              ...runs.map(r => ({ value: r.employee_id, label: employeeMap.get(r.employee_id)?.name || '—' })),
            ]}
            placeholder="Funcionário"
            searchPlaceholder="Buscar funcionário..."
          />
          {hasPerEmp && docScope === 'all' && scopeEmps.length > 1 && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Impressão <b>funcionário a funcionário</b>: cada pessoa com o conjunto de documentos dela junto.
            </p>
          )}
        </div>
      </div>

      {previewHtml ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Prévia</p>
            {previewPaged && (
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-7 px-2" disabled={previewIdx <= 0}
                  onClick={() => setPreviewIdx(i => Math.max(0, i - 1))}>‹</Button>
                <span className="text-xs text-muted-foreground tabular-nums min-w-[140px] text-center truncate">
                  {Math.min(previewIdx, scopeEmps.length - 1) + 1}/{scopeEmps.length} · {scopeEmps[Math.min(previewIdx, scopeEmps.length - 1)]?.name}
                </span>
                <Button size="sm" variant="outline" className="h-7 px-2" disabled={previewIdx >= scopeEmps.length - 1}
                  onClick={() => setPreviewIdx(i => Math.min(scopeEmps.length - 1, i + 1))}>›</Button>
              </div>
            )}
          </div>
          <iframe
            title="Prévia do documento"
            srcDoc={previewHtml}
            className="w-full h-[540px] rounded-md border"
            style={{ background: '#fff' }}
          />
          {previewPaged && (
            <p className="text-[11px] text-muted-foreground">
              A prévia mostra um funcionário por vez; ao gerar, sai tudo num arquivo só
              {hasAgg ? ' (Folha/Consolidado 1× no início + ' : ' ('}o pacote de cada um dos {scopeEmps.length} funcionários).
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Marque ao menos um relatório para ver a prévia.</p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" className="mr-auto gap-1.5" onClick={handleExportExcel} title="Exportar a folha em Excel (resumo + detalhe dia a dia)">
          <DownloadSimple className="h-4 w-4" /> Excel
        </Button>
        <Button size="sm" onClick={handleGenerateReport} disabled={!anySel} className="gap-1.5">
          <Printer className="h-4 w-4" /> Imprimir / PDF
        </Button>
      </div>
    </div>
  );

  // ABA "Relatórios" (RH → Relatórios): o antigo botão "Relatórios" da Folha virou
  // uma aba própria. Mesmo seletor de período + o painel de geração, agora inline.
  if (reportsOnly) {
    const reportViewBtn = (v: typeof reportView, label: string) => (
      <Button
        type="button"
        variant={reportView === v ? 'default' : 'outline'}
        size="sm"
        className="h-9"
        onClick={() => setReportView(v)}
      >
        {label}
      </Button>
    );
    return (
      <div className="space-y-4 page-enter">
        {/* Sub-visão: Documentos · Faltas · Atrasos */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {reportViewBtn('docs', 'Documentos')}
          {reportViewBtn('faltas', 'Faltas')}
          {reportViewBtn('atrasos', 'Atrasos')}
        </div>

        {reportView === 'faltas' ? (
          <RelatorioFaltas />
        ) : reportView === 'atrasos' ? (
          <RelatorioAtrasos />
        ) : (
          <>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="text-xs text-muted-foreground max-w-md">
                Gere e imprima os relatórios da folha do período. O <b className="text-foreground">Espelho relógio de ponto</b> mostra o registro bruto importado — sem cálculo — só pra conferir as batidas.
              </div>
              {filtersBar}
            </div>
            {coverage && coverage.count === 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Nenhuma batida importada para {periodTitle}. Importe o arquivo do relógio (aba Ponto) — o Espelho lista o que foi importado.</span>
              </div>
            )}
            <div className="rounded-lg border bg-card p-4">
              {reportPanelContent}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Base proporcional aos dias − descontos</span> · base = salário × dias do período ÷ dias do mês · faltas e atrasos conforme a escala ·
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
          {/* "Relatórios" virou uma ABA própria (RH → Relatórios) — ver reportsOnly. */}
        </div>
      </div>

      {coverage && coverage.count === 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Nenhuma batida importada para {periodTitle}. Importe o arquivo do relógio (aba Ponto) antes de calcular.</span>
        </div>
      )}
      {coverage && coverage.maxCovered && appliedTo && coverage.maxCovered < appliedTo && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Ponto importado só até <strong>{coverage.maxCovered.split('-').reverse().join('/')}</strong> neste período —
            os dias seguintes <strong>não entram</strong> na folha (evita subpagar). Fica <strong>parcial</strong> até você importar o resto.
          </span>
        </div>
      )}

      <PayrollPendingAdvancesAlert from={appliedFrom} to={appliedTo} />

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

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
          {([['folha', 'Folha'], ['calendario', 'Calendário de tempo'], ['holerite', 'Holerite']] as const).map(([v, label]) => (
            <button
              key={v} type="button" onClick={() => setView(v)}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${view === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {view === 'folha' && runs.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Setor</span>
              <select
                value={setorFilter}
                onChange={e => setSetorFilter(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label="Filtrar por setor"
              >
                <option value="all">Todos os setores ({setoresDisponiveis.length})</option>
                {setoresDisponiveis.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={handlePrintFolhaPdf}
              title="Gerar PDF de todos os funcionários com valores e horas"
            >
              <FilePdf className="h-4 w-4" /> Gerar PDF
            </Button>
          </div>
        )}
      </div>

      {view === 'folha' && (
      <Panel title={`Folha · ${periodTitle}`} flush>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
              <TableHead>Funcionário</TableHead>
              <TableHead className="text-right">Salário</TableHead>
              <TableHead className="text-right">Faltas</TableHead>
              <TableHead className="text-right">Atrasos</TableHead>
              <TableHead className="text-right">Hora extra</TableHead>
              <TableHead className="text-right">Líquido</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="p-0">
                  <EmptyState
                    icon={Calculator}
                    title="Nenhuma folha calculada"
                    description={`Não há folha para ${periodTitle}. Clique em "Calcular folha" para gerar a partir das batidas.`}
                  />
                </TableCell>
              </TableRow>
            ) : folhaGroups.map(g => (
            <Fragment key={g.setor}>
              {/* Cabeçalho do setor + subtotais (Proventos · Descontos · Líquido) */}
              <TableRow className="bg-muted/60 hover:bg-muted/60 border-t-2 border-border">
                <TableCell colSpan={8} className="py-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="font-bold uppercase tracking-wide text-sm">
                      {g.setor}
                      <span className="ml-1.5 text-muted-foreground font-normal normal-case tracking-normal">· {g.runs.length} func.</span>
                    </span>
                    <span className="flex items-center gap-4 text-xs font-mono tabular-nums">
                      <span className="text-muted-foreground">Proventos <b className="text-emerald-600">{fmt(g.proventos)}</b></span>
                      <span className="text-muted-foreground">Descontos <b className="text-amber-600">{g.descontos > 0 ? `−${fmt(g.descontos)}` : fmt(0)}</b></span>
                      {g.advances > 0 && <span className="text-muted-foreground">Adiant. <b className="text-amber-600">−{fmt(g.advances)}</b></span>}
                      <span className="text-muted-foreground">Líquido <b className="text-foreground">{fmt(g.liquido)}</b></span>
                    </span>
                  </div>
                </TableCell>
              </TableRow>
              {g.runs.map(r => {
              const emp = employeeMap.get(r.employee_id);
              const sb = STATUS_BADGES[r.status] || STATUS_BADGES.rascunho;
              const hasAdvance = (r.advances_total || 0) > 0;
              const sum = paySummaries[r.id];
              const parcial = r.status === 'aprovado' && !!sum && sum.paidTotal > 0.005 && sum.paidTotal < (r.total_liquido || 0) - 0.005;
              // Regime por par: as colunas de ponto (Faltas/Atrasos/Hora extra)
              // não existem pra ele. Em vez de três "—" mudos, a linha usa o
              // espaço delas pra mostrar o que REALMENTE define o pagamento:
              // dias produtivos, pares e o R$/par efetivo do período.
              const prod = porParByEmp.get(r.employee_id);
              const prodMed = Number(prod?.pares_medio) || 0;
              const prodDif = Number(prod?.pares_dificil) || 0;
              const prodPares = prodMed + prodDif;
              // Taxa por dificuldade, nunca o bruto rateado: quando há par
              // difícil, a "média" não é o R$/par de ninguém.
              const prodTxM = Number(prod?.taxa_medio) || 0;
              const prodTxD = Number(prod?.taxa_dificil) || 0;
              return (
                <TableRow key={r.id} className={hasAdvance ? 'hover:bg-muted/30 bg-amber-500/5' : 'hover:bg-muted/30'}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5">
                      {emp?.name || '—'}
                      {hasAdvance && <Wallet className="h-3.5 w-3.5 text-amber-600" aria-label="Possui adiantamento" />}
                    </div>
                    {prod && (
                      <span className="mt-0.5 inline-block rounded bg-muted px-1.5 py-px font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Por par
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right font-mono text-muted-foreground tabular-nums"
                    title={prod ? `Produção do período — ${prodPares.toLocaleString('pt-BR')} pares` : `Salário mensal ${fmt(r.base_salary)}`}
                  >{fmt((r.total_proventos || 0) - (r.overtime_amount || 0))}</TableCell>
                  {prod ? (
                    <TableCell colSpan={3} className="text-right font-mono text-xs tabular-nums">
                      <span className="text-foreground font-semibold">{Number(prod.paid_days) || 0}</span>
                      <span className="text-muted-foreground"> dias prod. · </span>
                      <span className="text-foreground font-semibold">{prodMed.toLocaleString('pt-BR')}</span>
                      <span className="text-muted-foreground"> méd × {fmt(prodTxM)}</span>
                      {prodDif > 0 && (
                        <>
                          <span className="text-muted-foreground"> · </span>
                          <span className="text-foreground font-semibold">{prodDif.toLocaleString('pt-BR')}</span>
                          <span className="text-muted-foreground"> dif × {fmt(prodTxD)}</span>
                        </>
                      )}
                      {(Number(prod.fichas) || 0) > 0 && (
                        <span className="text-muted-foreground"> · {prod.fichas} fichas{prod.fichas_derivadas ? '*' : ''}</span>
                      )}
                    </TableCell>
                  ) : (
                    <>
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
                    </>
                  )}
                  <TableCell className="text-right font-mono tabular-nums font-bold">{fmt(r.total_liquido)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={sb.variant}>{sb.label}</Badge>
                      {sum?.hasReceipt && <Paperclip className="h-3.5 w-3.5 text-emerald-600" aria-label="Recibo anexado" />}
                    </div>
                    {parcial && <div className="text-[10px] text-amber-600 tabular-nums mt-0.5">parcial · {fmt(sum!.paidTotal)}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {/* Documentos (holerite/espelho/folha) saíram daqui pro botão único
                          "Gerar documentos" no topo (2026-06-28). Sobram só ações de status. */}
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
                      {(r.status === 'aprovado' || r.status === 'pago') && (
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => setPayRun(r.id)}
                          title={r.status === 'pago' ? 'Ver pagamentos e recibos' : 'Registrar pagamento'}
                        >
                          {r.status === 'pago'
                            ? <Receipt className="h-4 w-4 text-emerald-600" />
                            : <DollarSign className="h-4 w-4 text-primary" />}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
              })}
            </Fragment>
            ))}
          </TableBody>
        </Table>
      </Panel>
      )}

      {view === 'calendario' && (() => {
        const crows = comparativo.rows;
        if (crows.length === 0) {
          return <Panel title="Calendário de tempo" flush><div className="p-2"><EmptyState icon={Calculator} title="Nenhuma folha calculada" description={`Não há dados para ${periodTitle}. Clique em "Calcular folha".`} /></div></Panel>;
        }
        const cur = crows.find(r => r.id === calEmp) || crows[0];
        const days = ((cur as any)?.printData?.days || []) as any[];
        const cls = (d: any) => {
          const exp = d.expectedMinutes || 0, w = d.workedMinutes || 0;
          if (exp === 0) return { t: '—', c: 'bg-muted/40 text-muted-foreground border-border/60' };
          if (w === 0) return { t: 'falta', c: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20' };
          if ((d.overtimeMinutes || 0) > 0 || w > exp) return { t: '+' + fmtDeltaMin(w - exp), c: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' };
          if (w < exp) return { t: '−' + fmtDeltaMin(exp - w), c: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' };
          return { t: fmtDeltaMin(w), c: 'bg-card text-foreground border-border' };
        };
        return (
          <Panel title={`Calendário de tempo · ${periodTitle}`} flush>
            <div className="p-4 space-y-3">
              <select value={cur?.id || ''} onChange={e => setCalEmp(e.target.value)} className="h-9 w-full max-w-xs rounded-md border bg-background px-3 text-base md:text-sm">
                {crows.map(r => <option key={r.id} value={r.id}>{employeeMap.get(r.id)?.name || (r as any).name}</option>)}
              </select>
              <div className="grid grid-cols-7 gap-1.5">
                {days.map((d, i) => {
                  const s = cls(d);
                  return (
                    <div key={i} className={`rounded-md border px-1 py-1.5 text-center ${s.c}`}>
                      <div className="text-[10px] opacity-70 tabular-nums">{String(d.date || '').slice(8, 10)}/{String(d.date || '').slice(5, 7)}</div>
                      <div className="text-xs font-semibold tabular-nums">{s.t}</div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground pt-1">
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40 inline-block" /> hora extra</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40 inline-block" /> atraso</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/40 inline-block" /> falta</span>
                <Button size="sm" variant="outline" className="h-7 ml-auto gap-1.5" onClick={() => printEspelho(cur.id)}><Printer className="h-3.5 w-3.5" /> Imprimir espelho</Button>
              </div>
            </div>
          </Panel>
        );
      })()}

      {view === 'holerite' && (
        <Panel title={`Holerites · ${periodTitle}`} flush>
          {runs.length === 0 ? (
            <div className="p-2"><EmptyState icon={Receipt} title="Nenhuma folha calculada" description={`Não há folha para ${periodTitle}. Clique em "Calcular folha".`} /></div>
          ) : (
            <div className="divide-y divide-border">
              {runs.map(r => {
                const emp = employeeMap.get(r.employee_id);
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-sm font-medium truncate">{emp?.name || '—'}</span>
                    <span className="font-mono tabular-nums text-sm font-bold ml-auto">{fmt(r.total_liquido)}</span>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setDetailRun(r.id)}><Receipt className="h-4 w-4" /> Holerite</Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => printEspelho(r.employee_id)} title="Espelho de ponto (Portaria 671)"><IdentificationCard className="h-4 w-4 text-muted-foreground" /></Button>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {/* Registro de pagamento + recibo assinado */}
      {(() => {
        const r = runs.find(x => x.id === payRun) || null;
        const emp = r ? employeeMap.get(r.employee_id) : null;
        return (
          <RegistrarPagamentoDialog
            open={!!payRun}
            onOpenChange={(o) => !o && setPayRun(null)}
            run={r}
            employeeName={emp?.name || '—'}
            employeeCpf={(emp as any)?.cpf}
            employeeRole={(emp as any)?.role}
          />
        );
      })()}

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
          <DialogHeader>
            <DialogTitle>Holerite do período</DialogTitle>
            <DialogDescription>Proventos, descontos e líquido a receber. Quem é pago por par tem a produção discriminada no lugar do salário.</DialogDescription>
          </DialogHeader>
          {(() => {
            const r = runs.find(x => x.id === detailRun);
            if (!r) return null;
            const emp = employeeMap.get(r.employee_id);
            // Base PAGA no período (proporcional aos dias do mês): proventos − HE.
            const pr = periodToRange(r.period);
            const pdays = daysBetween(pr.from, pr.to);
            const periodBase = (r.total_proventos || 0) - (r.overtime_amount || 0);
            const isFullMonth = /^\d{4}-\d{2}$/.test(r.period); // período "YYYY-MM" = mês cheio
            // Regime POR PAR: o holerite não fala de salário, falta nem hora
            // extra — nada disso entra na conta dele. Discrimina a produção que
            // gerou o bruto: dias produtivos, pares por dificuldade e R$/par.
            const hp = porParByEmp.get(r.employee_id);
            const hpMed = hp ? Number(hp.pares_medio) || 0 : 0;
            const hpDif = hp ? Number(hp.pares_dificil) || 0 : 0;
            // Cada dificuldade tem R$/par PRÓPRIO — usar o bruto de cada uma, e
            // nunca ratear o bruto total pelo nº de pares: com 100 méd a 0,80 e
            // 20 dif a 1,00, a taxa "média" (0,833) faz as duas linhas saírem
            // erradas, mesmo que a soma feche.
            const hpTxM = hp ? Number(hp.taxa_medio) || 0 : 0;
            const hpTxD = hp ? Number(hp.taxa_dificil) || 0 : 0;
            const asterisco = hp?.taxa_variou ? ' *' : '';
            const lines = hp
              ? [
                  {
                    label: `Pares médios — ${hpMed.toLocaleString('pt-BR')} × ${fmt(hpTxM)}${asterisco}`,
                    value: Number(hp.bruto_medio) || 0, type: 'p' as const, always: hpMed > 0,
                  },
                  {
                    label: `Pares difíceis — ${hpDif.toLocaleString('pt-BR')} × ${fmt(hpTxD)}${asterisco}`,
                    value: Number(hp.bruto_dificil) || 0, type: 'p' as const,
                  },
                  { label: 'Adiantamentos do período', value: r.advances_total || 0, type: 'd' as const, highlight: true },
                ].filter(l => l.value > 0 || (l as any).always)
              : [
                  {
                    label: isFullMonth ? 'Salário base' : `Salário do período (${pdays} dia(s) proporcional)`,
                    value: periodBase, type: 'p' as const, always: true,
                  },
                  { label: `Horas extras 1,5× (${fmtHoras(r.overtime_50_minutes || 0)})`, value: r.overtime_amount || 0, type: 'p' as const },
                  { label: `Faltas (${r.absent_days || 0} dia(s))`, value: r.absence_discount || 0, type: 'd' as const, highlight: (r.absent_days || 0) > 0 },
                  { label: 'Atrasos / saídas cedo', value: r.deductions_amount || 0, type: 'd' as const },
                  { label: 'Adiantamentos do período', value: r.advances_total || 0, type: 'd' as const, highlight: true },
                ].filter(l => l.value > 0 || (l as any).always);

            return (
              <div className="space-y-3">
                <div className="text-sm">
                  <p className="font-bold text-base">{emp?.name}</p>
                  <p className="text-muted-foreground">{emp?.role || '—'} • {emp?.department || '—'} • Período {periodLabel(periodToRange(r.period).from, periodToRange(r.period).to)}</p>
                  {hp ? (
                    <p className="text-muted-foreground flex flex-wrap items-center gap-1 mt-1">
                      <Package className="h-3.5 w-3.5" />
                      Pagamento por par ·
                      {' '}<span className="font-mono font-semibold text-foreground">{Number(hp.paid_days) || 0}</span> dias produtivos
                      {' '}· <span className="font-mono font-semibold text-foreground">{(hpMed + hpDif).toLocaleString('pt-BR')}</span> pares
                      {(Number(hp.fichas) || 0) > 0 && <> · <span className="font-mono font-semibold text-foreground">{hp.fichas}</span> fichas{hp.fichas_derivadas ? '*' : ''}</>}
                    </p>
                  ) : (
                    <p className="text-muted-foreground flex items-center gap-1 mt-1">
                      <Clock className="h-3.5 w-3.5" />
                      Total trabalhado: <span className="font-mono font-semibold text-foreground">{fmtHoras(r.worked_minutes)}</span>
                      {' '}· valor-hora <span className="font-mono font-semibold text-foreground">{fmt(r.hourly_rate)}</span>
                      {' '}· salário mensal <span className="font-mono font-semibold text-foreground">{fmt(r.base_salary)}</span>
                    </p>
                  )}
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
                {hp?.taxa_variou && (
                  <p className="text-[11px] text-muted-foreground">
                    * O R$/par mudou dentro do período (reajuste). O valor exibido é a média das taxas
                    efetivamente gravadas em cada lançamento — o total continua exato.
                  </p>
                )}
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

      {/* Seletor ÚNICO de relatórios — tipo + escopo no topo, PRÉVIA ao vivo
          embaixo (iframe = mesmo HTML da impressão). Consolida o antigo "Gerar
          documentos" + "Exportar Excel" + "Por setor". */}
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
      <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
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

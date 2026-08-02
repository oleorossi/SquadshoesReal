// ─────────────────────────────────────────────────────────────────────────────
// FONTE ÚNICA do comparativo de folha (Mês × 1ª × 2ª quinzena) usado para
// IMPRIMIR e EXPORTAR (Excel) a folha. Antes esta lógica vivia só dentro do
// RelatoriosRH (aba Pagamento); a aba foi consolidada na FOLHA (Payroll), então
// a orquestração ficou aqui pra os dois lados produzirem NÚMEROS IDÊNTICOS.
//
// O cálculo em si é do motor compartilhado `computePeriodFolha` (salaryPayroll) —
// este arquivo só monta os 3 períodos por funcionário + a flag de Situação + os
// dados de impressão (EmployeeTimesheetData).
// ─────────────────────────────────────────────────────────────────────────────
import { computePeriodFolha, getDaysInRange, expectedDayMinutes, type SalaryPayrollResult } from './salaryPayroll';
import { sumProducaoRows, type FichaMontadorRow } from './montadorProduction';
import { calculateDaySummary, type DaySummary } from '@/hooks/useTimesheet';
import { MONTHLY_HOURS_DIVISOR } from './hourlyPayroll';
import type { EmployeeTimesheetData } from './printTimesheet';

export type SitTone = 'green' | 'amber' | 'red';
export interface Situacao { txt: string; tone: SitTone }

const fmtBRdate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : '—');

/** Flag de qualidade do ponto (Situação) — o que conferir antes de pagar. */
export function computeSituacao(r: SalaryPayrollResult, matchedDays: number, maxCov: string | null, periodTo: string): Situacao {
  if (r.workdays === 0) return { txt: 'Sem escala / sem dias úteis', tone: 'red' };
  if (matchedDays === 0) return { txt: 'Sem ponto importado', tone: 'red' };
  if (matchedDays <= 5) return { txt: `Ponto faltando — só ${matchedDays} dia(s) batido(s)`, tone: 'red' };
  if (r.falta_days >= 10) return { txt: `Muitas faltas (${r.falta_days}) — conferir ponto`, tone: 'red' };
  if (r.pending_days >= 3) return { txt: `${r.pending_days} batidas ímpares — resolver em Pendências`, tone: 'amber' };
  if (maxCov && periodTo && maxCov < periodTo) return { txt: `Ponto só até ${fmtBRdate(maxCov)} — parcial`, tone: 'amber' };
  if (r.pending_days > 0) return { txt: `${r.pending_days} pendência(s) de batida`, tone: 'amber' };
  if (r.falta_days > 0) return { txt: `${r.falta_days} falta(s) no período`, tone: 'amber' };
  return { txt: 'OK', tone: 'green' };
}

/** Monta o EmployeeTimesheetData (consumido por printTimesheet/exportFolhaExcel). */
export function buildEmployeePrintData(
  emp: any,
  sch: any,
  days: { date: string; dow: number; punches: string[]; isHoliday: boolean; swap?: 'worked' | 'off' }[],
): EmployeeTimesheetData {
  const summaries: DaySummary[] = days.map(d => {
    const s = calculateDaySummary(d.punches, d.dow, sch, d.isHoliday, d.swap);
    return { ...s, date: d.date, punches: d.punches } as DaySummary;
  });
  return {
    name: emp?.name || '—',
    days: summaries,
    schedule: {
      overtime_multiplier: sch?.overtime_multiplier ?? 1.5,
      holiday_multiplier: sch?.holiday_multiplier ?? 1.5,
      minimum_overtime_minutes: sch?.minimum_overtime_minutes || 0,
    },
    hourlySalary: (Number(emp?.salary) || 0) / MONTHLY_HOURS_DIVISOR,
    overtimeHourlyRate: emp?.overtime_hourly_rate ?? null,
    expectedDayMin: expectedDayMinutes(sch),
    paymentType: (emp?.payment_type as 'mensalista' | 'remoto' | 'diarista' | 'producao') || 'mensalista',
    dailyRate: Number(emp?.daily_rate) || 0,
    monthlySalary: Number(emp?.salary) || 0,
  };
}

export interface ComparativoRow {
  id: string;
  ext?: string;
  name: string;
  result: SalaryPayrollResult;   // intervalo selecionado (base do período)
  q1: SalaryPayrollResult;       // 1ª quinzena (01–15)
  q2: SalaryPayrollResult;       // 2ª quinzena (16–fim)
  matchedDays: number;
  advMes: number;                // adiantamentos do mês (R$)
  sit: Situacao;
  printData: EmployeeTimesheetData;
}

export interface ComparativoArgs {
  employees: any[];
  schedules: any[];
  defaultSchedule: any;
  holidaysSet: Set<string>;
  /** Trocas de dia: datas trabalhadas (lidas como normal) e folgas compensatórias. */
  swapWorkedSet?: Set<string>;
  swapOffSet?: Set<string>;
  timeRecords: { employee_external_id?: string | null; employee_name?: string | null; record_date: string; punches: string[] }[];
  advancesList: { employee_id: string; amount: number; advance_date: string }[];
  /** Linhas de ficha_montadores (produção por par) do período — regime 'producao'. */
  producaoRows?: FichaMontadorRow[];
  range: { from: string; to: string };
  period: string;             // YYYY-MM (mês de referência das quinzenas)
  maxCovered?: string | null; // clamp à cobertura (último dia importado)
}

export interface ComparativoResult {
  rows: ComparativoRow[];
  totals: { salarios: number; mes: number; q1: number; q2: number; advMes: number };
  monthDays: number;
}

/** Constrói os comparativos (Mês × 1ª × 2ª) de TODOS os funcionários ativos. */
export function computeComparativoRows(args: ComparativoArgs): ComparativoResult {
  const { employees, schedules, defaultSchedule, holidaysSet, timeRecords, advancesList, range, period, maxCovered = null } = args;
  const swapWorkedSet = args.swapWorkedSet ?? new Set<string>();
  const swapOffSet = args.swapOffSet ?? new Set<string>();
  const swapModeFor = (d: string): 'worked' | 'off' | undefined =>
    swapWorkedSet.has(d) ? 'worked' : swapOffSet.has(d) ? 'off' : undefined;

  const [py, pm] = period.split('-').map(Number);
  const monthDays = py && pm ? new Date(py, pm, 0).getDate() : 30;
  const monthTo = `${period}-${String(monthDays).padStart(2, '0')}`;
  const q2Days = Math.max(0, monthDays - 15);

  // Batida → dia, por matrícula, por matrícula+nome e por nome (MESMO casamento do
  // Relatório de Atrasos/Faltas): quando um mesmo device_id (matrícula) é compartilhado
  // por mais de um funcionário, o casamento só por matrícula pegaria batida do colega.
  const byExternalId = new Map<string, Map<string, string[]>>();
  const byExtIdName = new Map<string, Map<string, string[]>>();
  const byName = new Map<string, Map<string, string[]>>();
  const extIdNames = new Map<string, Set<string>>();
  // Datas COBERTAS (relógio lido = batida real de alguém) — falta só em dia coberto.
  const coveredDates = new Set<string>();
  for (const r of timeRecords) {
    const punches: string[] = Array.isArray(r.punches) ? r.punches : [];
    if (punches.length > 0) coveredDates.add(r.record_date);
    const nk = (r.employee_name || '').toLowerCase().trim();
    if (r.employee_external_id) {
      const k = String(r.employee_external_id);
      if (!byExternalId.has(k)) byExternalId.set(k, new Map());
      byExternalId.get(k)!.set(r.record_date, punches);
      if (!extIdNames.has(k)) extIdNames.set(k, new Set());
      if (nk) extIdNames.get(k)!.add(nk);
      const kn = `${k}|${nk}`;
      if (!byExtIdName.has(kn)) byExtIdName.set(kn, new Map());
      byExtIdName.get(kn)!.set(r.record_date, punches);
    }
    if (nk) {
      if (!byName.has(nk)) byName.set(nk, new Map());
      byName.get(nk)!.set(r.record_date, punches);
    }
  }

  const advByEmp = new Map<string, { advance_date: string; amount: number }[]>();
  for (const a of advancesList) {
    if (!advByEmp.has(a.employee_id)) advByEmp.set(a.employee_id, []);
    advByEmp.get(a.employee_id)!.push({ advance_date: a.advance_date, amount: Number(a.amount) || 0 });
  }

  // Produção por par (Ficha de Montadores) por montador — filtrada por dia dentro
  // de cada janela (mês/quinzena) no cálculo. Só regime 'producao' usa.
  const prodByEmp = new Map<string, FichaMontadorRow[]>();
  for (const r of (args.producaoRows ?? [])) {
    if (!r.montador_id) continue;
    const list = prodByEmp.get(r.montador_id) || [];
    list.push(r);
    prodByEmp.set(r.montador_id, list);
  }

  const rangeDays = getDaysInRange(range.from, range.to);
  const coveredDays = maxCovered ? rangeDays.filter(d => d.date <= maxCovered) : rangeDays;

  const rows: ComparativoRow[] = employees
    .filter(e => e.active)
    .map(emp => {
      const extKey = emp.external_id ? String(emp.external_id) : '';
      const nameKey = String(emp.name || '').toLowerCase().trim();
      // Matrícula compartilhada (mais de um nome no mesmo device) → casa por
      // matrícula+nome; senão por matrícula; senão por nome.
      const extShared = !!extKey && (extIdNames.get(extKey)?.size || 0) > 1;
      const empPunches = (extKey ? byExtIdName.get(`${extKey}|${nameKey}`) : null)
        || (!extShared && extKey ? byExternalId.get(extKey) : null)
        || byName.get(nameKey)
        || new Map<string, string[]>();
      const sch = (emp.work_schedule_id && schedules.find(s => s.id === emp.work_schedule_id)) || defaultSchedule;
      const empAdvances = advByEmp.get(emp.id) || [];
      const empProdRows = prodByEmp.get(emp.id) || [];
      const regime = String(emp.payment_type || 'mensalista').toLowerCase() as 'mensalista' | 'remoto' | 'diarista' | 'producao';

      const folha = (from: string, to: string, periodDays?: number) => {
        // Produção por par da janela (dia ∈ [from,to]) — snapshot de R$/par por linha.
        const prod = sumProducaoRows(empProdRows.filter(r => (r.dia || '') >= from && (r.dia || '') <= to));
        return computePeriodFolha({
          salary: Number(emp.salary) || 0, from, to,
          schedule: sch, holidaysSet, swapWorkedSet, swapOffSet, punchesByDate: empPunches,
          activeFrom: emp.admission_date || null, activeTo: emp.termination_date || null,
          coveredDates,
          periodDays, monthDays, maxCoveredDate: maxCovered,
          payRegime: regime,
          dailyRate: Number(emp.daily_rate) || 0,
          producaoBruto: prod.bruto,
          producaoParesMedio: prod.paresMedio,
          producaoParesDificil: prod.paresDificil,
          producaoDias: prod.dias,
          producaoFichas: prod.fichas,
          producaoFichasDerivadas: prod.fichasDerivadas,
          // HE em R$/h por funcionário — comparativo/holerite bate com a Folha (spec req.15).
          heNormalRate: Number((emp as any).he_normal_rate) || 0,
          heSundayHolidayRate: Number((emp as any).he_sunday_holiday_rate) || 0,
          advancesTotal: empAdvances.filter(a => a.advance_date >= from && a.advance_date <= to).reduce((s, a) => s + a.amount, 0),
        });
      };

      const result = folha(range.from, range.to, rangeDays.length);
      const q1 = folha(`${period}-01`, `${period}-15`, 15);
      const q2 = folha(`${period}-16`, monthTo, q2Days);
      const matchedDays = Array.from(empPunches.keys()).filter(d => d >= range.from && d <= range.to).length;
      const advMes = empAdvances.reduce((s, a) => s + a.amount, 0);
      // isHoliday cru; a precedência da troca (feriado ignorado em dia de troca) é
      // resolvida dentro de calculateDaySummary via o param `swap` — não duplicar aqui.
      const printDays = coveredDays.map(d => ({ date: d.date, dow: d.dow, punches: empPunches.get(d.date) || [], isHoliday: holidaysSet.has(d.date), swap: swapModeFor(d.date) }));

      // Por par: ponto é só presença → não avaliar falta/escala (senão cairia em
      // "Sem escala" vermelho). Situação própria neutra.
      const sit = regime === 'producao'
        ? { txt: 'Por par (produção)', tone: 'green' as const }
        : computeSituacao(result, matchedDays, maxCovered, range.to);

      return {
        id: emp.id, ext: extKey || undefined, name: emp.name,
        result, q1, q2, matchedDays, advMes,
        sit,
        printData: buildEmployeePrintData(emp, sch, printDays),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const totals = {
    salarios: rows.reduce((s, r) => s + r.result.base_salary, 0),
    mes: rows.reduce((s, r) => s + r.result.net_value, 0),
    q1: rows.reduce((s, r) => s + r.q1.net_value, 0),
    q2: rows.reduce((s, r) => s + r.q2.net_value, 0),
    advMes: rows.reduce((s, r) => s + r.advMes, 0),
  };

  return { rows, totals, monthDays };
}

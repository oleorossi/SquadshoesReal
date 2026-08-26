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
import { calculateDaySummary, type DaySummary, type WorkSchedule } from '@/hooks/useTimesheet';
import type { Employee } from '@/hooks/useEmployees';
import { MONTHLY_HOURS_DIVISOR } from './hourlyPayroll';
import type { EmployeeTimesheetData } from './printTimesheet';
import { employeeOverlapsEmploymentRange } from './employeeEmployment';

export type SitTone = 'green' | 'amber' | 'red';
export interface Situacao { txt: string; tone: SitTone }

type ComparativoEmployee = Omit<Partial<Employee>, 'payment_type'>
  & Pick<Employee, 'id' | 'name'>
  & { payment_type?: Employee['payment_type'] | string };
type ComparativoSchedule = Partial<WorkSchedule> & Pick<WorkSchedule, 'id'>;

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
  emp: ComparativoEmployee,
  sch: ComparativoSchedule | null,
  days: { date: string; dow: number; punches: string[]; isHoliday: boolean; swap?: 'worked' | 'off' }[],
  payrollResult?: SalaryPayrollResult,
): EmployeeTimesheetData {
  const summaries: DaySummary[] = days.map(d => {
    const s = calculateDaySummary(d.punches, d.dow, sch as WorkSchedule, d.isHoliday, d.swap);
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
    payrollResult,
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
  employees: ComparativoEmployee[];
  schedules: ComparativoSchedule[];
  defaultSchedule: ComparativoSchedule | null;
  holidaysSet: Set<string>;
  /** Trocas de dia: datas trabalhadas (lidas como normal) e folgas compensatórias. */
  swapWorkedSet?: Set<string>;
  swapOffSet?: Set<string>;
  timeRecords: PayrollIdentityTimeRecord[];
  advancesList: { employee_id: string; amount: number; advance_date: string }[];
  /** Ausências justificadas já expandidas por funcionário no intervalo consultado. */
  absenceDatesByEmployee?: Map<string, Set<string>>;
  /** Minutos remunerados de ausência parcial por funcionário/data. */
  absenceMinutesByEmployee?: Map<string, Map<string, number>>;
  /** Linhas de ficha_montadores (produção por par) do período — regime 'producao'. */
  producaoRows?: FichaMontadorRow[];
  range: { from: string; to: string };
  period: string;             // YYYY-MM (mês de referência das quinzenas)
  maxCovered?: string | null; // clamp à cobertura (último dia importado)
  /** Datas abrangidas pelos protocolos de arquivo. Quando presente, é a fonte
   *  de falta; time_records sozinho não prova que uma data sem linha foi lida. */
  coveredDates?: Set<string>;
}

export interface PayrollIdentityTimeRecord {
  employee_id?: string | null;
  employee_external_id?: string | null;
  employee_name?: string | null;
  record_date: string;
  punches: string[];
}

export interface PayrollPunchConflict {
  employeeId: string;
  recordDate: string;
  variants: string[][];
}

export interface PayrollPunchGrouping {
  byEmployee: Map<string, Map<string, string[]>>;
  unmatched: PayrollIdentityTimeRecord[];
  conflicts: PayrollPunchConflict[];
  deduplicatedCount: number;
}

function canonicalPunches(punches: string[]): string[] {
  return (Array.isArray(punches) ? punches : [])
    .map(punch => String(punch || '').trim())
    .filter(Boolean)
    .sort((left, right) => {
      const cleanLeft = left.replace(/[*"]/g, '');
      const cleanRight = right.replace(/[*"]/g, '');
      return cleanLeft.localeCompare(cleanRight) || left.localeCompare(right);
    });
}

/**
 * Associação única dos relatórios financeiros: somente a FK `employee_id`
 * congelada pelo servidor pode atribuir a batida. Matrícula/nome são evidência
 * para a quarentena, nunca uma segunda resolução no navegador. Linhas idênticas
 * do mesmo dia são deduplicadas; variantes
 * conflitantes viram uma batida ímpar determinística, deixando o dia PENDENTE
 * em vez de escolher silenciosamente um valor que pagaria/descontaria errado.
 */
export function groupPayrollPunchesByEmployee(
  employees: Employee[],
  timeRecords: PayrollIdentityTimeRecord[],
): PayrollPunchGrouping {
  const candidates = new Map<string, Map<string, Map<string, string[]>>>();
  const unmatched: PayrollIdentityTimeRecord[] = [];
  let deduplicatedCount = 0;

  for (const record of timeRecords) {
    const match = record.employee_id
      ? employees.find(employee =>
          employee.id === record.employee_id
          && (!employee.admission_date || record.record_date >= employee.admission_date)
          && (!employee.termination_date || record.record_date <= employee.termination_date),
        )
      : undefined;
    if (!match) {
      unmatched.push(record);
      continue;
    }

    const punches = canonicalPunches(record.punches);
    const signature = JSON.stringify(punches);
    const dates = candidates.get(match.id) || new Map<string, Map<string, string[]>>();
    const variants = dates.get(record.record_date) || new Map<string, string[]>();
    if (variants.has(signature)) deduplicatedCount++;
    else variants.set(signature, punches);
    dates.set(record.record_date, variants);
    candidates.set(match.id, dates);
  }

  const byEmployee = new Map<string, Map<string, string[]>>();
  const conflicts: PayrollPunchConflict[] = [];
  for (const [employeeId, dates] of candidates) {
    const punchesByDate = new Map<string, string[]>();
    for (const [recordDate, variantMap] of dates) {
      const variants = [...variantMap.values()]
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      if (variants.length === 1) {
        punchesByDate.set(recordDate, variants[0]);
        continue;
      }

      conflicts.push({ employeeId, recordDate, variants });
      // Usa somente uma batida real, escolhida deterministicamente, para o motor
      // classificar o dia como pendente. Não une horários de linhas conflitantes.
      const pendingPunch = variants.flat().sort((left, right) => left.localeCompare(right))[0];
      if (pendingPunch) punchesByDate.set(recordDate, [pendingPunch]);
    }
    byEmployee.set(employeeId, punchesByDate);
  }

  return { byEmployee, unmatched, conflicts, deduplicatedCount };
}

export interface ComparativoResult {
  rows: ComparativoRow[];
  totals: { salarios: number; mes: number; q1: number; q2: number; advMes: number };
  monthDays: number;
}

/** Constrói os comparativos (Mês × 1ª × 2ª) dos vínculos vigentes no período. */
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

  // Datas COBERTAS (relógio lido = batida real de alguém) — falta só em dia coberto.
  const coveredDates = args.coveredDates
    ? new Set(args.coveredDates)
    : new Set(timeRecords
      .filter(record => Array.isArray(record.punches) && record.punches.length > 0)
      .map(record => record.record_date));
  const identity = groupPayrollPunchesByEmployee(employees as Employee[], timeRecords);
  if (identity.conflicts.length > 0) {
    console.warn('[payrollComparativo] Registros duplicados conflitantes foram marcados como pendência:', identity.conflicts);
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
    .filter(e => employeeOverlapsEmploymentRange(e as Employee, range.from, range.to))
    .map(emp => {
      const extKey = emp.external_id ? String(emp.external_id) : '';
      const empPunches = identity.byEmployee.get(emp.id) || new Map<string, string[]>();
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
          absenceDates: args.absenceDatesByEmployee?.get(emp.id),
          absenceMinutes: args.absenceMinutesByEmployee?.get(emp.id),
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
          producaoBrutoMedio: prod.brutoMedio,
          producaoBrutoDificil: prod.brutoDificil,
          producaoTaxaMedio: prod.taxaMedio,
          producaoTaxaDificil: prod.taxaDificil,
          producaoTaxaVariou: prod.taxaVariou,
          // HE em R$/h por funcionário — comparativo/holerite bate com a Folha (spec req.15).
          heNormalRate: Number(emp.he_normal_rate) || 0,
          heSundayHolidayRate: Number(emp.he_sunday_holiday_rate) || 0,
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
        printData: buildEmployeePrintData(emp, sch, printDays, result),
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

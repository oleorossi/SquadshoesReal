import { useMemo } from 'react';
import {
  useWorkSchedules, useHolidays, useTimeRecords,
  calculateDaySummary, WorkSchedule,
} from '@/hooks/useTimesheet';
import { useEmployees } from '@/hooks/useEmployees';
import { useBenefitsConfig, useBankHoursMovements, useAbsences } from '@/hooks/useRH';
import { calculateWeeklyPeriod, WeeklyCalcDay, WeekSummary } from '@/lib/weeklyTimeCalculation';
import { findEmployeeMatch } from '@/lib/employeeMatching';

/**
 * Apuração de fechamento mensal por funcionário.
 *
 * Para cada colaborador ativo, no intervalo [from, to], calcula a partir do
 * ponto importado (time_records) — usando a MESMA lógica do resto do app
 * (calculateDaySummary + calculateWeeklyPeriod, escala individual, feriados):
 *
 *   - horas trabalhadas vs. horas contratadas (previstas);
 *   - hora extra (saldo positivo da semana) → valor a pagar/banco;
 *   - horas a menos / devedoras (saldo negativo) → desconto SUGERIDO (RH decide).
 *
 * Os valores derivados do ponto NÃO mudam quando o RH lança no banco de horas:
 * a apuração do ponto é a fonte; os lançamentos no banco aparecem como coluna
 * informativa separada (bankMovementsMin) para evitar duplo-contagem.
 */

const FALLBACK_SCHEDULE: WorkSchedule = {
  id: '', name: 'Padrão (44h)', entry_time: '08:00', lunch_start: '12:00', lunch_end: '13:00',
  exit_time: '17:48', saturday_entry: '08:00', saturday_exit: '12:00', weekly_hours: 44,
  overtime_multiplier: 1.5, night_overtime_multiplier: 1.7, holiday_multiplier: 2.0,
  tolerance_minutes: 10, minimum_overtime_minutes: 0, is_default: true, created_at: '', updated_at: '',
};

export type ClosingStatus = 'extra' | 'devedor' | 'misto' | 'em_dia' | 'sem_ponto';

export interface MonthlyClosingRow {
  employeeId: string;
  name: string;
  department: string;
  scheduleName: string;
  weeklyHours: number;
  workedMin: number;
  expectedMin: number;
  overtimeMin: number;
  deficitMin: number;
  netMin: number;
  absences: number;
  incompleteDays: number;
  holidaysWorked: number;
  daysWithRecords: number;
  /** Dias úteis esperados sem ponto e sem ausência justificada (= faltas). */
  missingDays: number;
  normalHourRate: number;
  otHourRate: number;
  overtimeMultiplier: number;
  /** R$ a pagar pela hora extra (taxa de HE × multiplicador). */
  overtimeValue: number;
  /** R$ de desconto SUGERIDO pelas horas a menos (hora normal, sem multiplicador). */
  deficitValue: number;
  /** Lançamentos já feitos no banco de horas no período (informativo). */
  bankMovementsMin: number;
  status: ClosingStatus;
  weeks: WeekSummary[];
}

export interface MonthlyClosingTotals {
  employees: number;
  withOvertime: number;
  withDeficit: number;
  balanced: number;
  withoutRecords: number;
  overtimeMin: number;
  deficitMin: number;
  overtimeValue: number;
  deficitValue: number;
  netValue: number;
}

function isHolidayOn(holidays: { holiday_date: string; recurring: boolean }[], dateISO: string): boolean {
  return holidays.some(h =>
    h.recurring ? h.holiday_date.slice(5) === dateISO.slice(5) : h.holiday_date === dateISO,
  );
}

/** YYYY-MM-DD de hoje (local) — usado pra nunca apurar déficit no futuro. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Soma 1 dia a um YYYY-MM-DD (sem fuso). */
function addDay(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function useMonthlyClosing(from: string, to: string) {
  const { data: employees = [], isLoading: empLoading } = useEmployees();
  const { data: schedules = [] } = useWorkSchedules();
  const { data: holidays = [] } = useHolidays();
  const { data: records = [], isLoading: recLoading } = useTimeRecords(undefined, from, to);
  const { data: benefits } = useBenefitsConfig();
  const { data: movements = [] } = useBankHoursMovements(undefined, { from, to });
  const { data: absences = [] } = useAbsences({ from, to });

  const monthlyHours = benefits?.monthly_hours || 220;

  const defaultSchedule = useMemo(
    () => schedules.find(s => s.is_default) || schedules[0] || FALLBACK_SCHEDULE,
    [schedules],
  );

  const { rows, totals } = useMemo(() => {
    // Agrupa registros de ponto por funcionário (match por matrícula/nome).
    const recordsByEmp = new Map<string, typeof records>();
    for (const r of records) {
      const emp = findEmployeeMatch(employees, r.employee_name, r.employee_external_id, { linkedOnly: true });
      if (!emp) continue;
      const arr = recordsByEmp.get(emp.id) || [];
      arr.push(r);
      recordsByEmp.set(emp.id, arr);
    }

    // Lançamentos manuais de banco de horas por funcionário (informativo).
    const bankByEmp = new Map<string, number>();
    for (const m of movements) {
      bankByEmp.set(m.employee_id, (bankByEmp.get(m.employee_id) || 0) + Number(m.minutes || 0));
    }

    // Dias de ausência justificada (atestado/férias/folga/etc) por funcionário.
    // Esses dias NÃO contam como falta — são neutros na apuração.
    const absenceDaysByEmp = new Map<string, Set<string>>();
    for (const a of absences) {
      const set = absenceDaysByEmp.get(a.employee_id) || new Set<string>();
      let cur = a.start_date;
      // guard de segurança contra range invertido/aberto
      for (let i = 0; i < 400 && cur <= a.end_date; i++) {
        set.add(cur);
        cur = addDay(cur);
      }
      absenceDaysByEmp.set(a.employee_id, set);
    }

    // Limite superior de apuração: nunca conta déficit de dias futuros (sem ponto
    // porque ainda não aconteceram). Espelha a decisão de apurar só o período real.
    const today = todayISO();

    const out: MonthlyClosingRow[] = [];

    for (const emp of employees.filter(e => e.active)) {
      const sched = schedules.find(s => s.id === emp.work_schedule_id) || defaultSchedule;

      // Janela efetiva do funcionário: [max(from, admissão), min(to, hoje, demissão)].
      const effFrom = emp.admission_date && emp.admission_date > from ? emp.admission_date : from;
      let effTo = to < today ? to : today;
      if (emp.termination_date && emp.termination_date < effTo) effTo = emp.termination_date;

      const empRecords = (recordsByEmp.get(emp.id) || []).filter(
        r => r.record_date >= effFrom && r.record_date <= effTo,
      );
      const recordDates = new Set(empRecords.map(r => r.record_date));
      const absenceSet = absenceDaysByEmp.get(emp.id) || new Set<string>();

      // Dias com ponto → vira WeeklyCalcDay normal.
      const days: WeeklyCalcDay[] = empRecords.map(r => {
        const d = new Date(r.record_date + 'T12:00:00');
        const dow = d.getDay();
        const isHol = isHolidayOn(holidays, r.record_date);
        const punches = (r.punches as string[]) || [];
        const s = calculateDaySummary(punches, dow, sched, isHol);
        return {
          date: r.record_date,
          dayOfWeek: dow,
          workedMinutes: s.workedMinutes,
          expectedMinutes: s.expectedMinutes,
          overtimeMinutes: 0,
          isHoliday: isHol,
          isAbsent: s.isAbsent,
          status: s.status,
          punches,
        };
      });

      // Dias úteis esperados SEM ponto e SEM ausência justificada → falta (déficit).
      // Decisão do usuário (auditoria 2026-05-30): dia útil sem batida conta como
      // hora a menos, mas SÓ dentro do período real (effFrom..effTo) — nunca futuro.
      let missingDays = 0;
      for (let cur = effFrom; cur <= effTo; cur = addDay(cur)) {
        if (recordDates.has(cur)) continue;        // já tem ponto
        if (absenceSet.has(cur)) continue;          // ausência justificada = neutro
        const d = new Date(cur + 'T12:00:00');
        const dow = d.getDay();
        const isHol = isHolidayOn(holidays, cur);
        // calculateDaySummary com punches vazio devolve o expected do dia (0 em
        // fim de semana/feriado), então só dias úteis geram déficit.
        const s = calculateDaySummary([], dow, sched, isHol);
        if (s.expectedMinutes <= 0) continue;
        missingDays++;
        days.push({
          date: cur,
          dayOfWeek: dow,
          workedMinutes: 0,
          expectedMinutes: s.expectedMinutes,
          overtimeMinutes: 0,
          isHoliday: isHol,
          isAbsent: true,
          status: 'absent',
          punches: [],
        });
      }

      const period = calculateWeeklyPeriod(days, sched);
      const overtimeMin = period.totalOvertimeMinutes;
      const deficitMin = period.totalDeficitMinutes;
      const daysWithRecords = empRecords.length;

      // Taxas. otHourRate espelha OvertimeResolutionPanel (hourly_rate ?? salário/divisor).
      const salary = Number((emp as any).salary) || 0;
      const normalHourRate = monthlyHours > 0 ? salary / monthlyHours : 0;
      const otHourRate = Number((emp as any).hourly_rate ?? normalHourRate) || normalHourRate;
      const overtimeMultiplier = Number((emp as any).overtime_multiplier ?? 1.2) || 1.2;

      const overtimeValue = (overtimeMin / 60) * otHourRate * overtimeMultiplier;
      const deficitValue = (deficitMin / 60) * normalHourRate;

      let status: ClosingStatus;
      if (daysWithRecords === 0 && missingDays === 0) status = 'sem_ponto';
      else if (overtimeMin > 0 && deficitMin > 0) status = 'misto';
      else if (overtimeMin > 0) status = 'extra';
      else if (deficitMin > 0) status = 'devedor';
      else status = 'em_dia';

      out.push({
        employeeId: emp.id,
        name: emp.name,
        department: emp.department || '—',
        scheduleName: sched.name,
        weeklyHours: sched.weekly_hours || 44,
        workedMin: period.totalWorkedMinutes,
        expectedMin: period.totalExpectedMinutes,
        overtimeMin,
        deficitMin,
        netMin: overtimeMin - deficitMin,
        absences: period.totalAbsences,
        incompleteDays: period.totalIncomplete,
        holidaysWorked: period.totalHolidaysWorked,
        daysWithRecords,
        missingDays,
        normalHourRate,
        otHourRate,
        overtimeMultiplier,
        overtimeValue,
        deficitValue,
        bankMovementsMin: bankByEmp.get(emp.id) || 0,
        status,
        weeks: period.weeks,
      });
    }

    // Ordena: maior impacto financeiro primeiro (HE + desconto), depois nome.
    out.sort((a, b) => {
      const impactA = a.overtimeValue + a.deficitValue;
      const impactB = b.overtimeValue + b.deficitValue;
      if (impactB !== impactA) return impactB - impactA;
      return a.name.localeCompare(b.name);
    });

    const totals: MonthlyClosingTotals = {
      employees: out.length,
      withOvertime: out.filter(r => r.overtimeMin > 0).length,
      withDeficit: out.filter(r => r.deficitMin > 0).length,
      balanced: out.filter(r => r.status === 'em_dia').length,
      withoutRecords: out.filter(r => r.status === 'sem_ponto').length,
      overtimeMin: out.reduce((s, r) => s + r.overtimeMin, 0),
      deficitMin: out.reduce((s, r) => s + r.deficitMin, 0),
      overtimeValue: out.reduce((s, r) => s + r.overtimeValue, 0),
      deficitValue: out.reduce((s, r) => s + r.deficitValue, 0),
      netValue: out.reduce((s, r) => s + (r.overtimeValue - r.deficitValue), 0),
    };

    return { rows: out, totals };
  }, [employees, schedules, holidays, records, movements, absences, monthlyHours, defaultSchedule]);

  return { rows, totals, isLoading: empLoading || recLoading };
}

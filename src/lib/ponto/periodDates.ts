import { getDaysInRange } from '../salaryPayroll';

type HolidayRow = {
  holiday_date: string;
  recurring?: boolean | null;
  optional?: boolean | null;
  /**
   * Dia útil EXCEPCIONAL da fábrica (sábado em que se trabalha), não feriado.
   * Mora na mesma tabela desde 11/08/2026 — ver o filtro em resolveHolidaysInRange.
   */
  is_working_day?: boolean | null;
};

export type AbsenceRow = {
  employee_id: string;
  start_date: string;
  end_date: string;
  absence_type?: string | null;
  /** Ausência remunerada. `false` nunca pode abonar a folha. */
  paid?: boolean | null;
  /** Compatibilidade com o cadastro legado de justificativas. */
  justified?: boolean | null;
  /** NULL = dia inteiro; valor positivo = quantidade de horas abonadas por dia. */
  hours_per_day?: number | null;
};

export interface AbsenceCreditsByEmployee {
  /** Ausências remuneradas de dia inteiro. */
  fullDayDates: Map<string, Set<string>>;
  /** Ausências remuneradas parciais, em minutos por data. */
  partialMinutes: Map<string, Map<string, number>>;
}

const UNPAID_ABSENCE_TYPES = new Set(['falta_injustificada', 'suspensao']);

function isPaidExcusedAbsence(absence: AbsenceRow): boolean {
  const type = String(absence.absence_type || '').trim().toLowerCase();
  // `paid`/`justified` surgiram depois da tabela original. Valores ausentes
  // preservam o comportamento dos atestados legados. No cadastro moderno,
  // `paid` é a fonte financeira e vence o `justified` legado (que pode continuar
  // false em linhas criadas pela tela nova); nos legados sem `paid`, vale a flag
  // antiga. Tipos intrinsecamente não remunerados nunca abonam.
  if (UNPAID_ABSENCE_TYPES.has(type) || absence.paid === false) return false;
  if (absence.paid === true) return true;
  return absence.justified !== false;
}

/** Resolve os feriados efetivos do intervalo, expandindo os recorrentes por ano. */
export function resolveHolidaysInRange(
  holidays: HolidayRow[],
  from: string,
  to: string,
): Set<string> {
  const resolved = new Set<string>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return resolved;

  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  for (const holiday of holidays || []) {
    if (holiday.optional === true) continue;
    // ⚠ Gargalo da FOLHA: Payroll, Timesheet, EspelhoPonto e os relatórios de
    // faltas/atrasos leem feriado por aqui. Desde 11/08/2026 a tabela `holidays`
    // guarda também o DIA ÚTIL EXCEPCIONAL da fábrica (sábado trabalhado), que
    // tem sinal OPOSTO — deixá-lo passar marcaria o dia como feriado no espelho
    // de ponto e geraria hora extra fantasma.
    if (holiday.is_working_day === true) continue;
    const holidayDate = String(holiday.holiday_date || '').slice(0, 10);
    if (!holiday.recurring) {
      if (holidayDate >= from && holidayDate <= to) resolved.add(holidayDate);
      continue;
    }

    const month = Number(holidayDate.slice(5, 7));
    const day = Number(holidayDate.slice(8, 10));
    if (!month || !day) continue;
    for (let year = fromYear; year <= toYear; year++) {
      const date = new Date(Date.UTC(year, month - 1, day));
      // 29/02 não existe em anos não bissextos; Date.UTC o normalizaria para março.
      if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dateStr >= from && dateStr <= to) resolved.add(dateStr);
    }
  }
  return resolved;
}

/**
 * Feriados necessários ao cálculo da folha: inclui os meses completos do intervalo,
 * porque o divisor de falta/atraso conta todos os dias úteis do mês.
 */
export function resolveHolidaysForPayrollRange(
  holidays: HolidayRow[],
  from: string,
  to: string,
): Set<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return new Set<string>();
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  if (!endYear || !endMonth) return new Set<string>();
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return resolveHolidaysInRange(
    holidays,
    `${from.slice(0, 7)}-01`,
    `${to.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`,
  );
}

/**
 * Expande apenas ausências REMUNERADAS/JUSTIFICADAS que cruzam o intervalo.
 *
 * Dia inteiro e crédito parcial ficam separados para impedir que
 * `hours_per_day=4`, por exemplo, quite uma jornada inteira de 9h. Ausências
 * sobrepostas somam os minutos parciais; o motor salarial limita o crédito à
 * defasagem real do dia, portanto o abono nunca cria hora extra artificial.
 */
export function expandAbsenceCreditsByEmployee(
  absences: AbsenceRow[],
  from: string,
  to: string,
): AbsenceCreditsByEmployee {
  const fullDayDates = new Map<string, Set<string>>();
  const partialMinutes = new Map<string, Map<string, number>>();
  if (!from || !to || from > to) return { fullDayDates, partialMinutes };

  for (const absence of absences || []) {
    if (!absence.employee_id || !absence.start_date || !absence.end_date) continue;
    if (!isPaidExcusedAbsence(absence)) continue;
    const start = absence.start_date > from ? absence.start_date : from;
    const end = absence.end_date < to ? absence.end_date : to;
    if (start > end) continue;

    const rawHours = absence.hours_per_day;
    const isFullDay = rawHours == null;
    const minutesPerDay = isFullDay ? 0 : Number(rawHours) * 60;
    if (!isFullDay && (!Number.isFinite(minutesPerDay) || minutesPerDay <= 0)) continue;
    const rangeDays = getDaysInRange(start, end);

    if (isFullDay) {
      const dates = fullDayDates.get(absence.employee_id) || new Set<string>();
      for (const day of rangeDays) dates.add(day.date);
      fullDayDates.set(absence.employee_id, dates);
      // Um abono integral sempre vence eventuais linhas parciais sobrepostas.
      const partial = partialMinutes.get(absence.employee_id);
      if (partial) for (const day of rangeDays) partial.delete(day.date);
      continue;
    }

    const dates = partialMinutes.get(absence.employee_id) || new Map<string, number>();
    const fullDates = fullDayDates.get(absence.employee_id);
    for (const day of rangeDays) {
      if (fullDates?.has(day.date)) continue;
      dates.set(day.date, (dates.get(day.date) || 0) + minutesPerDay);
    }
    if (dates.size > 0) partialMinutes.set(absence.employee_id, dates);
  }
  return { fullDayDates, partialMinutes };
}

/**
 * Compatibilidade com consumidores que só entendem abono integral. Ausências
 * não pagas e parciais são deliberadamente excluídas para nunca virarem um dia
 * inteiro remunerado por aproximação.
 */
export function expandAbsenceDatesByEmployee(
  absences: AbsenceRow[],
  from: string,
  to: string,
): Map<string, Set<string>> {
  return expandAbsenceCreditsByEmployee(absences, from, to).fullDayDates;
}

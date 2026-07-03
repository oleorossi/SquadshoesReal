/**
 * Absenteísmo — cálculo CANÔNICO (fonte única pras 3 telas de RH: PainelRH,
 * KPIsRH e AbsenceReport). Antes cada tela usava fonte + divisor diferentes
 * (payroll_runs vs employee_absences; dias corridos vs dias úteis), então os
 * três números não batiam. Ver docs/AUDITORIA_RH_COMPATIBILIDADE.md (item A4).
 *
 * Decisão do usuário (2026-07-03):
 *  - Fonte única = `employee_absences` (registro tipado de ausências).
 *  - Taxa = dias ÚTEIS de ausência (TODOS os tipos, inclui férias/licenças)
 *    ÷ (dias úteis do período × headcount ativo) × 100.
 *  - "Dia útil" = seg–sex, excluindo feriados OBRIGATÓRIOS (optional !== true).
 *  - Os dias de cada ausência são recortados na janela consultada [from,to]
 *    (uma ausência que atravessa a borda conta só a parte dentro do período).
 */

export interface AbsenceInterval {
  start_date: string; // 'YYYY-MM-DD'
  end_date: string;   // 'YYYY-MM-DD'
}

/** 'YYYY-MM-DD' local, sem drift de timezone (evita toISOString/UTC). */
function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Dias úteis (seg–sex, exceto feriados obrigatórios) no intervalo [from,to] inclusivo. */
export function businessDaysInPeriod(from: string, to: string, holidays: Set<string> = new Set()): number {
  if (!from || !to || from > to) return 0;
  let count = 0;
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(fmtLocal(cur))) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Dias úteis de UMA ausência dentro da janela [from,to] (interseção recortada).
 * Ex.: férias 28/06–05/07 consultada em julho conta só os dias úteis de 01–05/07.
 */
export function absenceBusinessDays(
  a: AbsenceInterval,
  from: string,
  to: string,
  holidays: Set<string> = new Set(),
): number {
  if (!a?.start_date || !a?.end_date) return 0;
  const start = a.start_date > from ? a.start_date : from;
  const end = a.end_date < to ? a.end_date : to;
  return businessDaysInPeriod(start, end, holidays);
}

/** Soma de dias úteis de ausência de uma lista, recortada em [from,to]. */
export function sumAbsenceBusinessDays(
  list: AbsenceInterval[],
  from: string,
  to: string,
  holidays: Set<string> = new Set(),
): number {
  return (list || []).reduce((s, a) => s + absenceBusinessDays(a, from, to, holidays), 0);
}

/**
 * Taxa de absenteísmo % = dias úteis de ausência ÷ (dias úteis do período ×
 * headcount ativo) × 100. Retorna 0 quando o denominador é 0.
 */
export function absenteeismRate(
  absenceBizDays: number,
  businessDays: number,
  headcount: number,
): number {
  const denom = businessDays * Math.max(1, headcount);
  return denom > 0 ? (absenceBizDays / denom) * 100 : 0;
}

/** Set de feriados OBRIGATÓRIOS (optional !== true) a partir da lista de useHolidays. */
export function mandatoryHolidaySet(holidaysList: Array<{ holiday_date: string; optional?: boolean }>): Set<string> {
  return new Set((holidaysList || []).filter(h => h.optional !== true).map(h => h.holiday_date));
}

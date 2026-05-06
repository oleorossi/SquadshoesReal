/**
 * Unified weekly-based time control calculation.
 *
 * CLT 44h logic:
 * 1. Group days into ISO weeks (Mon–Sun).
 * 2. For each week, sum worked minutes and expected minutes.
 * 3. Overtime = max(0, weekWorked − weekExpected) per week.
 * 4. Deficit  = max(0, weekExpected − weekWorked) per week.
 * 5. Aggregate across all weeks for the period.
 *
 * This module is the SINGLE SOURCE OF TRUTH for overtime/deficit.
 * All views (Overview, Reports, Timesheet, Print) must use it.
 */

/** Minimal day shape required for weekly calculation */
export interface WeeklyCalcDay {
  date: string;
  dayOfWeek: number;
  workedMinutes: number;
  expectedMinutes: number;
  overtimeMinutes: number;
  isHoliday: boolean;
  isAbsent: boolean;
  status: string;
  punches: string[];
}

// ── Types ──────────────────────────────────────────────

export interface WeekSummary {
  weekLabel: string; // e.g. "2025-W03"
  startDate: string;
  endDate: string;
  workedMinutes: number;
  expectedMinutes: number;
  overtimeMinutes: number;
  deficitMinutes: number;
  days: WeeklyCalcDay[];
}

export interface PeriodSummary {
  weeks: WeekSummary[];
  totalWorkedMinutes: number;
  totalExpectedMinutes: number;
  totalOvertimeMinutes: number;
  totalDeficitMinutes: number;
  totalAbsences: number;
  totalIncomplete: number;
  totalHolidaysWorked: number;
}

// ── Helpers ────────────────────────────────────────────

/** ISO week number (Mon=1) */
function getISOWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay() || 7; // Mon=1 … Sun=7
  d.setDate(d.getDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Get the Monday of the ISO week for a given date */
function getWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

/** Get the Sunday of the ISO week for a given date */
function getWeekSunday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + (7 - day));
  return d.toISOString().slice(0, 10);
}

// ── Core calculation ───────────────────────────────────

/**
 * Given an array of DaySummary (already computed with calculateDaySummary),
 * group them into ISO weeks and compute weekly overtime/deficit.
 *
 * The DaySummary.overtimeMinutes from per-day calculation is IGNORED.
 * Overtime is recalculated at the week level.
 */
export function calculateWeeklyPeriod(
  days: WeeklyCalcDay[],
  schedule: { tolerance_minutes?: number; weekly_hours?: number; minimum_overtime_minutes?: number },
): PeriodSummary {
  if (days.length === 0) {
    return {
      weeks: [],
      totalWorkedMinutes: 0,
      totalExpectedMinutes: 0,
      totalOvertimeMinutes: 0,
      totalDeficitMinutes: 0,
      totalAbsences: 0,
      totalIncomplete: 0,
      totalHolidaysWorked: 0,
    };
  }

  // Group days by ISO week
  const weekMap = new Map<string, WeeklyCalcDay[]>();
  for (const day of days) {
    const wk = getISOWeekKey(day.date);
    if (!weekMap.has(wk)) weekMap.set(wk, []);
    weekMap.get(wk)!.push(day);
  }

  const tolerance = schedule.tolerance_minutes || 10;
  const minimumOT = schedule.minimum_overtime_minutes || 0;
  const weeks: WeekSummary[] = [];

  // Sort weeks chronologically
  const sortedKeys = [...weekMap.keys()].sort();

  for (const wk of sortedKeys) {
    const wkDays = weekMap.get(wk)!;
    wkDays.sort((a, b) => a.date.localeCompare(b.date));

    const workedMinutes = wkDays.reduce((s, d) => s + d.workedMinutes, 0);
    const expectedMinutes = wkDays.reduce((s, d) => s + d.expectedMinutes, 0);

    const rawOvertime = workedMinutes > expectedMinutes + tolerance
      ? workedMinutes - expectedMinutes
      : 0;
    // Only count overtime if it meets the minimum threshold
    const weeklyOvertime = rawOvertime >= minimumOT ? rawOvertime : 0;
    const deficitMinutes = expectedMinutes > workedMinutes + tolerance
      ? expectedMinutes - workedMinutes
      : 0;

    // Redistribute weekly overtime back to individual days for display.
    // Walk through the week accumulating worked vs expected;
    // once the cumulative worked exceeds the weekly expected, the excess is overtime.
    // Use the same delta formula as the weekly total (no tolerance subtracted from amount)
    // so that the sum of day.overtimeMinutes equals weeklyOvertime.
    if (weeklyOvertime > 0) {
      let cumWorked = 0;
      let cumExpected = 0;
      for (const day of wkDays) {
        cumExpected += day.expectedMinutes;
        const prevCumWorked = cumWorked;
        cumWorked += day.workedMinutes;
        if (cumWorked > cumExpected + tolerance) {
          // This day contributes to overtime — use full delta (no tolerance subtraction)
          const prevExcess = Math.max(0, prevCumWorked - cumExpected);
          const currentExcess = cumWorked - cumExpected;
          day.overtimeMinutes = Math.max(0, currentExcess - prevExcess);
        } else {
          day.overtimeMinutes = 0;
        }
      }
    } else {
      for (const day of wkDays) {
        day.overtimeMinutes = 0;
      }
    }

    weeks.push({
      weekLabel: wk,
      startDate: getWeekMonday(wkDays[0].date),
      endDate: getWeekSunday(wkDays[wkDays.length - 1].date),
      workedMinutes,
      expectedMinutes,
      overtimeMinutes: weeklyOvertime,
      deficitMinutes,
      days: wkDays,
    });
  }

  return {
    weeks,
    totalWorkedMinutes: weeks.reduce((s, w) => s + w.workedMinutes, 0),
    totalExpectedMinutes: weeks.reduce((s, w) => s + w.expectedMinutes, 0),
    totalOvertimeMinutes: weeks.reduce((s, w) => s + w.overtimeMinutes, 0),
    totalDeficitMinutes: weeks.reduce((s, w) => s + w.deficitMinutes, 0),
    totalAbsences: days.filter(d => d.isAbsent).length,
    totalIncomplete: days.filter(d => d.status === 'incomplete').length,
    totalHolidaysWorked: days.filter(d => d.isHoliday && d.workedMinutes > 0).length,
  };
}

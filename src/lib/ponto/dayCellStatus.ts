/**
 * Status de uma célula da grade Ajustar (mês × pessoa).
 * Fonte única pra filtro e marca visual — espelha pendência de batida + virada + ausência.
 */
import { threePunchesStayPending } from '@/lib/ponto/interpretDayPunches';
import { detectOvernightCarries } from '@/lib/ponto/overnightPunches';

export type DayCellStatus = 'ok' | 'needs_fix' | 'justified' | 'empty' | 'out_of_scope';

export type DayCellFilter = 'all' | 'needs_fix' | 'ok';

function cleanPunch(raw: string): string {
  return String(raw || '').replace(/[^\d:]/g, '');
}

function validPunchCount(punches: string[]): number {
  return (punches || []).filter(p => {
    const clean = cleanPunch(p);
    const [h, m] = clean.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }).length;
}

/** Dia com batidas irregulares (ímpar, 1 batida, 3 ainda sem saída final). */
export function punchesNeedFix(punches: string[]): boolean {
  const n = validPunchCount(punches);
  if (n === 0) return false;
  if (n === 1) return true;
  if (n === 3) return threePunchesStayPending(punches);
  if (n % 2 === 1) return true;
  return false;
}

export interface ClassifyDayCellInput {
  punches: string[];
  hasAbsence: boolean;
  /** Este dia é o workDate de uma virada detectada e ainda não persistida. */
  overnightPending: boolean;
  /** Escala espera trabalho neste dia civil. */
  expectsWork: boolean;
  withinEmployment: boolean;
  isFuture: boolean;
}

export function classifyDayCell(input: ClassifyDayCellInput): DayCellStatus {
  if (!input.withinEmployment || input.isFuture) return 'out_of_scope';
  if (input.hasAbsence) return 'justified';
  if (input.overnightPending) return 'needs_fix';
  const n = validPunchCount(input.punches);
  if (n === 0) {
    return input.expectsWork ? 'needs_fix' : 'empty';
  }
  if (punchesNeedFix(input.punches)) return 'needs_fix';
  return 'ok';
}

/**
 * Mapa employeeId → datas (workDate) com virada detectada ainda não aplicada.
 */
export function overnightPendingDatesByEmployee(
  punchesByEmployeeDate: Map<string, Map<string, string[]>>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [employeeId, byDate] of punchesByEmployeeDate) {
    const carries = detectOvernightCarries(byDate);
    if (carries.length === 0) continue;
    const set = new Set<string>();
    for (const c of carries) set.add(c.workDate);
    out.set(employeeId, set);
  }
  return out;
}

export function rowHasNeedsFix(statuses: DayCellStatus[]): boolean {
  return statuses.some(s => s === 'needs_fix');
}

export function rowIsAllSettled(statuses: DayCellStatus[]): boolean {
  return !statuses.some(s => s === 'needs_fix');
}

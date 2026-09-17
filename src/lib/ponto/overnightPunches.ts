/**
 * Virada à noite — batida de saída após meia-noite.
 *
 * O relógio grava a saída na data civil seguinte (ex.: entrada 08:14 no dia D e
 * saída 03:04 no dia D+1). Sem tratamento:
 *  1. D fica incompleto / pendente;
 *  2. D+1 vira "entrada" solta ou jornada fantasma se houver outras batidas;
 *  3. o sort cronológico de `splitDayMinutes` transforma `['08:14','03:04']` em
 *     manhã 03:04→08:14 em vez de virada 08:14→03:04(+1d).
 *
 * Este módulo:
 *  - detecta e carrega batidas de madrugada (D+1 → D) quando D precisa de saída;
 *  - ordena minutos de intervalo com saída de virada em +1440.
 *
 * Folga/Troca de Dia NÃO são o caminho: com falta-como-horas-v3 o descanso no
 * dia seguinte entra como débito de horas e já compensa a HE da noite.
 */

/** Fim do período noturno convencional (CLT 22h–5h). Saídas < 05:00 são virada. */
export const OVERNIGHT_DAWN_CUTOFF_MIN = 5 * 60;

export interface OvernightCarry {
  workDate: string;
  nextDate: string;
  /** Batidas de madrugada movidas de nextDate → workDate (ordem original). */
  carriedPunches: string[];
  /** Batidas que permanecem em nextDate. */
  remainingNextPunches: string[];
  workPunchesBefore: string[];
  workPunchesAfter: string[];
}

function cleanPunch(raw: string): string {
  return String(raw || '').replace(/[^\d:]/g, '');
}

export function punchToMinutes(raw: string): number {
  const clean = cleanPunch(raw);
  const [h, m] = clean.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function isValidPunch(raw: string): boolean {
  const clean = cleanPunch(raw);
  const [h, m] = clean.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function addCalendarDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Dia "precisa de saída de virada": ímpar, 1 batida, ou n=3 ainda sem saída final
 * (última batida ainda na janela de almoço — espelha interpretThreePunches).
 */
export function dayNeedsOvernightExit(punches: string[]): boolean {
  const valid = (punches || []).filter(isValidPunch);
  const n = valid.length;
  if (n === 0) return false;
  if (n === 1) return true;
  if (n % 2 === 1 && n !== 3) return true;
  if (n !== 3) return false;
  const last = punchToMinutes(valid[valid.length - 1]);
  // n=3 com última ≤ 16:00 ainda parece "volta do almoço", não saída final.
  return last <= 16 * 60;
}

/** Prefixo de madrugada (< 05:00) na ordem original do relógio. */
export function takeDawnPrefix(punches: string[]): { dawn: string[]; rest: string[] } {
  const dawn: string[] = [];
  const rest: string[] = [];
  let inPrefix = true;
  for (const punch of punches || []) {
    if (!isValidPunch(punch)) {
      if (inPrefix) dawn.push(punch);
      else rest.push(punch);
      continue;
    }
    if (inPrefix && punchToMinutes(punch) < OVERNIGHT_DAWN_CUTOFF_MIN) {
      dawn.push(punch);
      continue;
    }
    inPrefix = false;
    rest.push(punch);
  }
  return { dawn, rest };
}

/**
 * Minutos para parear intervalos. Saída(s) de virada no fim da lista original
 * (relógio) ganham +1440 para o sort não invertê-las pra manhã.
 *
 * Ex.: ['08:14','03:04'] → [494, 1634] → intervalo 08:14→03:04(+1).
 */
export function orderPunchMinutesForIntervals(punches: string[]): number[] {
  const raw = (punches || []).filter(isValidPunch).map(punchToMinutes);
  if (raw.length < 2) return [...raw].sort((a, b) => a - b);

  const adjusted = [...raw];
  // Só a cauda: batida final de madrugada gravada DEPOIS de uma batida diurna.
  let i = adjusted.length - 1;
  while (i > 0) {
    const cur = adjusted[i];
    const prev = adjusted[i - 1];
    if (cur < OVERNIGHT_DAWN_CUTOFF_MIN && cur < prev) {
      adjusted[i] = cur + 1440;
      i -= 1;
      // Uma saída de virada por jornada é o caso real; para se houver mais.
      break;
    }
    break;
  }
  return adjusted.sort((a, b) => a - b);
}

/**
 * Detecta pares (D, D+1) em que a madrugada de D+1 completa a saída de D.
 * Não grava nada — devolve o plano pra UI / motor.
 */
export function detectOvernightCarries(
  punchesByDate: Map<string, string[]>,
): OvernightCarry[] {
  const carries: OvernightCarry[] = [];
  const dates = [...punchesByDate.keys()].sort();
  for (const workDate of dates) {
    const nextDate = addCalendarDays(workDate, 1);
    const workPunches = punchesByDate.get(workDate) || [];
    const nextPunches = punchesByDate.get(nextDate) || [];
    if (!dayNeedsOvernightExit(workPunches)) continue;
    const { dawn, rest } = takeDawnPrefix(nextPunches);
    if (dawn.length === 0) continue;
    carries.push({
      workDate,
      nextDate,
      carriedPunches: dawn,
      remainingNextPunches: rest,
      workPunchesBefore: [...workPunches],
      workPunchesAfter: [...workPunches, ...dawn],
    });
  }
  return carries;
}

/**
 * Aplica o carregamento de virada em memória (folha/espelho). Idempotente.
 */
export function applyOvernightCarry(
  punchesByDate: Map<string, string[]>,
): { punchesByDate: Map<string, string[]>; carries: OvernightCarry[] } {
  const carries = detectOvernightCarries(punchesByDate);
  if (carries.length === 0) {
    return { punchesByDate, carries };
  }
  const next = new Map<string, string[]>();
  for (const [date, punches] of punchesByDate) next.set(date, [...punches]);

  for (const carry of carries) {
    next.set(carry.workDate, [...carry.workPunchesAfter]);
    if (carry.remainingNextPunches.length > 0) {
      next.set(carry.nextDate, [...carry.remainingNextPunches]);
    } else {
      next.delete(carry.nextDate);
    }
  }
  return { punchesByDate: next, carries };
}

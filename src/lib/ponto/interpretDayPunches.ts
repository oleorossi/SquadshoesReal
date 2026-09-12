// interpretDayPunches.ts — lê uma lista plana de batidas e diz QUAL marcação
// faltou, quando dá pra inferir com segurança.
//
// Decisão do dono 2026-09-12: 3 batidas em que a ÚLTIMA já é saída de expediente
// (volta ~13h + saída 18h30 / 21h28) NÃO são "falta saída final". A pessoa só
// esqueceu a saída (ou a volta) do almoço. O diário da folha passa a contar a
// tarde e a HE depois das 18h. 1 batida e ímpar ≥5 continuam pendência
// (auditoria RH 2026-07-30 — jornadas de 13h–21h).

export const LUNCH_START_MIN = 12 * 60;
export const LUNCH_END_MIN = 13 * 60;
export const LUNCH_MID_MIN = 12 * 60 + 30;
export const WEEKDAY_EXIT_MIN = 18 * 60;
/** Jornada canônica de dia útil: 08:00–12:00 + 13:00–18:00. */
export const WEEKDAY_JOURNEY_MIN = 9 * 60;

export type ThreePunchKind =
  | 'missing_final_exit'
  | 'missing_lunch_out'
  | 'missing_lunch_return';

export interface ThreePunchInterpretation {
  kind: ThreePunchKind;
  incomplete: boolean;
  intervals: [number, number][];
}

/** 'HH:MM' / 'HH:MM*' → minutos do dia. Fora da faixa → null. */
export function punchToMin(t: string): number | null {
  const clean = String(t).replace(/[^\d:]/g, '');
  const [h, m] = clean.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function sortedPunchMinutes(punches: string[]): number[] | null {
  const mins: number[] = [];
  for (const p of punches) {
    const m = punchToMin(p);
    if (m == null) return null;
    mins.push(m);
  }
  return mins.sort((a, b) => a - b);
}

/**
 * 3 batidas ordenadas. Última ainda na janela de almoço → falta a saída final
 * (pendência). Última depois do almoço → a saída existe; falta a pausa do meio.
 */
export function interpretThreePunches(sortedMinutes: number[]): ThreePunchInterpretation {
  if (sortedMinutes.length !== 3) {
    return { kind: 'missing_final_exit', incomplete: true, intervals: [] };
  }
  const [a, b, c] = sortedMinutes;
  if (c <= LUNCH_END_MIN) {
    return { kind: 'missing_final_exit', incomplete: true, intervals: [] };
  }
  if (b >= LUNCH_MID_MIN) {
    const lunchOut = Math.min(LUNCH_START_MIN, b);
    return {
      kind: 'missing_lunch_out',
      incomplete: false,
      intervals: lunchOut > a ? [[a, lunchOut], [b, c]] : [[b, c]],
    };
  }
  return {
    kind: 'missing_lunch_return',
    incomplete: false,
    intervals: c > LUNCH_END_MIN ? [[a, b], [LUNCH_END_MIN, c]] : [[a, b]],
  };
}

export function interpretDayPunches(punches: string[]): ThreePunchInterpretation | null {
  const mins = sortedPunchMinutes(punches || []);
  if (!mins || mins.length !== 3) return null;
  return interpretThreePunches(mins);
}

/**
 * Sábado (fora da escala) que MESMO ASSIM parece jornada de dia útil:
 * entrou de manhã e saiu às 18h ou depois. HE = só o excedente das 9h, não o
 * dia inteiro (caso 22/08: 08:01→18:25 não é +9h24 de extra). Domingo e
 * feriado continuam crédito integral (folga trabalhada).
 */
export function looksLikeWeekdayJourney(punches: string[]): boolean {
  const mins = sortedPunchMinutes(punches || []);
  if (!mins || mins.length < 2) return false;
  const first = mins[0];
  const last = mins[mins.length - 1];
  return first < LUNCH_START_MIN && last >= WEEKDAY_EXIT_MIN;
}

export function threePunchesStayPending(punches: string[]): boolean {
  const interp = interpretDayPunches(punches);
  return !interp || interp.incomplete;
}

export interface NamedPunchSlots {
  entrada: string;
  saidaAlmoco: string;
  voltaAlmoco: string;
  saida: string;
}

/**
 * 3 batidas nos slots nomeados do lançamento manual. Sem isto a UI posicional
 * joga a saída real em "Volta almoço" e o RH acrescenta 18:00 em cima.
 */
export function mapThreePunchesToNamedSlots(punches: string[]): NamedPunchSlots | null {
  const interp = interpretDayPunches(punches);
  if (!interp) return null;
  const mins = sortedPunchMinutes(punches);
  if (!mins) return null;
  const sorted = [...punches].sort((a, b) => (punchToMin(a) ?? 0) - (punchToMin(b) ?? 0));
  const [p1, p2, p3] = sorted;
  if (interp.kind === 'missing_lunch_out') {
    return { entrada: p1, saidaAlmoco: '', voltaAlmoco: p2, saida: p3 };
  }
  if (interp.kind === 'missing_lunch_return') {
    return { entrada: p1, saidaAlmoco: p2, voltaAlmoco: '', saida: p3 };
  }
  return { entrada: p1, saidaAlmoco: p2, voltaAlmoco: p3, saida: '' };
}

/** Só sugere 18:00 quando a última batida ainda não é a saída do expediente. */
export function shouldSuggestFinalExit(punches: string[]): boolean {
  if ((punches || []).length === 3 && !threePunchesStayPending(punches)) return false;
  return true;
}

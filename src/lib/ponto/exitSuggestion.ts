// exitSuggestion.ts — sugestão de horário de SAÍDA pra Pendências de Ponto.
//
// Fonte canônica = escala contratada (`work_schedules.exit_time` / `saturday_exit`),
// a MESMA jornada esperada que o relatório de horas extras e descontos usa via
// `expectedDayMinutes`. Pré-preencher com a mediana histórica das batidas
// (muitas vezes já com HE) fabricava hora extra ao "Aprovar todas".
//
// O padrão histórico (`computeExitPattern` / `suggestExitTime`) permanece exportado
// só pra diagnóstico/testes — a UI de pendências não o usa mais.

const DEFAULT_EXIT_MIN = 18 * 60; // 18:00 — último recurso (igual ao "padrão 18:00" já existente)

/** 'HH:MM' (ou 'HH:MM*'/aspas) → minutos do dia; null se inválido. */
function toMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm).replace(/[*"]/g, '').trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Dia da semana (0=dom … 6=sáb) de um ISO yyyy-mm-dd, sem deslocamento de timezone. */
export function dowOf(dateISO: string): number {
  const [y, mo, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, (mo || 1) - 1, d || 1)).getUTCDay();
}

const fmt = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export interface ExitPattern {
  byDow: Record<number, number>; // dow → mediana de saída (min), só com ≥2 amostras
  overall: number | null;        // mediana geral
  samples: number;               // total de dias completos analisados
}

export interface ExitSuggestion {
  time: string; // 'HH:MM'
  /** de onde veio (transparência pro RH) */
  source: 'schedule' | 'dow' | 'overall' | 'default';
}

/** Campos mínimos da escala usados pela sugestão (espelha ManualEntryTab / HE). */
export interface ScheduleExitFields {
  exit_time?: string | null;
  saturday_exit?: string | null;
}

/**
 * Saída sugerida = horário contratado do dia (escala).
 * Sábado usa `saturday_exit` quando cadastrado; senão cai em `exit_time`.
 */
export function suggestExitFromSchedule(
  schedule: ScheduleExitFields | null | undefined,
  dateISO: string,
  fallbackMin: number = DEFAULT_EXIT_MIN,
): ExitSuggestion {
  const dw = dowOf(dateISO);
  const raw = dw === 6
    ? (schedule?.saturday_exit || schedule?.exit_time)
    : schedule?.exit_time;
  const min = toMin(String(raw ?? '')) ?? fallbackMin;
  return { time: fmt(min), source: raw ? 'schedule' : 'default' };
}

/** Constrói o padrão de saída a partir do histórico de batidas do funcionário. */
export function computeExitPattern(rows: { record_date: string; punches: string[] }[]): ExitPattern {
  const byDowArr: Record<number, number[]> = {};
  const all: number[] = [];
  for (const r of rows) {
    const p = Array.isArray(r.punches) ? r.punches : [];
    // Dia COMPLETO = par e ≥2 (última batida = saída confiável). Ímpar/1-batida
    // não entra no padrão (são justamente os pendentes).
    if (p.length < 2 || p.length % 2 !== 0) continue;
    const exit = toMin(p[p.length - 1]);
    if (exit == null) continue;
    const dw = dowOf(r.record_date);
    (byDowArr[dw] ||= []).push(exit);
    all.push(exit);
  }
  const byDow: Record<number, number> = {};
  for (const k of Object.keys(byDowArr)) {
    const arr = byDowArr[+k];
    const med = median(arr);
    if (med != null && arr.length >= 2) byDow[+k] = med;
  }
  return { byDow, overall: median(all), samples: all.length };
}

/**
 * @deprecated Preferir `suggestExitFromSchedule` (alinhado ao relatório HE).
 * Mantido pra testes/diagnóstico do padrão histórico.
 */
export function suggestExitTime(
  pattern: ExitPattern,
  dateISO: string,
  fallbackMin: number = DEFAULT_EXIT_MIN,
): ExitSuggestion {
  const dw = dowOf(dateISO);
  if (pattern.byDow[dw] != null) return { time: fmt(pattern.byDow[dw]), source: 'dow' };
  if (pattern.overall != null && pattern.samples >= 3) return { time: fmt(pattern.overall), source: 'overall' };
  return { time: fmt(fallbackMin), source: 'default' };
}

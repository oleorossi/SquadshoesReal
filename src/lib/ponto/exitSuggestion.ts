// exitSuggestion.ts — sugestão de horário de SAÍDA provável a partir do PADRÃO do
// próprio funcionário (não usa LLM): mediana da ÚLTIMA batida em dias completos,
// por dia da semana. Alimenta o pré-preenchimento das Pendências de Ponto pra o
// RH só aprovar (Salvar) ou ajustar — reduz o tempo de fechamento.
//
// Por que mediana da última batida em dia COMPLETO (par, ≥2)? A última batida de um
// dia par é a saída confiável. Mediana é robusta a outliers (um dia que saiu 23h não
// puxa a sugestão). Por dia da semana porque sexta/segunda podem ter padrão diferente.

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
  time: string;                          // 'HH:MM'
  source: 'dow' | 'overall' | 'default'; // de onde veio (transparência pro RH)
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
 * Sugere o horário de saída pra um dia pendente:
 *  1) mediana daquele DIA DA SEMANA (≥2 amostras) → mais fiel ao ritmo dele;
 *  2) senão, mediana GERAL (≥3 dias completos no histórico);
 *  3) senão, 18:00 (último recurso).
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

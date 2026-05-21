/**
 * Day Calculator — implementa as regras do Planejamento de Migração de Ponto (2026-05).
 *
 * Para CADA dia, dado:
 *   - lista de batidas (horários HH:MM)
 *   - dia da semana (0=Dom, 6=Sáb)
 *   - parâmetros (jornada esperada, tolerância)
 *
 * Retorna status + minutos trabalhados/esperados/faltantes + detalhe legível.
 *
 * Os 5 status do plano:
 *   OK           — batidas em número par, jornada calculada normal
 *   INCONSISTENTE — 2 batidas em dia útil (esqueceu de bater almoço)
 *   IRREGULAR    — 1 ou 3 batidas (falha do relógio)
 *   FALTA        — 0 batidas em dia útil (cruzar com atestado/férias)
 *   DSR          — domingo (Descanso Semanal Remunerado, não conta)
 *
 * Regras de tolerância (CLT art. 58 §1º):
 *   Se a diferença entre jornada esperada e trabalhada for ≤ tolerância (default 10min),
 *   o faltante é zerado (não acumula). Tolerância NÃO acumula entre dias.
 *
 * Sábado:
 *   - 2 batidas (sem almoço, 4h contínuas) = OK
 *   - 0 batidas = FALTA
 *   - 1 ou 3 batidas = IRREGULAR
 *   - 4+ batidas = OK
 *
 * Esta lib é PURA — sem I/O, sem dependência de framework. Testes em
 * dayCalculator.test.ts cobrem os casos vindos da planilha modelo.
 */

export type DayStatus = 'OK' | 'INCONSISTENTE' | 'IRREGULAR' | 'FALTA' | 'DSR';

export interface DayCalculatorParams {
  /** Lista de batidas no formato "HH:MM" (ordenadas ou não — função ordena). */
  punches: string[];
  /** 0=Dom, 1=Seg, ..., 6=Sáb (Date.getDay()). */
  dayOfWeek: number;
  /** Minutos esperados pra dia útil (default 480 = 8h). */
  expectedWeekdayMinutes?: number;
  /** Minutos esperados pra sábado (default 240 = 4h). */
  expectedSaturdayMinutes?: number;
  /** Tolerância em minutos (default 10, CLT art. 58 §1º). */
  toleranceMinutes?: number;
}

export interface DayCalculatorResult {
  status: DayStatus;
  /** Minutos efetivamente trabalhados (descontando almoço). */
  workedMinutes: number;
  /** Minutos esperados pra esse dia (0 em domingo, expectedSaturday em sáb, expectedWeekday em útil). */
  expectedMinutes: number;
  /** Minutos faltantes JÁ COM tolerância aplicada (≤ tolerance vira 0). */
  missingMinutes: number;
  /** Texto legível pro espelho de ponto / relatório. */
  detail: string;
  /** Batidas originais ordenadas (pra audit trail). */
  sortedPunches: string[];
}

const DEFAULTS = {
  expectedWeekdayMinutes: 480,   // 8h
  expectedSaturdayMinutes: 240,  // 4h
  toleranceMinutes: 10,
};

/** Converte "HH:MM" pra minutos desde meia-noite. Retorna NaN se inválido. */
export function timeToMinutes(t: string): number {
  if (!t || typeof t !== 'string') return NaN;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return NaN;
  return h * 60 + mm;
}

/** Converte minutos pra string "HH:MM" (00:00 a 99:59). Negativo prefixa "-". */
export function minutesToHhMm(min: number): string {
  const sign = min < 0 ? '-' : '';
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Soma minutos trabalhados em pares de batidas: par1−par0 + par3−par2 + ...
 * Ignora último elemento se número ímpar.
 */
function sumPairs(punchesMin: number[]): number {
  let total = 0;
  for (let i = 0; i + 1 < punchesMin.length; i += 2) {
    const span = punchesMin[i + 1] - punchesMin[i];
    if (span > 0) total += span;
  }
  return total;
}

/**
 * Função principal — calcula o resultado de um dia segundo as regras do plano.
 */
export function calculateDay(params: DayCalculatorParams): DayCalculatorResult {
  const {
    punches,
    dayOfWeek,
    expectedWeekdayMinutes = DEFAULTS.expectedWeekdayMinutes,
    expectedSaturdayMinutes = DEFAULTS.expectedSaturdayMinutes,
    toleranceMinutes = DEFAULTS.toleranceMinutes,
  } = params;

  // Domingo SEMPRE é DSR — sem trabalho esperado.
  if (dayOfWeek === 0) {
    return {
      status: 'DSR',
      workedMinutes: 0,
      expectedMinutes: 0,
      missingMinutes: 0,
      detail: 'Domingo (DSR)',
      sortedPunches: [],
    };
  }

  const isSaturday = dayOfWeek === 6;
  const expected = isSaturday ? expectedSaturdayMinutes : expectedWeekdayMinutes;

  // Normaliza: filtra inválidas, ordena cronologicamente.
  const validPunches = (punches || [])
    .map((p) => ({ raw: p, min: timeToMinutes(p) }))
    .filter((p) => !Number.isNaN(p.min))
    .sort((a, b) => a.min - b.min);

  const sortedPunches = validPunches.map((p) => p.raw);
  const punchesMin = validPunches.map((p) => p.min);
  const count = punchesMin.length;

  // 0 batidas — FALTA (será cruzado com atestado/férias pelo RH).
  if (count === 0) {
    return {
      status: 'FALTA',
      workedMinutes: 0,
      expectedMinutes: expected,
      missingMinutes: expected,
      detail: 'Sem batidas',
      sortedPunches: [],
    };
  }

  // 1 ou 3 batidas — IRREGULAR (falha do relógio).
  if (count === 1 || count === 3) {
    return {
      status: 'IRREGULAR',
      workedMinutes: 0,
      expectedMinutes: expected,
      missingMinutes: expected,
      detail: `${count} batida${count > 1 ? 's' : ''}: ${sortedPunches.join('/')}`,
      sortedPunches,
    };
  }

  // 2 batidas — diverge: sábado=OK (jornada contínua sem almoço), útil=INCONSISTENTE.
  if (count === 2) {
    const worked = punchesMin[1] - punchesMin[0];
    if (isSaturday) {
      const rawMissing = Math.max(0, expected - worked);
      const missing = rawMissing <= toleranceMinutes ? 0 : rawMissing;
      return {
        status: 'OK',
        workedMinutes: worked,
        expectedMinutes: expected,
        missingMinutes: missing,
        detail: sortedPunches.join('/'),
        sortedPunches,
      };
    }
    return {
      status: 'INCONSISTENTE',
      workedMinutes: 0,
      expectedMinutes: expected,
      missingMinutes: expected,
      detail: `2 batidas em dia útil (esqueceu almoço): ${sortedPunches.join('/')}`,
      sortedPunches,
    };
  }

  // 4+ batidas em número par — OK. Aplica tolerância no faltante.
  if (count % 2 === 0) {
    const worked = sumPairs(punchesMin);
    const rawMissing = Math.max(0, expected - worked);
    const missing = rawMissing <= toleranceMinutes ? 0 : rawMissing;
    return {
      status: 'OK',
      workedMinutes: worked,
      expectedMinutes: expected,
      missingMinutes: missing,
      detail: sortedPunches.join('/'),
      sortedPunches,
    };
  }

  // 5, 7, 9... batidas — IRREGULAR (qualquer impar > 1).
  return {
    status: 'IRREGULAR',
    workedMinutes: 0,
    expectedMinutes: expected,
    missingMinutes: expected,
    detail: `${count} batidas (ímpar): ${sortedPunches.join('/')}`,
    sortedPunches,
  };
}

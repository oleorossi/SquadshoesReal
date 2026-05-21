/**
 * Weekly Aggregator — agrupa dias calculados por semana ISO e gera o
 * resumo semanal do plano de migração (aba "Resumo Semanal" do modelo).
 *
 * Saída por (funcionário × semana):
 *   - Esperado / Trabalhado / Faltante (já c/ tolerância) / Saldo (+/-)
 *   - Contagem de dias por status (OK / Falta / Inconsist. / Irregular)
 *   - Sugestão de ação ("Compensar Xh", "Ajustar batidas no RH", "Banco a favor")
 *
 * Padrão da semana: Segunda → Domingo (ISO 8601). Sábado conta na semana
 * que vem antes do domingo subsequente. Pra outra convenção (Dom → Sáb),
 * passar { weekStartsOn: 0 } nos params.
 */

import type { DayCalculatorResult, DayStatus } from './dayCalculator';
import { minutesToHhMm } from './dayCalculator';

export interface WeeklyAggregatorParams {
  /** 0 = domingo, 1 = segunda (default, ISO). Outras semanas não recomendadas. */
  weekStartsOn?: 0 | 1;
}

export interface DayWithDate extends DayCalculatorResult {
  /** YYYY-MM-DD */
  date: string;
}

export interface WeeklySummary {
  /** Primeiro dia da semana (YYYY-MM-DD). */
  weekStart: string;
  /** Último dia da semana (YYYY-MM-DD). */
  weekEnd: string;
  expectedMinutes: number;
  workedMinutes: number;
  missingMinutes: number;
  /** Saldo: positivo = horas extras a favor, negativo = horas devidas. */
  balanceMinutes: number;
  countsByStatus: Record<DayStatus, number>;
  /** Texto pro relatório: "Compensar 04:00", "Banco a favor 02:30", etc. */
  suggestedAction: string;
}

/**
 * Calcula o YYYY-MM-DD do início da semana de uma data, dado weekStartsOn.
 * Trabalha em LOCAL time (evita drift UTC).
 */
function startOfWeek(dateIso: string, weekStartsOn: 0 | 1): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay(); // 0 = Sun
  const diff = (dow - weekStartsOn + 7) % 7;
  date.setDate(date.getDate() - diff);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function emptyStatusCounts(): Record<DayStatus, number> {
  return { OK: 0, INCONSISTENTE: 0, IRREGULAR: 0, FALTA: 0, DSR: 0 };
}

/**
 * Gera a sugestão de ação textual conforme a planilha modelo:
 *   - Tem inconsist/irregular → "Ajustar batidas no RH"
 *   - Saldo positivo > 0 → "Banco a favor +HH:MM"
 *   - Saldo negativo → "Compensar HH:MM"
 *   - Tudo zero → "OK"
 */
function buildSuggestion(s: WeeklySummary): string {
  if (s.countsByStatus.INCONSISTENTE > 0 || s.countsByStatus.IRREGULAR > 0) {
    return 'Ajustar batidas no RH';
  }
  if (s.balanceMinutes > 0) {
    return `Banco a favor +${minutesToHhMm(s.balanceMinutes)}`;
  }
  if (s.balanceMinutes < 0) {
    return `Compensar ${minutesToHhMm(Math.abs(s.balanceMinutes))}`;
  }
  return 'OK';
}

/**
 * Agrupa lista de dias calculados em semanas.
 *
 * Entrada: lista de dias com { date, status, workedMinutes, expectedMinutes,
 *           missingMinutes } — saída do calculateDay para cada dia.
 * Saída: lista de semanas (ordenadas por weekStart) com totais e sugestão.
 */
export function aggregateByWeek(
  days: DayWithDate[],
  params: WeeklyAggregatorParams = {},
): WeeklySummary[] {
  const { weekStartsOn = 1 } = params;
  const byWeek = new Map<string, WeeklySummary>();

  for (const day of days) {
    const wStart = startOfWeek(day.date, weekStartsOn);
    if (!byWeek.has(wStart)) {
      byWeek.set(wStart, {
        weekStart: wStart,
        weekEnd: addDays(wStart, 6),
        expectedMinutes: 0,
        workedMinutes: 0,
        missingMinutes: 0,
        balanceMinutes: 0,
        countsByStatus: emptyStatusCounts(),
        suggestedAction: '',
      });
    }
    const s = byWeek.get(wStart)!;
    s.expectedMinutes += day.expectedMinutes;
    s.workedMinutes += day.workedMinutes;
    s.missingMinutes += day.missingMinutes;
    s.countsByStatus[day.status] = (s.countsByStatus[day.status] || 0) + 1;
  }

  const out = Array.from(byWeek.values()).sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart),
  );

  for (const s of out) {
    s.balanceMinutes = s.workedMinutes - s.expectedMinutes;
    s.suggestedAction = buildSuggestion(s);
  }

  return out;
}

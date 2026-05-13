/**
 * Helpers de data sensíveis a fuso horário.
 *
 * `new Date().toISOString().slice(0,10)` retorna "YYYY-MM-DD" em UTC. Para um
 * cliente em São Paulo (UTC-3), entre 21:00 e 23:59 (horário local), isso retorna
 * o dia SEGUINTE — porque já é 00:00-02:59 do dia seguinte em UTC. Isso quebra:
 *   - filtros "vencendo hoje" (passa a mostrar amanhã)
 *   - `due_date` defaults em formulários
 *   - comparações de prazo
 *
 * Use `todayISO()` em vez de `new Date().toISOString().slice(0,10)` sempre que
 * estiver lidando com data calendário (não timestamp UTC).
 */
import { format, addDays as addDaysFn } from 'date-fns';

/**
 * Retorna a data de HOJE no fuso local do navegador, no formato ISO `YYYY-MM-DD`.
 * Para parsing inverso, use `parseISO(todayISO())` (date-fns).
 */
export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Retorna a data de hoje + N dias no fuso local, no formato `YYYY-MM-DD`.
 */
export function todayPlusDaysISO(days: number): string {
  return format(addDaysFn(new Date(), days), 'yyyy-MM-dd');
}

/**
 * Parseia uma string ISO `YYYY-MM-DD` ou ISO completa de forma robusta, retornando
 * `null` quando o input é vazio/inválido. Diferente de `new Date(iso)`, esta função
 * NÃO retorna `Invalid Date` — retorna `null` pra o caller tratar.
 *
 * Casos cobertos:
 *   - `''` / `null` / `undefined` → `null`
 *   - `'2026-05-13'` → Date com hora 00:00 no fuso local
 *   - `'2026-05-13T10:30:00Z'` → Date UTC convertido pra local
 */
export function safeParseISO(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== 'string') return null;
  const trimmed = iso.trim();
  if (!trimmed) return null;
  // Date-only ISO ('YYYY-MM-DD'): adiciona T00:00:00 pra evitar fuso UTC
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const d = new Date(dateOnly ? `${trimmed}T00:00:00` : trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Formata uma string ISO de forma segura. Retorna fallback (default `—`) quando
 * o input é vazio/inválido — em vez de `Invalid Date` ou `NaT...`.
 *
 * Exemplo:
 *   safeFormatBR('2026-05-13')             → '13/05/2026'
 *   safeFormatBR(null)                     → '—'
 *   safeFormatBR(undefined, '-')           → '-'
 *   safeFormatBR('2026-05-13', undefined, 'dd/MM/yy') → '13/05/26'
 */
export function safeFormatBR(
  iso: string | null | undefined,
  fallback: string = '—',
  pattern: string = 'dd/MM/yyyy',
): string {
  const d = safeParseISO(iso);
  return d ? format(d, pattern) : fallback;
}

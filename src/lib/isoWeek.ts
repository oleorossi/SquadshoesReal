// Helpers de semana ISO 8601 compartilhados entre listagens semanais
// (ondas, pickups, lista de separação).

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export interface ISOWeek {
  year: number;
  week: number;
  monday: Date;
  sunday: Date;
  code: string; // "W2026-19"
}

/**
 * Calcula a semana ISO 8601 de uma data. Usa UTC pra evitar deslocamento por DST.
 * Retorna o código no formato "WYYYY-WW".
 */
export function getISOWeek(d: Date): ISOWeek {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  const original = new Date(d);
  original.setHours(0, 0, 0, 0);
  const dow = original.getDay() || 7;
  const monday = new Date(original);
  monday.setDate(original.getDate() - dow + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const year = date.getUTCFullYear();
  return { year, week, monday, sunday, code: `W${year}-${pad(week)}` };
}

/**
 * Versão direta a partir de string ISO (yyyy-mm-dd).
 * Retorna null se a string for inválida ou vazia.
 */
export function getISOWeekFromString(iso: string | null | undefined): ISOWeek | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return getISOWeek(date);
}

/**
 * Calcula a próxima data ISO (yyyy-mm-dd) com EXTRACT(ISODOW)=target_dow.
 * 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb, 7=Dom.
 * Inclui a própria base se ela cair no dia certo.
 */
export function nextDOW(baseISO: string, targetDow: number): string {
  const [y, m, d] = baseISO.split('-').map(Number);
  if (!y || !m || !d) return baseISO;
  const date = new Date(y, m - 1, d);
  const currentDow = date.getDay() || 7; // 1..7, Seg..Dom
  const diff = (targetDow - currentDow + 7) % 7;
  date.setDate(date.getDate() + diff);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Trava qualquer ISO date pra segunda-feira da MESMA semana ISO.
 * Útil pra normalizar input do WaveBuilder ("Semana começando em").
 */
export function snapToMonday(iso: string): string {
  if (!iso) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const dow = date.getDay() || 7;
  date.setDate(date.getDate() - dow + 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fmtDayMonthBR(d: Date | string): string {
  const date = typeof d === 'string'
    ? (() => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); })()
    : d;
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

export function fmtBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '—';
  return `${d}/${m}/${y.slice(2)}`;
}

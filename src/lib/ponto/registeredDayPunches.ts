/**
 * Batidas já gravadas de um dia — o que o gestor vê antes de completar o que falta.
 *
 * A lista é cronológica e diz a origem (relógio/TXT, manual, ajuste). O
 * pré-preenchimento dos 4 campos usa a mesma leitura de `punchesToNamedSlots`:
 * 1ª=Entrada, 2ª=Saída almoço, 3ª=Volta, 4ª=Saída, com o buraco do par
 * incompleto deixado vazio (3 batidas não jogam a saída real em "Volta").
 *
 * Gravar continua em `upsert_manual_time_record`: horário que já existe no
 * relógio volta com o token original (sem '*'); só horário novo nasce manual.
 * `resolveManualPunchTokens` espelha esse trecho da RPC — os dois têm que
 * concordar.
 */
import { twoPunchesNeedLunchMarks } from '@/lib/ponto/interpretDayPunches';
import {
  PUNCH_SLOT_DEFS,
  emptyPunchSlots,
  punchesToNamedSlots,
  type PunchSlotKey,
  type PunchSlots,
} from '@/lib/ponto/punchSlots';

export type PunchOrigin = 'clock' | 'manual' | 'adjustment';

export interface JourneySchedule {
  entry_time?: string | null;
  lunch_start?: string | null;
  lunch_end?: string | null;
  exit_time?: string | null;
  saturday_entry?: string | null;
  saturday_exit?: string | null;
  works_sunday?: boolean | null;
  works_monday?: boolean | null;
  works_tuesday?: boolean | null;
  works_wednesday?: boolean | null;
  works_thursday?: boolean | null;
  works_friday?: boolean | null;
  works_saturday?: boolean | null;
}

export interface DayPunchContext {
  expectsWork: boolean;
  isHoliday: boolean;
  isSaturday: boolean;
}

export interface PunchOverrideAudit {
  action?: string | null;
  created_at: string;
  created_by?: string | null;
  punches_before?: unknown;
  punches_after?: unknown;
  added_punch?: string | null;
}

export interface RegisteredPunch {
  hhmm: string;
  /** Token gravado ('08:01' ou '08:01*'). */
  raw: string;
  manual: boolean;
  origin: PunchOrigin;
  originLabel: string;
  authorName: string | null;
  whenLabel: string | null;
}

export type RegisteredDayLine =
  | { type: 'punch'; punch: RegisteredPunch }
  | { type: 'gap'; label: string };

const WORKS_KEYS = [
  'works_sunday',
  'works_monday',
  'works_tuesday',
  'works_wednesday',
  'works_thursday',
  'works_friday',
  'works_saturday',
] as const;

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const ORIGIN_LABEL: Record<PunchOrigin, string> = {
  clock: 'Relógio/TXT',
  manual: 'Manual',
  adjustment: 'Ajuste',
};

export function punchHhmm(raw: string): string {
  const clean = String(raw || '').replace(/[*"]/g, '').trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(clean);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function isManualPunchToken(raw: string): boolean {
  return String(raw || '').includes('*');
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function shiftIsoDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function isoDow(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

export function scheduleWorksOn(schedule: JourneySchedule | null | undefined, dow: number): boolean {
  if (!schedule) return dow >= 1 && dow <= 5;
  const key = WORKS_KEYS[dow];
  return !!(key && schedule[key]);
}

export function dayPunchContext(
  schedule: JourneySchedule | null | undefined,
  dateStr: string,
  holidayName: string | null,
): DayPunchContext {
  const dow = isoDow(dateStr);
  return {
    expectsWork: scheduleWorksOn(schedule, dow),
    isHoliday: !!holidayName,
    isSaturday: dow === 6,
  };
}

interface HolidayLike {
  holiday_date?: string | null;
  name?: string | null;
  recurring?: boolean | null;
  optional?: boolean | null;
  is_working_day?: boolean | null;
}

/** Nome do feriado que derruba a jornada. Dia útil excepcional e facultativo não entram. */
export function holidayNameOn(dateStr: string, holidays: HolidayLike[] | null | undefined): string | null {
  const monthDay = dateStr.slice(5, 10);
  for (const holiday of holidays || []) {
    if (holiday.optional === true || holiday.is_working_day === true) continue;
    const stored = String(holiday.holiday_date || '').slice(0, 10);
    if (!stored) continue;
    const matches = holiday.recurring ? stored.slice(5, 10) === monthDay : stored === dateStr;
    if (matches) return String(holiday.name || '').trim() || 'Feriado';
  }
  return null;
}

function clockOr(value: string | null | undefined, fallback: string): string {
  return punchHhmm(String(value || '')) || fallback;
}

export function formatExpectedJourney(
  schedule: JourneySchedule | null | undefined,
  dateStr: string,
  holidayName: string | null,
): string {
  if (holidayName) return `Feriado (${holidayName}) — sem jornada`;
  const dow = isoDow(dateStr);
  if (!scheduleWorksOn(schedule, dow)) return 'Folga — sem jornada';
  if (dow === 6) {
    const entry = clockOr(schedule?.saturday_entry || schedule?.entry_time, '08:00');
    const exit = clockOr(schedule?.saturday_exit || schedule?.exit_time, '12:00');
    return `${entry}–${exit}`;
  }
  const entry = clockOr(schedule?.entry_time, '08:00');
  const lunchOut = clockOr(schedule?.lunch_start, '12:00');
  const lunchIn = clockOr(schedule?.lunch_end, '13:00');
  const exit = clockOr(schedule?.exit_time, '17:48');
  return `${entry}–${lunchOut} · ${lunchIn}–${exit}`;
}

export function adjacentBusinessDates(
  dateStr: string,
  schedule: JourneySchedule | null | undefined,
  holidays: Set<string>,
  horizon = 14,
): { previous: string | null; next: string | null } {
  const step = (dir: -1 | 1): string | null => {
    for (let i = 1; i <= horizon; i++) {
      const date = shiftIsoDate(dateStr, dir * i);
      if (holidays.has(date)) continue;
      if (!scheduleWorksOn(schedule, isoDow(date))) continue;
      return date;
    }
    return null;
  };
  return { previous: step(-1), next: step(1) };
}

export function formatNeighborDayLine(date: string, punches: string[] | null): string {
  const dow = isoDow(date);
  const head = `${WEEKDAY_SHORT[dow]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
  if (punches == null) return `${head} · sem registro`;
  const times = punches.map(punchHhmm).filter(Boolean);
  if (times.length === 0) return `${head} · nenhuma batida`;
  return `${head} · ${times.join(' · ')}`;
}

function sortedTokens(punches: string[]): { hhmm: string; raw: string; manual: boolean }[] {
  const tokens = (punches || [])
    .map(raw => ({ raw: String(raw), hhmm: punchHhmm(String(raw)), manual: isManualPunchToken(String(raw)) }))
    .filter(token => token.hhmm);
  tokens.sort((a, b) => minutesOf(a.hhmm) - minutesOf(b.hhmm) || Number(a.manual) - Number(b.manual));
  return tokens;
}

export type SlotManual = Record<PunchSlotKey, boolean>;

export function emptySlotManual(): SlotManual {
  return { entrada: false, saidaAlmoco: false, voltaAlmoco: false, saida: false };
}

/** Pré-preenche os 4 campos e separa a 5ª batida em diante como extra. */
export function prefillDaySlots(punches: string[]): {
  slots: PunchSlots;
  slotManual: SlotManual;
  extras: string[];
} {
  const tokens = sortedTokens(punches);
  const named = punchesToNamedSlots(tokens.map(token => token.hhmm));
  const slots = emptyPunchSlots();
  const slotManual = emptySlotManual();
  const used = new Set<string>();
  for (const { key } of PUNCH_SLOT_DEFS) {
    const hhmm = named.slots[key];
    if (!hhmm) continue;
    const token = tokens.find(item => item.hhmm === hhmm && !used.has(item.hhmm));
    slots[key] = hhmm;
    slotManual[key] = !!token?.manual;
    if (token) used.add(token.hhmm);
  }
  const extras = tokens
    .filter(token => !used.has(token.hhmm))
    .map(token => token.hhmm + (token.manual ? '*' : ''));
  return { slots, slotManual, extras };
}

/** Payload do Salvar. '*' marca o que o gestor digitou; o relógio segue sem estrela. */
export function slotsToPunchPayload(slots: PunchSlots, slotManual: SlotManual, extras: string[]): string[] {
  const out: string[] = [];
  for (const { key } of PUNCH_SLOT_DEFS) {
    const value = punchHhmm(slots[key] || '');
    if (!value) continue;
    out.push(value + (slotManual[key] ? '*' : ''));
  }
  for (const extra of extras) {
    const value = punchHhmm(extra);
    if (!value) continue;
    out.push(value + (isManualPunchToken(extra) ? '*' : ''));
  }
  const seen = new Set<string>();
  return out
    .filter(token => {
      const key = punchHhmm(token);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => minutesOf(punchHhmm(a)) - minutesOf(punchHhmm(b)));
}

const LUNCH_KEYS: PunchSlotKey[] = ['saidaAlmoco', 'voltaAlmoco'];

/**
 * Slots do par esperado que ainda não têm batida.
 * Turno parcial (só manhã / só tarde) não pede almoço. Feriado ou folga sem
 * batida também não — não há par a completar.
 */
export function missingSlotKeys(punches: string[], ctx: DayPunchContext): PunchSlotKey[] {
  const valid = sortedTokens(punches).map(token => token.hhmm);
  if (valid.length === 0) {
    if (!ctx.expectsWork || ctx.isHoliday) return [];
    if (ctx.isSaturday) return ['entrada', 'saida'];
    return PUNCH_SLOT_DEFS.map(def => def.key);
  }
  if (valid.length === 2 && !twoPunchesNeedLunchMarks(valid)) return [];
  const { slots } = punchesToNamedSlots(valid);
  let missing = PUNCH_SLOT_DEFS.map(def => def.key).filter(key => !slots[key]);
  const saturdayWithoutLunch = ctx.isSaturday
    && valid.length < 3
    && !(valid.length === 2 && twoPunchesNeedLunchMarks(valid));
  if (saturdayWithoutLunch) {
    missing = missing.filter(key => !LUNCH_KEYS.includes(key));
  }
  return missing;
}

export function missingSlotLabel(key: PunchSlotKey): string {
  return PUNCH_SLOT_DEFS.find(def => def.key === key)?.label || key;
}

function punchList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(item => String(item));
    } catch {
      return [];
    }
  }
  return [];
}

export function formatPunchWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function classifyManualOrigin(
  hhmm: string,
  audits: PunchOverrideAudit[],
): { origin: PunchOrigin; audit: PunchOverrideAudit | null } {
  const ordered = [...audits].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const introduced = ordered.find(audit => {
    const before = new Set(punchList(audit.punches_before).map(punchHhmm));
    const after = punchList(audit.punches_after).map(punchHhmm);
    const added = punchHhmm(String(audit.added_punch || ''));
    return (after.includes(hhmm) && !before.has(hhmm)) || added === hhmm;
  }) ?? null;
  const action = String(introduced?.action || '');
  if (action === 'replace' || action === 'create') {
    return { origin: 'adjustment', audit: introduced };
  }
  return { origin: 'manual', audit: introduced };
}

export function describeRegisteredPunches(
  punches: string[],
  audits: PunchOverrideAudit[] = [],
  authors: Record<string, string> = {},
): RegisteredPunch[] {
  return sortedTokens(punches).map(token => {
    if (!token.manual) {
      return {
        hhmm: token.hhmm,
        raw: token.raw,
        manual: false,
        origin: 'clock' as const,
        originLabel: ORIGIN_LABEL.clock,
        authorName: null,
        whenLabel: null,
      };
    }
    const { origin, audit } = classifyManualOrigin(token.hhmm, audits);
    const authorId = audit?.created_by || null;
    return {
      hhmm: token.hhmm,
      raw: token.raw,
      manual: true,
      origin,
      originLabel: ORIGIN_LABEL[origin],
      authorName: authorId ? (authors[authorId] || null) : null,
      whenLabel: formatPunchWhen(audit?.created_at),
    };
  });
}

/** Linhas da seção: batidas em ordem, com o buraco do par no meio. */
export function buildRegisteredDayLines(
  punches: string[],
  ctx: DayPunchContext,
  audits: PunchOverrideAudit[] = [],
  authors: Record<string, string> = {},
): RegisteredDayLine[] {
  const described = describeRegisteredPunches(punches, audits, authors);
  if (described.length === 0) return [];
  const { slots } = prefillDaySlots(punches);
  const missing = new Set(missingSlotKeys(punches, ctx));
  const lines: RegisteredDayLine[] = [];
  const used = new Set<string>();
  for (const { key } of PUNCH_SLOT_DEFS) {
    const hhmm = slots[key];
    if (hhmm) {
      const punch = described.find(item => item.hhmm === hhmm && !used.has(item.hhmm));
      if (punch) {
        used.add(punch.hhmm);
        lines.push({ type: 'punch', punch });
      }
    } else if (missing.has(key)) {
      lines.push({ type: 'gap', label: `faltando: ${missingSlotLabel(key)}` });
    }
  }
  for (const punch of described) {
    if (!used.has(punch.hhmm)) lines.push({ type: 'punch', punch });
  }
  return lines;
}

export function dayCellPunchTooltip(punches: string[], ctx: DayPunchContext): string {
  const times = sortedTokens(punches).map(token => token.hhmm);
  const missing = missingSlotKeys(punches, ctx).map(missingSlotLabel);
  if (times.length === 0) {
    return missing.length
      ? `Nenhuma batida registrada · faltando: ${missing.join(', ')}`
      : 'Nenhuma batida registrada';
  }
  const body = times.join(' · ');
  return missing.length ? `${body} · faltando: ${missing.join(', ')}` : body;
}

function isCompletePartialForm(slots: PunchSlots): boolean {
  const entrada = punchHhmm(slots.entrada || '');
  const saida = punchHhmm(slots.saida || '');
  if (!entrada || !saida) return false;
  if (punchHhmm(slots.saidaAlmoco || '') || punchHhmm(slots.voltaAlmoco || '')) return false;
  return !twoPunchesNeedLunchMarks([entrada, saida]);
}

function expectedKeys(ctx: DayPunchContext, lunchProbe: string[]): PunchSlotKey[] {
  if (!ctx.expectsWork || ctx.isHoliday) return [];
  if (ctx.isSaturday && !twoPunchesNeedLunchMarks(lunchProbe)) return ['entrada', 'saida'];
  return PUNCH_SLOT_DEFS.map(def => def.key);
}

/**
 * Borda de alerta só no campo vazio que o par ainda pede.
 * Turno parcial já fechado (entrada + saída, sem cruzar o almoço) não pinta.
 */
export function slotAlertKeys(
  slots: PunchSlots,
  ctx: DayPunchContext,
  originalPunches: string[],
  cleared: boolean,
): PunchSlotKey[] {
  if (isCompletePartialForm(slots)) return [];
  const base = cleared ? [] : originalPunches;
  const probe = [punchHhmm(slots.entrada), punchHhmm(slots.saida)].filter(Boolean);
  const lunchProbe = probe.length === 2 ? probe : sortedTokens(base).map(token => token.hhmm);
  const needed = new Set<PunchSlotKey>([
    ...missingSlotKeys(base, ctx),
    ...expectedKeys(ctx, lunchProbe).filter(key => !punchHhmm(slots[key] || '')),
  ]);
  if (ctx.isSaturday && !twoPunchesNeedLunchMarks(lunchProbe)) {
    for (const key of LUNCH_KEYS) needed.delete(key);
  }
  return PUNCH_SLOT_DEFS.map(def => def.key).filter(key => needed.has(key) && !punchHhmm(slots[key] || ''));
}

/**
 * Espelho do ramo de `upsert_manual_time_record` que reaproveita o token já
 * gravado. Horário novo ganha '*'. Não duplica e não reescreve o relógio.
 */
export function resolveManualPunchTokens(existing: string[], submitted: string[]): string[] {
  const clean = submitted.map(punchHhmm).filter(Boolean);
  const resolved = clean.map(hhmm => {
    const matches = (existing || []).filter(old => punchHhmm(String(old)) === hhmm);
    if (matches.length === 0) return `${hhmm}*`;
    return [...matches].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))[0];
  });
  return [...resolved].sort((a, b) => minutesOf(punchHhmm(a)) - minutesOf(punchHhmm(b)));
}

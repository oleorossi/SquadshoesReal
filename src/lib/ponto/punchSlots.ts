/**
 * 4 slots nomeados do dia de ponto (Entrada · Saída almoço · Volta · Saída).
 * Fonte compartilhada entre Ajustar (DayAdjustDialog) e Pendências.
 */
import { mapThreePunchesToNamedSlots } from '@/lib/ponto/interpretDayPunches';

export const PUNCH_SLOT_DEFS = [
  { key: 'entrada', label: 'Entrada' },
  { key: 'saidaAlmoco', label: 'Saída almoço' },
  { key: 'voltaAlmoco', label: 'Volta almoço' },
  { key: 'saida', label: 'Saída' },
] as const;

export type PunchSlotKey = (typeof PUNCH_SLOT_DEFS)[number]['key'];
export type PunchSlots = Record<PunchSlotKey, string>;

const HH_MM_RE = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

export function emptyPunchSlots(): PunchSlots {
  return { entrada: '', saidaAlmoco: '', voltaAlmoco: '', saida: '' };
}

export function cleanPunchToken(p: string): string {
  return String(p || '').replace(/[*"]/g, '').slice(0, 5);
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Mapeia batidas cruas do relógio para os 4 campos (e extras se n>4). */
export function punchesToNamedSlots(punches: string[]): {
  slots: PunchSlots;
  extras: string[];
} {
  const sorted = [...(punches || [])]
    .map(cleanPunchToken)
    .filter(Boolean)
    .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  const slots = emptyPunchSlots();
  const extras: string[] = [];
  const keys = PUNCH_SLOT_DEFS.map((d) => d.key);

  if (sorted.length === 0) return { slots, extras };
  if (sorted.length === 1) {
    slots.entrada = sorted[0];
    return { slots, extras };
  }
  if (sorted.length === 2) {
    slots.entrada = sorted[0];
    slots.saida = sorted[1];
    return { slots, extras };
  }
  if (sorted.length === 3) {
    const named = mapThreePunchesToNamedSlots(sorted);
    if (named) {
      for (const k of keys) {
        if (named[k]) slots[k] = named[k];
      }
    } else {
      sorted.forEach((p, i) => {
        if (i < 4) slots[keys[i]] = p;
      });
    }
    return { slots, extras };
  }
  sorted.forEach((p, i) => {
    if (i < 4) slots[keys[i]] = p;
    else extras.push(p);
  });
  return { slots, extras };
}

export function namedSlotsToPunches(slots: PunchSlots, extras: string[] = []): string[] {
  const out: string[] = [];
  for (const { key } of PUNCH_SLOT_DEFS) {
    const v = (slots[key] || '').trim();
    if (v) out.push(v);
  }
  out.push(...extras.map((e) => e.trim()).filter(Boolean));
  return out.sort((a, b) => timeToMinutes(cleanPunchToken(a)) - timeToMinutes(cleanPunchToken(b)));
}

export function validateFourPunchSlots(slots: PunchSlots): { valid: boolean; errors: string[]; workedMin: number } {
  const errs: string[] = [];
  const values = PUNCH_SLOT_DEFS.map(({ key, label }) => ({ key, label, v: (slots[key] || '').trim() }));
  for (const { label, v } of values) {
    if (!v) errs.push(`${label}: preencha o horário.`);
    else if (!HH_MM_RE.test(v)) errs.push(`${label}: use HH:MM.`);
  }
  if (errs.length > 0) return { valid: false, errors: errs, workedMin: 0 };

  let worked = 0;
  const pairs: [string, string][] = [
    [values[0].v, values[1].v],
    [values[2].v, values[3].v],
  ];
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i];
    const am = timeToMinutes(a);
    const bm = timeToMinutes(b);
    if (bm <= am) errs.push(`Par ${i + 1}: saída deve ser depois da entrada.`);
    else worked += bm - am;
  }
  return { valid: errs.length === 0, errors: errs, workedMin: worked };
}

export function isCompleteFourSlots(slots: PunchSlots): boolean {
  return PUNCH_SLOT_DEFS.every(({ key }) => HH_MM_RE.test((slots[key] || '').trim()));
}

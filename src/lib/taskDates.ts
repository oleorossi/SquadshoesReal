import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * Helpers de data de vencimento do módulo de tarefas (/tarefas).
 * due_date é armazenado como 'YYYY-MM-DD' (date puro, sem hora/fuso).
 */

export type DueTone = 'overdue' | 'today' | 'soon' | 'later';

export interface DueInfo {
  label: string;   // "Atrasada 3d", "Hoje", "Amanhã", "sex, 10 jul", "24 ago"
  tone: DueTone;
  daysFromToday: number;
}

/** Classes de texto por tom — semânticas (status), permitidas fora de token. */
export const DUE_TONE_CLASS: Record<DueTone, string> = {
  overdue: 'text-destructive',
  today:   'text-amber-700 dark:text-amber-300',
  soon:    'text-muted-foreground',
  later:   'text-muted-foreground',
};

export function dueDateInfo(due: string | null | undefined, now: Date = new Date()): DueInfo | null {
  if (!due) return null;
  const d = parseISO(due);
  if (isNaN(d.getTime())) return null;
  const diff = differenceInCalendarDays(d, now);

  if (diff < 0) {
    return {
      label: diff === -1 ? 'Ontem' : `Atrasada ${-diff}d`,
      tone: 'overdue',
      daysFromToday: diff,
    };
  }
  if (diff === 0) return { label: 'Hoje', tone: 'today', daysFromToday: 0 };
  if (diff === 1) return { label: 'Amanhã', tone: 'soon', daysFromToday: 1 };
  if (diff <= 7) {
    // Dentro da semana: dia da semana + data curta ("sex, 10 jul")
    return {
      label: format(d, "EEE, dd MMM", { locale: ptBR }).replace('.', ''),
      tone: 'soon',
      daysFromToday: diff,
    };
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return {
    label: format(d, sameYear ? 'dd MMM' : 'dd MMM yyyy', { locale: ptBR }).replace('.', ''),
    tone: 'later',
    daysFromToday: diff,
  };
}

/** Date → 'YYYY-MM-DD' pro banco (sem fuso). */
export function toDueDateString(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/** 'YYYY-MM-DD' → Date local (pro Calendar). */
export function fromDueDateString(due: string | null | undefined): Date | undefined {
  if (!due) return undefined;
  const d = parseISO(due);
  return isNaN(d.getTime()) ? undefined : d;
}

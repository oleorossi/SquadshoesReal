import type { KanbanCardData } from '@/components/production/kanban/kanbanDerive';

/** Default do toggle = atraso (comportamento histórico do Kanban). */
export type KanbanSortMode = 'atraso' | 'setup';

const STORAGE_KEY = 'kanban-sort-mode';

export function readKanbanSortMode(): KanbanSortMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'setup' || v === 'atraso') return v;
  } catch { /* noop */ }
  return 'atraso';
}

export function writeKanbanSortMode(mode: KanbanSortMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch { /* noop */ }
}

function soleKey(
  card: KanbanCardData,
  soleByRefColor: Map<string, string> | undefined,
): string {
  const ref = card.q.reference_id || '';
  const color = (card.q.color || '').trim().toLocaleUpperCase('pt-BR');
  if (soleByRefColor && ref) {
    const hit = soleByRefColor.get(`${ref}::${color}`)
      || soleByRefColor.get(`${ref}::`);
    if (hit) return `${hit}::${color}`;
  }
  // Sem solado resolvido: agrupa só por cor (ainda reduz troca de cor)
  return `cor::${color || '_'}`;
}

/**
 * Pin soberano → depois modo (atraso | setup solado+cor) → desempate estável.
 */
export function sortKanbanColumnCards(
  cards: KanbanCardData[],
  mode: KanbanSortMode,
  soleByRefColor?: Map<string, string>,
): KanbanCardData[] {
  return cards.slice().sort((a, b) => {
    const ap = a.q.pinned_position;
    const bp = b.q.pinned_position;
    const aPinned = ap != null;
    const bPinned = bp != null;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    if (aPinned && bPinned && ap !== bp) return (ap as number) - (bp as number);

    if (mode === 'setup') {
      const ka = soleKey(a, soleByRefColor);
      const kb = soleKey(b, soleByRefColor);
      if (ka !== kb) return ka.localeCompare(kb, 'pt-BR');
    }

    const lateDiff = (b.q.late_days || 0) - (a.q.late_days || 0);
    if (lateDiff !== 0) return lateDiff;

    return (a.q.order_number || '').localeCompare(b.q.order_number || '', 'pt-BR');
  });
}

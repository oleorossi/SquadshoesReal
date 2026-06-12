import { useCallback, useMemo, useState } from 'react';

// ════════════════════════════════════════════════════════════════════════
// useNavOrder — ordem customizada da barra lateral (arrastar-e-soltar)
//
// O usuário pode reordenar GRUPOS entre si e ITENS dentro de cada grupo
// arrastando com o mouse (ver AppLayout). A ordem escolhida fica salva no
// localStorage por navegador (igual a favoritos / grupos recolhidos):
//   - nav-group-order : string[]                  (labels de grupo em ordem)
//   - nav-item-order  : { [groupLabel]: string[] } (paths de item em ordem)
//
// `applyNavOrder` reordena uma lista JÁ FILTRADA por acesso, então itens
// ocultos não criam buracos. O que não está na ordem salva mantém a posição
// original (apêndice estável no fim) — assim itens/grupos NOVOS adicionados
// no código aparecem normalmente sem precisar limpar a preferência.
// ════════════════════════════════════════════════════════════════════════

const GROUP_KEY = 'nav-group-order';
const ITEM_KEY = 'nav-item-order';
const ITEM_GROUP_KEY = 'nav-item-group';
const FAR = Number.MAX_SAFE_INTEGER;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ── Lógica pura (testável) ───────────────────────────────────────────────

/** Move `fromKey` pra posição de `toKey` (antes/depois). Retorna nova lista. */
export function reorderKeys(
  keys: string[],
  fromKey: string,
  toKey: string,
  pos: 'before' | 'after'
): string[] {
  if (fromKey === toKey) return keys.slice();
  const next = keys.slice();
  const from = next.indexOf(fromKey);
  if (from === -1) return keys.slice();
  next.splice(from, 1);
  let to = next.indexOf(toKey);
  if (to === -1) return keys.slice();
  if (pos === 'after') to += 1;
  next.splice(to, 0, fromKey);
  return next;
}

/**
 * Insere `newKey` na posição de `toKey` (antes/depois), removendo qualquer
 * ocorrência prévia. Generaliza `reorderKeys`: serve tanto pra reordenar
 * dentro da lista quanto pra trazer uma chave de FORA (move entre grupos).
 */
export function insertKey(
  keys: string[],
  newKey: string,
  toKey: string,
  pos: 'before' | 'after'
): string[] {
  if (newKey === toKey) return keys.slice();
  const next = keys.filter(k => k !== newKey);
  let to = next.indexOf(toKey);
  if (to === -1) return keys.slice(); // alvo sumiu → não mexe
  if (pos === 'after') to += 1;
  next.splice(to, 0, newKey);
  return next;
}

/**
 * Aplica a ordem salva (grupos + itens) sobre uma lista JÁ filtrada por acesso.
 * Estável: o que não está na ordem salva mantém a posição original no fim.
 *
 * `itemGroup` (path → label) sobrescreve a QUAL grupo o item pertence (mover
 * item entre grupos). Override só vale se o grupo de destino existir na lista
 * atual; senão o item fica no grupo original (evita item órfão).
 */
export function orderNav<G extends { label: string; items: { path: string }[] }>(
  groups: G[],
  groupOrder: string[],
  itemOrder: Record<string, string[]>,
  itemGroup: Record<string, string> = {}
): G[] {
  const gRank = (label: string) => {
    const i = groupOrder.indexOf(label);
    return i === -1 ? FAR : i;
  };
  const orderedGroups = groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => gRank(a.g.label) - gRank(b.g.label) || a.i - b.i)
    .map(x => x.g);

  // Reatribui cada item ao grupo efetivo (override válido só se o grupo existe)
  type Item = G['items'][number];
  const labelSet = new Set(orderedGroups.map(g => g.label));
  const buckets = new Map<string, Item[]>();
  for (const g of orderedGroups) buckets.set(g.label, []);
  for (const g of orderedGroups) {
    for (const item of g.items) {
      const override = itemGroup[item.path];
      const dest = override && labelSet.has(override) ? override : g.label;
      buckets.get(dest)!.push(item as Item);
    }
  }

  return orderedGroups.map(group => {
    const bucket = buckets.get(group.label)!;
    const order = itemOrder[group.label];
    if (!order || order.length === 0) return { ...group, items: bucket } as G;
    const pRank = (path: string) => {
      const i = order.indexOf(path);
      return i === -1 ? FAR : i;
    };
    const items = bucket
      .map((it, i) => ({ it, i }))
      .sort((a, b) => pRank(a.it.path) - pRank(b.it.path) || a.i - b.i)
      .map(x => x.it);
    return { ...group, items } as G;
  });
}

export function useNavOrder() {
  const [groupOrder, setGroupOrderState] = useState<string[]>(() => load<string[]>(GROUP_KEY, []));
  const [itemOrder, setItemOrderState] = useState<Record<string, string[]>>(() =>
    load<Record<string, string[]>>(ITEM_KEY, {})
  );
  const [itemGroup, setItemGroupState] = useState<Record<string, string>>(() =>
    load<Record<string, string>>(ITEM_GROUP_KEY, {})
  );

  const setGroupOrder = useCallback((labels: string[]) => {
    setGroupOrderState(labels);
    try { localStorage.setItem(GROUP_KEY, JSON.stringify(labels)); } catch { /* storage cheio/privado */ }
  }, []);

  const setItemOrder = useCallback((groupLabel: string, paths: string[]) => {
    setItemOrderState(prev => {
      const next = { ...prev, [groupLabel]: paths };
      try { localStorage.setItem(ITEM_KEY, JSON.stringify(next)); } catch { /* ignora */ }
      return next;
    });
  }, []);

  // Define (ou remove, com label=null) o grupo de destino de um item.
  const setItemGroup = useCallback((path: string, label: string | null) => {
    setItemGroupState(prev => {
      const next = { ...prev };
      if (label === null) delete next[path]; else next[path] = label;
      try { localStorage.setItem(ITEM_GROUP_KEY, JSON.stringify(next)); } catch { /* ignora */ }
      return next;
    });
  }, []);

  const resetOrder = useCallback(() => {
    setGroupOrderState([]);
    setItemOrderState({});
    setItemGroupState({});
    try {
      localStorage.removeItem(GROUP_KEY);
      localStorage.removeItem(ITEM_KEY);
      localStorage.removeItem(ITEM_GROUP_KEY);
    } catch { /* ignora */ }
  }, []);

  const hasCustomOrder =
    groupOrder.length > 0 || Object.keys(itemOrder).length > 0 || Object.keys(itemGroup).length > 0;

  // Reordena grupos e itens conforme a preferência salva. Estável: quem não
  // está na ordem salva cai no fim preservando a ordem original (tie-break i).
  const applyNavOrder = useCallback(
    <G extends { label: string; items: { path: string }[] }>(groups: G[]): G[] =>
      orderNav(groups, groupOrder, itemOrder, itemGroup),
    [groupOrder, itemOrder, itemGroup]
  );

  return useMemo(
    () => ({ applyNavOrder, setGroupOrder, setItemOrder, setItemGroup, resetOrder, hasCustomOrder }),
    [applyNavOrder, setGroupOrder, setItemOrder, setItemGroup, resetOrder, hasCustomOrder]
  );
}

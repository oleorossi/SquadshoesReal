/**
 * Helpers de hierarquia de grupos (parent_group_id em product_groups).
 *
 * Uso:
 *   - flattenGroupTree(groups) — devolve lista pré-ordenada com `depth`,
 *     ideal pra renderizar Select/lista com indentação.
 *   - getDescendantIds(groups, id) — IDs descendentes (anti-ciclo).
 *   - canBeParent(groups, candidateParentId, currentId) — true se a escolha
 *     não cria ciclo (não é o próprio nem um descendente).
 */
import type { ProductGroup } from '@/hooks/useGroups';

export type GroupTreeItem = ProductGroup & {
  depth: number;
  childCount: number;
};

/** Devolve lista achatada em pré-ordem (raízes primeiro, filhos abaixo, ordenados por nome). */
export function flattenGroupTree(groups: ProductGroup[]): GroupTreeItem[] {
  const childrenByParent = new Map<string | null, ProductGroup[]>();
  for (const g of groups) {
    const key = g.parent_group_id ?? null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(g);
  }
  for (const [, list] of childrenByParent) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }
  const result: GroupTreeItem[] = [];
  function walk(parentId: string | null, depth: number) {
    const kids = childrenByParent.get(parentId) || [];
    for (const k of kids) {
      const childCount = (childrenByParent.get(k.id) || []).length;
      result.push({ ...k, depth, childCount });
      walk(k.id, depth + 1);
    }
  }
  walk(null, 0);

  // Adiciona órfãos (parent não existe ou ciclo quebrado) no fim — defensivo
  const seen = new Set(result.map(r => r.id));
  for (const g of groups) {
    if (!seen.has(g.id)) {
      result.push({ ...g, depth: 0, childCount: (childrenByParent.get(g.id) || []).length });
    }
  }
  return result;
}

/** IDs de TODOS os descendentes de um grupo (filhos, netos, etc.). */
export function getDescendantIds(groups: ProductGroup[], id: string): Set<string> {
  const childrenByParent = new Map<string | null, string[]>();
  for (const g of groups) {
    const key = g.parent_group_id ?? null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(g.id);
  }
  const result = new Set<string>();
  const stack = [...(childrenByParent.get(id) || [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (result.has(cur)) continue;
    result.add(cur);
    stack.push(...(childrenByParent.get(cur) || []));
  }
  return result;
}

/**
 * Pode `candidateParentId` ser pai de `currentId`?
 * Falha se: (1) é o próprio, (2) é descendente (cria ciclo).
 * Permite null (sem pai = raiz).
 */
export function canBeParent(
  groups: ProductGroup[],
  candidateParentId: string | null,
  currentId: string | null,
): boolean {
  if (!candidateParentId) return true; // raiz é sempre válida
  if (!currentId) return true; // novo grupo: qualquer pai vale
  if (candidateParentId === currentId) return false;
  const descendants = getDescendantIds(groups, currentId);
  return !descendants.has(candidateParentId);
}

/** Retorna o "caminho" de um grupo até a raiz (breadcrumb): raiz → ... → grupo. */
export function getGroupPath(groups: ProductGroup[], id: string): ProductGroup[] {
  const byId = new Map(groups.map(g => [g.id, g]));
  const path: ProductGroup[] = [];
  let cur = byId.get(id);
  const visited = new Set<string>();
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    path.unshift(cur);
    cur = cur.parent_group_id ? byId.get(cur.parent_group_id) : undefined;
  }
  return path;
}

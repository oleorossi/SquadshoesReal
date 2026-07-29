/**
 * Auditoria runtime entre `menuGroups`/`systemItems` (sidebar) e
 * `ROUTE_MODULE_MAP` (regras de permissão).
 *
 * Espelha a lógica do teste estático `NavigationAccessConsistency.test.ts`,
 * mas roda quando o app é iniciado para capturar inconsistências em runtime
 * — útil quando alguém adiciona um item de menu sem rodar os testes.
 *
 * Comportamento:
 * - DEV: dispara `console.warn` + `CustomEvent('navigation:inconsistency')`
 *   que pode ser ouvido pelo `NavigationAuditWatcher` para mostrar toast.
 * - PROD: apenas `console.warn` silencioso (sem ruído visual ao usuário).
 */
import { menuGroups, systemItems } from '@/data/navigation';
import { ROUTE_MODULE_MAP } from '@/hooks/useAccessControl';

const ADMIN_ONLY_MODULES = new Set(['sistema', 'financeiro_admin']);

export type NavigationIssue =
  | { kind: 'missing-mapping'; path: string; label: string; group: string }
  | { kind: 'admin-only-in-menu'; path: string; label: string; group: string; module: string }
  | { kind: 'system-item-not-admin'; path: string; label: string; module: string }
  | { kind: 'duplicate-cross-section'; path: string }
  | { kind: 'duplicate-in-menu'; path: string; groups: string[] };

function resolveModuleForPath(path: string): string | null {
  const matchedKey = Object.keys(ROUTE_MODULE_MAP)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'));
  return matchedKey ? ROUTE_MODULE_MAP[matchedKey] : null;
}

/** Returns all detected inconsistencies. Empty array = healthy. */
export function auditNavigation(): NavigationIssue[] {
  const issues: NavigationIssue[] = [];

  // 1 + 2: cobertura e visibilidade dos itens em menuGroups
  for (const group of menuGroups) {
    for (const item of group.items) {
      const mod = resolveModuleForPath(item.path);
      if (mod === null) {
        issues.push({ kind: 'missing-mapping', path: item.path, label: item.label, group: group.label });
        continue;
      }
      if (ADMIN_ONLY_MODULES.has(mod)) {
        issues.push({ kind: 'admin-only-in-menu', path: item.path, label: item.label, group: group.label, module: mod });
      }
    }
  }

  // 3: systemItems devem ser admin-only (ou ausentes do mapa)
  for (const item of systemItems) {
    const mod = resolveModuleForPath(item.path);
    if (mod !== null && !ADMIN_ONLY_MODULES.has(mod)) {
      issues.push({ kind: 'system-item-not-admin', path: item.path, label: item.label, module: mod });
    }
  }

  // 4: duplicidade entre seções
  const menuPaths = new Set(menuGroups.flatMap((g) => g.items.map((i) => i.path)));
  for (const s of systemItems) {
    if (menuPaths.has(s.path)) issues.push({ kind: 'duplicate-cross-section', path: s.path });
  }

  // 5: duplicidade dentro de menuGroups
  const seen = new Map<string, string[]>();
  for (const g of menuGroups) {
    for (const item of g.items) {
      const arr = seen.get(item.path) || [];
      arr.push(g.label);
      seen.set(item.path, arr);
    }
  }
  for (const [path, groups] of seen) {
    if (groups.length > 1) issues.push({ kind: 'duplicate-in-menu', path, groups });
  }

  return issues;
}

export function describeIssue(issue: NavigationIssue): string {
  switch (issue.kind) {
    case 'missing-mapping':
      return `Item de menu "${issue.label}" (${issue.path}) em "${issue.group}" não está em ROUTE_MODULE_MAP — pode estar inacessível.`;
    case 'admin-only-in-menu':
      return `Item "${issue.label}" (${issue.path}) está no menu "${issue.group}" mas mapeado como "${issue.module}" (admin-only). Vai sumir para perfis não-admin.`;
    case 'system-item-not-admin':
      return `Item de Sistema "${issue.label}" (${issue.path}) está mapeado como "${issue.module}" (não admin-only) — outros perfis perdem acesso.`;
    case 'duplicate-cross-section':
      return `Rota "${issue.path}" duplicada entre menuGroups e systemItems.`;
    case 'duplicate-in-menu':
      return `Rota "${issue.path}" duplicada nos grupos: ${issue.groups.join(', ')}.`;
  }
}

let __ranOnce = false;

/**
 * Roda a auditoria uma vez por sessão. Em DEV emite warnings detalhados +
 * dispara `CustomEvent` para a UI de aviso. Em PROD apenas loga silencioso.
 */
export function runNavigationAuditOnce(): NavigationIssue[] {
  if (__ranOnce) return [];
  __ranOnce = true;

  const issues = auditNavigation();
  if (issues.length === 0) return [];

  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV;

  if (isDev) {
    console.group('[NavigationAudit] Inconsistências detectadas no menu lateral');
    issues.forEach((i) => console.warn(describeIssue(i), i));
    console.groupEnd();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('navigation:inconsistency', { detail: issues }));
    }
  } else {
    // PROD: apenas console silencioso, sem ruído ao usuário final
    console.warn('[NavigationAudit]', issues.length, issues.length === 1 ? 'inconsistência no menu lateral' : 'inconsistências no menu lateral');
  }

  return issues;
}

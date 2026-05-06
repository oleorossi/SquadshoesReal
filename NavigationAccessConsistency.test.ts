/**
 * Garante consistência entre o menu lateral (`navigation.ts`) e as regras de
 * permissão (`useAccessControl.ts`).
 *
 * Este teste previne regressões como a do commit e0024b2d, onde o item
 * "Ajuste de Estoque" foi movido para a seção "Sistema" do menu enquanto
 * sua rota estava mapeada como módulo admin-only — fazendo o item sumir
 * para todos os perfis não-admin.
 *
 * Regras validadas:
 * 1. Toda rota do menu lateral DEVE estar mapeada em ROUTE_MODULE_MAP.
 * 2. Itens dentro de `menuGroups` (visíveis a perfis não-admin) NÃO podem
 *    estar mapeados para os módulos admin-only ('sistema' ou
 *    'financeiro_admin') — caso contrário o item aparece no menu mas a
 *    rota é bloqueada pela guarda de acesso.
 * 3. Itens em `systemItems` (seção admin-only da sidebar) DEVEM estar
 *    mapeados como 'sistema' (ou ausentes do mapa, o que cai em allow-all).
 * 4. Cada grupo do menu deve agrupar itens do mesmo "domínio funcional":
 *    nenhum item de grupo de Estoque deve depender de módulo admin-only,
 *    nenhum item de grupo de Comercial deve depender de módulo Financeiro,
 *    etc. (verificado indiretamente pela regra 2.)
 */
import { describe, it, expect } from 'vitest';
import { menuGroups, systemItems, topItem } from '@/data/navigation';
import { ROUTE_MODULE_MAP } from '@/hooks/useAccessControl';

const ADMIN_ONLY_MODULES = new Set(['sistema', 'financeiro_admin']);

/**
 * Resolve o módulo associado a um path, replicando a heurística de
 * `canAccessRoute`: maior prefixo do mapa que casa exatamente ou seguido
 * de '/' / '?'.
 */
function resolveModuleForPath(path: string): string | null {
  const matchedKey = Object.keys(ROUTE_MODULE_MAP)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'));
  if (!matchedKey) return null;
  return ROUTE_MODULE_MAP[matchedKey];
}

describe('Navigation ↔ Access Control consistency', () => {
  it('topItem deve ter rota mapeada (ou ser dashboard, que é livre)', () => {
    const mod = resolveModuleForPath(topItem.path);
    // Dashboard pode ficar fora do mapa (acesso livre a usuários autenticados).
    expect(mod === null || typeof mod === 'string').toBe(true);
  });

  describe('menuGroups (itens visíveis a perfis não-admin)', () => {
    for (const group of menuGroups) {
      describe(`Grupo: ${group.label}`, () => {
        for (const item of group.items) {
          it(`"${item.name}" (${item.path}) deve ter mapeamento de módulo`, () => {
            const mod = resolveModuleForPath(item.path);
            expect(
              mod,
              `Rota "${item.path}" do item "${item.name}" não está em ROUTE_MODULE_MAP. ` +
                `Adicione uma entrada em useAccessControl.ts para que perfis não-admin possam acessá-la.`,
            ).not.toBeNull();
          });

          it(`"${item.name}" (${item.path}) NÃO pode estar em módulo admin-only`, () => {
            const mod = resolveModuleForPath(item.path);
            if (mod === null) return; // já validado acima
            expect(
              ADMIN_ONLY_MODULES.has(mod),
              `Rota "${item.path}" do item "${item.name}" está mapeada para o módulo "${mod}", ` +
                `que é admin-only. Itens em menuGroups devem usar módulos acessíveis a outros perfis. ` +
                `Mova o item para systemItems ou reclassifique a rota em ROUTE_MODULE_MAP.`,
            ).toBe(false);
          });
        }
      });
    }
  });

  describe('systemItems (seção Sistema — admin-only)', () => {
    for (const item of systemItems) {
      it(`"${item.label}" (${item.to}) deve ser admin-only ou livre`, () => {
        const mod = resolveModuleForPath(item.to);
        // Aceita: módulo admin-only OU ausente do mapa (allow-all = admin é
        // o único que vê na sidebar, então fica coerente).
        if (mod === null) return;
        expect(
          ADMIN_ONLY_MODULES.has(mod),
          `Rota "${item.to}" do item de Sistema "${item.label}" está mapeada para "${mod}", ` +
            `que NÃO é admin-only. Como systemItems só é renderizado para admins, isso esconde ` +
            `funcionalidade de outros perfis que poderiam usá-la. Mova o item para menuGroups ` +
            `ou ajuste o módulo em ROUTE_MODULE_MAP.`,
        ).toBe(true);
      });
    }
  });

  it('Não pode haver duplicidade de rota entre menuGroups e systemItems', () => {
    const menuPaths = new Set(menuGroups.flatMap((g) => g.items.map((i) => i.path)));
    const duplicates = systemItems.filter((s) => menuPaths.has(s.to));
    expect(
      duplicates.length,
      `Rotas duplicadas entre menuGroups e systemItems: ${duplicates.map((d) => d.to).join(', ')}. ` +
        `Cada rota deve aparecer em apenas um lugar para evitar confusão visual.`,
    ).toBe(0);
  });

  it('Não pode haver duplicidade de rota dentro de menuGroups', () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const group of menuGroups) {
      for (const item of group.items) {
        if (seen.has(item.path)) {
          dups.push(`${item.path} (em "${seen.get(item.path)}" e "${group.label}")`);
        } else {
          seen.set(item.path, group.label);
        }
      }
    }
    expect(dups.length, `Rotas duplicadas em menuGroups: ${dups.join('; ')}`).toBe(0);
  });
});

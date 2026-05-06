import { useMemo } from 'react';
import { useCurrentUserRoles } from './useUserManagement';
import { useAuth } from './useAuth';

/**
 * Route-to-module mapping.
 * Each route prefix is mapped to a module key used for access control.
 */
const ROUTE_MODULE_MAP: Record<string, string> = {
  '/conferencia-saida': 'expedicao',
  '/estoque/historico': 'estoque',
  '/references': 'produtos',
  '/dashboard': 'dashboard',
  '/pcp': 'producao',
  '/estoque': 'estoque',
  '/fichas-tecnicas': 'produtos',
  '/orders': 'ordens',
  '/setores': 'ordens',
  '/shop-floor': 'ordens',
  '/pcp-dashboard': 'producao',
  '/picking': 'ordens',
  '/mrp': 'producao',
  '/wip-control': 'producao',
  '/cycle-count': 'sistema',
  '/ajuste-estoque': 'estoque',
  '/order-flow-audit': 'ordens',
  '/labels': 'expedicao',
  '/label-system': 'expedicao',
  '/sales': 'vendas',
  '/pronta-entrega': 'vendas',
  '/sales-report': 'relatorios',
  '/suppliers': 'fornecedores',
  '/clients': 'clientes',
  '/finance': 'financeiro',
  '/nfe': 'financeiro',
  '/contractors': 'terceirizados',
  '/employees': 'rh',
  '/timesheet': 'rh',
  '/time-control': 'rh',
  '/purchase-orders': 'financeiro',
  '/purchase-planning': 'financeiro',
  '/pricing-calculator': 'financeiro',
  '/weekly-purchasing-plan': 'financeiro',
  '/comercial': 'vendas',
  '/producao': 'producao',
  '/production-dashboard': 'producao',
  '/financeiro': 'financeiro',
  '/rh': 'rh',
  '/transporte': 'expedicao',
  '/embalagens': 'expedicao',
  '/optimized-production': 'producao',
  '/capacity-planning': 'producao',
  '/inventory': 'estoque',
  '/production': 'producao',
  '/quality': 'producao',
  '/groups': 'produtos',
  '/stock-history': 'estoque',
  '/component-sheets': 'produtos',
  '/orders/summary': 'ordens',
  '/orders/grouped-summary': 'ordens',
  '/artisanal-recipes': 'estoque',
  '/expedicao': 'expedicao',
  '/silk-registrations': 'produtos',
  '/consumo-base': 'produtos',
  '/alertas-estoque': 'estoque',
  '/reservas-estoque': 'estoque',
  '/custos-insumos': 'estoque',
  '/imagens-cores': 'produtos',
  // System pages — admin only
  '/settings': 'sistema',
  '/automations': 'sistema',
  '/system-monitor': 'sistema',
  '/reports': 'sistema',
  '/audit-logs': 'sistema',
  '/system-diagnostics': 'sistema',
  '/unit-audit': 'sistema',
};

/**
 * Modules each role can access.
 */
const ROLE_MODULES: Record<string, string[]> = {
  admin: ['*'], // all
  gerente: [
    'dashboard', 'estoque', 'produtos', 'ordens', 'vendas', 'clientes',
    'relatorios', 'financeiro', 'fornecedores', 'terceirizados', 'rh',
    'producao', 'expedicao',
  ],
  producao: [
    'dashboard', 'estoque', 'produtos', 'ordens', 'producao',
  ],
  almoxarifado: [
    'dashboard', 'estoque',
  ],
  comercial: [
    'dashboard', 'vendas', 'clientes', 'relatorios',
  ],
  consulta: [
    'dashboard', 'estoque', 'produtos', 'ordens', 'vendas', 'clientes',
    'relatorios', 'financeiro', 'fornecedores', 'terceirizados', 'rh',
    'producao', 'expedicao',
  ],
};

function getAllowedModules(roles: string[]): Set<string> {
  const modules = new Set<string>();
  for (const role of roles) {
    const mods = ROLE_MODULES[role];
    if (!mods) continue;
    if (mods.includes('*')) return new Set(['*']);
    mods.forEach(m => modules.add(m));
  }
  return modules;
}

 export type PermissionStatus = 'loading' | 'ready' | 'error';
 
 export function useAccessControl() {
   const { user, loading: authLoading } = useAuth();
   const rolesQuery = useCurrentUserRoles();
   const { data: roles = [] } = rolesQuery;
 
    // Cálculo do status de permissão.
    //
    // Regras importantes para evitar o banner de "Sessão Instável" indevido:
    // - Sem usuário logado → 'ready' (a guarda de auth cuidará do redirect).
    // - Se já temos roles em cache (mesmo que esteja revalidando ou tenha
    //   falhado uma revalidação), seguimos como 'ready' usando o cache.
    // - Só consideramos 'error' quando não há nenhum dado e a query falhou.
    const status: PermissionStatus = useMemo(() => {
      if (authLoading) return 'loading';
      if (!user) return 'ready';

      const hasCachedRoles = roles.length > 0;
      if (hasCachedRoles) return 'ready';

      // Sem cache: ainda buscando pela primeira vez
      if (rolesQuery.isPending || rolesQuery.fetchStatus === 'fetching') {
        return 'loading';
      }

      // Sem cache + falha definitiva
      if (rolesQuery.isError) return 'error';

      return 'ready';
    }, [authLoading, user, roles.length, rolesQuery.isPending, rolesQuery.fetchStatus, rolesQuery.isError]);
 
   const loading = status === 'loading';
   const isError = status === 'error';
 

  const roleKeys = useMemo(() => roles.map(r => r.role), [roles]);
   const isAdmin = useMemo(() => roleKeys.includes('admin'), [roleKeys]);
  const allowedModules = useMemo(() => getAllowedModules(roleKeys), [roleKeys]);

  /** Check if a given route path is accessible */
  const canAccessRoute = (path: string): boolean => {
    if (!user) return false;
    if (allowedModules.has('*')) return true;

    // Find the matching module for the route
    const matchedKey = Object.keys(ROUTE_MODULE_MAP)
      .sort((a, b) => b.length - a.length) // longest prefix first
      .find(prefix => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'));

    if (!matchedKey) return true; // routes not in map are accessible (e.g. dashboard)
    const mod = ROUTE_MODULE_MAP[matchedKey];

    // financeiro_admin is admin-only
    if (mod === 'financeiro_admin') return isAdmin;
    // sistema is admin-only
    if (mod === 'sistema') return isAdmin;

    return allowedModules.has(mod);
  };

  /** Check if a module key is accessible */
  const canAccessModule = (moduleKey: string): boolean => {
    if (!user) return false;
    if (allowedModules.has('*')) return true;
    if (moduleKey === 'sistema' || moduleKey === 'financeiro_admin') return isAdmin;
    return allowedModules.has(moduleKey);
  };

  return {
    loading,
    isError,
    isAdmin,
    roles: roleKeys,
    canAccessRoute,
    canAccessModule,
  };
}

export { ROUTE_MODULE_MAP };

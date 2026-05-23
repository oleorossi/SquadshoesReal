import { useMemo } from 'react';
import { useCurrentUserRoles, useCurrentUserPermissions } from './useUserManagement';
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
  '/entregas': 'expedicao',
  '/sales': 'vendas',
  '/pronta-entrega': 'vendas',
  '/sales-report': 'relatorios',
  '/suppliers': 'fornecedores',
  '/clients': 'clientes',
  '/finance': 'financeiro',
  '/companies': 'empresas_fiscal',
  '/nfe': 'nfe',
  '/contractors': 'terceirizados',
  '/employees': 'rh',
  '/timesheet': 'rh',
  '/time-control': 'rh',
  '/rh/bank-hours': 'rh',
  '/rh/payroll': 'rh_folha',
  '/payroll': 'rh_folha',
  '/purchase-orders': 'financeiro',
  '/purchase-planning': 'financeiro',
  '/pricing-calculator': 'financeiro',
  '/weekly-purchasing-plan': 'financeiro',
  '/comercial': 'vendas',
  '/producao': 'producao',
  '/producao/live': 'producao',
  '/producao/timeline': 'producao',
  '/producao/fluxo': 'producao',
  '/relatorios/diario-producao': 'reports',
  '/relatorios/op': 'reports',
  '/relatorios/oee': 'reports',
  // Rota raiz /relatorios é admin-only (item aparece em systemItems da sidebar,
  // só visível para admins). Sub-rotas continuam acessíveis a gerente via
  // módulo 'reports'. Mantém consistência com NavigationAccessConsistency.test.
  '/relatorios': 'sistema',
  '/cost-policies': 'financeiro',
  '/relatorios/qualidade': 'reports',
  '/relatorios/refugo': 'reports',
  '/relatorios/semanal': 'reports',
  '/production-dashboard': 'producao',
  '/financeiro': 'financeiro',
  '/rh': 'rh',
  '/rh/banco-de-horas': 'rh',
  '/transporte': 'expedicao',
  '/embalagens': 'expedicao',
  '/optimized-production': 'producao',
  '/capacity-planning': 'producao',
  '/gargalos': 'producao',
  '/terceiros-na-rua': 'producao',
  '/producao/visao-agregada': 'producao',
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
  '/silks': 'produtos',
  '/consumo-base': 'produtos',
  '/alertas-estoque': 'estoque',
  '/reservas-estoque': 'estoque',
  '/custos-insumos': 'estoque',
  '/imagens-cores': 'produtos',
  '/solados': 'produtos',
  '/rh?tab=folha': 'rh_folha',
  '/rh?tab=relatorios': 'rh',
  '/rh?tab=funcionarios': 'rh',
  '/rh?tab=ponto': 'rh',
  '/rh?tab=banco-horas': 'rh',
  // Páginas novas da Onda 1-7 (adicionadas em mai/2026)
  '/price-lists': 'vendas',
  '/crm': 'vendas',
  '/sac': 'vendas',
  '/forecast': 'vendas',
  '/centro-controle': 'producao',
  '/imprimir-fichas': 'producao',
  '/quotations': 'financeiro',
  '/manifests': 'expedicao',
  '/transporters': 'expedicao',
  '/delivery-tracking': 'expedicao',
  '/picking-sessions': 'expedicao',
  '/cte': 'financeiro',
  '/mdfe': 'financeiro',
  '/cnab': 'financeiro',
  '/bank-reconciliation': 'financeiro',
  '/sped': 'financeiro',
  '/lgpd': 'sistema',
  '/security': 'sistema',
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
    'relatorios', 'financeiro', 'nfe', 'empresas_fiscal',
    'fornecedores', 'terceirizados', 'rh', 'rh_folha',
    'producao', 'expedicao',
  ],
  producao: [
    'dashboard', 'estoque', 'produtos', 'ordens', 'producao', 'vendas', 'expedicao',
  ],
  almoxarifado: [
    'dashboard', 'estoque',
  ],
  comercial: [
    'dashboard', 'vendas', 'clientes', 'relatorios',
  ],
  consulta: [
    'dashboard', 'estoque', 'produtos', 'ordens', 'vendas', 'clientes',
    'relatorios', 'financeiro', 'nfe', 'empresas_fiscal', 'fornecedores',
    'terceirizados', 'rh', 'producao', 'expedicao',
  ],
  // Operador NF-e: emite/cancela NF + vê PVs com valores + cadastra clientes/empresas.
  // Não tem acesso a AR/AP/DRE/bancos/folha.
  nfe_operator: [
    'dashboard', 'vendas', 'clientes', 'nfe', 'empresas_fiscal',
  ],
  // RH: cadastros, ponto, banco de horas, escalas, faltas. SEM folha de pagamento
  // (gera financial_entries, restrito a admin).
  rh: [
    'dashboard', 'rh', 'terceirizados',
  ],
};

/**
 * Roles que NÃO podem ver valores financeiros (preços, totais, comissão,
 * faturamento) nas telas de vendas. Usado pra esconder colunas/campos sem
 * remover a navegação. Produção e operador NF-e enquadram-se aqui pra
 * diferentes razões: produção não decide preço (informação irrelevante);
 * operador NF-e tem acesso a valores mas não a fluxo financeiro completo —
 * e o nfe_operator NÃO entra aqui porque PRECISA ver valor pra emitir NF.
 */
const ROLES_BLOCKED_FROM_FINANCIAL_VALUES = new Set(['producao', 'almoxarifado']);

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
   // Permissões granulares por usuário (sobrescrevem ROLE_MODULES quando
   // o admin marcou menus individuais no dialog de criação de usuário).
   // Se o user TEM rows em user_permissions, usamos só elas. Se NÃO tem,
   // caímos no RBAC tradicional via roles. Admin sempre vê tudo.
   const permsQuery = useCurrentUserPermissions();
   const { data: granularPerms = [] } = permsQuery;
 
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

  // Resolve módulos permitidos com precedência:
  //   1. Admin → '*' (tudo)
  //   2. Tem rows em user_permissions com can_view=true → usa essas
  //      (sobrescreve totalmente o RBAC, exceto admin)
  //   3. Senão → usa ROLE_MODULES baseado nas roles do user
  // Sem isso, admin não tinha como liberar SÓ "Pedido de Venda" pra alguém
  // que não fosse comercial — agora dá override granular.
  const allowedModules = useMemo<Set<string>>(() => {
    if (roleKeys.includes('admin')) return new Set(['*']);
    const granular = granularPerms.filter(p => p.can_view).map(p => p.module);
    if (granular.length > 0) {
      // dashboard sempre liberado pra qualquer user (tela inicial)
      return new Set(['dashboard', ...granular]);
    }
    return getAllowedModules(roleKeys);
  }, [roleKeys, granularPerms]);

  /**
   * Pode ver valores financeiros (preço unitário, total do PV, comissão).
   * Admin sempre vê. Produção/almoxarifado nunca veem (mesmo que tenham
   * acesso à página de Vendas pra contexto de produção).
   */
  const canSeeFinancialValues = useMemo(() => {
    if (isAdmin) return true;
    if (roleKeys.length === 0) return false;
    // Bloqueia só quando TODAS as roles do usuário estão na blocklist.
    // Se ele acumula 'producao' + 'comercial', mantém acesso a valores
    // pelo papel comercial.
    return roleKeys.some(r => !ROLES_BLOCKED_FROM_FINANCIAL_VALUES.has(r));
  }, [isAdmin, roleKeys]);

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
    // rh_folha (folha de pagamento): admin/gerente apenas — role 'rh' não acessa
    if (mod === 'rh_folha') return isAdmin || roleKeys.includes('gerente');

    return allowedModules.has(mod);
  };

  /** Check if a module key is accessible */
  const canAccessModule = (moduleKey: string): boolean => {
    if (!user) return false;
    if (allowedModules.has('*')) return true;
    if (moduleKey === 'sistema' || moduleKey === 'financeiro_admin') return isAdmin;
    if (moduleKey === 'rh_folha') return isAdmin || roleKeys.includes('gerente');
    return allowedModules.has(moduleKey);
  };

  return {
    loading,
    isError,
    isAdmin,
    roles: roleKeys,
    canAccessRoute,
    canAccessModule,
    canSeeFinancialValues,
  };
}

export { ROUTE_MODULE_MAP };

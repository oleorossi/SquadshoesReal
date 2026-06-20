import { useMemo } from 'react';
import { useCurrentUserRoles, useCurrentUserPermissions } from './useUserManagement';
import { useAuth } from './useAuth';
import { getAllMenuItems } from '@/data/navigation';

/**
 * Route-to-module mapping.
 * Each route prefix is mapped to a module key used for access control.
 */
const ROUTE_MODULE_MAP: Record<string, string> = {
  '/conferencia-saida': 'expedicao',
  '/estoque/historico': 'estoque',
  '/estoque/qualidade': 'estoque',
  '/estoque/inventario': 'estoque',
  '/compras/alcadas': 'financeiro',
  '/compras/inspecao': 'financeiro',
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
  '/purchase-orders/per-pv': 'financeiro',
  '/purchase-planning': 'financeiro',
  '/mrp-advanced': 'financeiro',
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
  '/cronoanalise': 'producao',
  '/producao/paradas': 'producao',
  '/producao/setup-times': 'producao',
  '/patrimonio': 'financeiro',
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
  // Hub unificado de terceirização (Na Rua + OS + Planejamento + Prestadores +
  // Receitas + Relatório). Governado pelo módulo 'terceirizados' (mesmo do antigo
  // /contractors) — e o papel 'producao' recebe esse módulo em ROLE_MODULES, então
  // quem acessava QUALQUER uma das duas telas antigas continua com acesso.
  '/terceiros': 'terceirizados',
  '/terceiros-na-rua': 'terceirizados',     // legado → redireciona pro hub
  '/terceiros/relatorios': 'terceirizados', // legado → redireciona pro hub
  '/rh/pendencias-ponto': 'rh',
  '/rh/fechamento-semanal': 'rh',
  '/rh/ausencias': 'rh',
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
  '/notas': 'vendas',
  '/tarefas': 'vendas',
  '/sac': 'vendas',
  '/forecast': 'vendas',
  '/centro-controle': 'producao',
  '/imprimir-fichas': 'producao',
  '/fichas-montadores': 'producao',
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
  '/sped/bloco-k': 'financeiro',
  '/perfis-tributarios': 'financeiro',
  '/apuracao-impostos': 'financeiro',
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
    // 'terceirizados': o hub /terceiros (Na Rua + cadastro de contratadas) é função
    // operacional de produção. Antes a produção via /terceiros pelo módulo 'producao';
    // como o hub passou a ser governado por 'terceirizados', concedemos aqui pra não
    // tirar acesso de ninguém na unificação.
    'terceirizados',
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

// Módulos que só admin acessa — nunca liberáveis por role/granular a outros.
const ADMIN_ONLY_MODULES = new Set(['sistema', 'financeiro_admin']);

// Caminhos de TODOS os itens de menu (sidebar) — usado pra resolver o "dono"
// de uma rota navegada no modo granular por item. Calculado uma vez.
const ALL_MENU_PATHS: string[] = getAllMenuItems().map((i) => i.path);

/** Módulo associado a uma rota (maior prefixo do ROUTE_MODULE_MAP que casa). */
export function resolveModuleForPath(path: string): string | null {
  const matchedKey = Object.keys(ROUTE_MODULE_MAP)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'));
  return matchedKey ? ROUTE_MODULE_MAP[matchedKey] : null;
}

/** Item de menu "dono" de uma rota = maior path de menu que é prefixo dela.
 *  Garante que liberar "/estoque" NÃO libere o item irmão "/estoque/historico"
 *  (que tem item próprio), mas cubra sub-rotas sem item próprio (/estoque/x). */
export function resolveMenuOwner(path: string, allMenuPaths: string[] = ALL_MENU_PATHS): string | null {
  let best: string | null = null;
  for (const p of allMenuPaths) {
    if (path === p || path.startsWith(p + '/') || path.startsWith(p + '?')) {
      if (best === null || p.length > best.length) best = p;
    }
  }
  return best;
}

export interface RouteAccessInput {
  isAdmin: boolean;
  roles: string[];
  /** Linhas de user_permissions (module pode ser key de módulo OU path '/...'). */
  perms: Array<{ module: string; can_view: boolean }>;
  allMenuPaths?: string[];
}

/**
 * Regra ÚNICA de acesso a uma rota (pura/testável). Usada pelo usuário logado
 * (useAccessControl) e pra pré-marcar o painel de permissões de OUTRO usuário.
 *
 * Precedência:
 *   1. admin → tudo.
 *   2. módulos admin-only (sistema) → só admin; rh_folha → admin/gerente.
 *   3. dashboard → sempre liberado (tela inicial).
 *   4. tem permissão granular (rows em user_permissions):
 *        - libera se o ITEM dono da rota está liberado por PATH, OU
 *        - (retrocompat) se o MÓDULO da rota está liberado por key.
 *      Caso contrário, bloqueia (allow-list estrita — "só os selecionados").
 *   5. sem granular → RBAC por role (comportamento legado).
 */
export function isRouteAllowed(path: string, input: RouteAccessInput): boolean {
  const { isAdmin, roles, perms } = input;
  const allMenuPaths = input.allMenuPaths ?? ALL_MENU_PATHS;
  if (isAdmin || roles.includes('admin')) return true;

  const mod = resolveModuleForPath(path);
  // Gates admin-only valem em QUALQUER modo (não-admin chega aqui).
  if (mod && ADMIN_ONLY_MODULES.has(mod)) return false;
  if (mod === 'rh_folha' && !roles.includes('gerente')) return false;

  if (path === '/dashboard' || mod === 'dashboard') return true;

  const view = perms.filter((p) => p.can_view).map((p) => p.module);
  const grantedPaths = new Set(view.filter((m) => m.startsWith('/')));
  const grantedModules = new Set(view.filter((m) => !m.startsWith('/')));
  const hasGranular = grantedPaths.size > 0 || grantedModules.size > 0;

  if (hasGranular) {
    const owner = resolveMenuOwner(path, allMenuPaths);
    if (owner && grantedPaths.has(owner)) return true;
    if (mod && grantedModules.has(mod)) return true; // retrocompat módulo
    return false;
  }

  // Sem granular → RBAC por role (legado).
  if (!mod) return true; // rotas fora do mapa = livres (ex.: detalhes)
  const roleMods = getAllowedModules(roles);
  if (roleMods.has('*')) return true;
  return roleMods.has(mod);
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

  /** Check if a given route path is accessible.
   *  Modo granular por ITEM: rows em user_permissions (path '/...' ou key de
   *  módulo legado) viram allow-list estrita — só os menus selecionados pro
   *  usuário aparecem/abrem. Sem rows → RBAC por role (legado). */
  const canAccessRoute = (path: string): boolean => {
    if (!user) return false;
    return isRouteAllowed(path, { isAdmin, roles: roleKeys, perms: granularPerms });
  };

  /** Check if a module key is accessible. Mantido por compatibilidade de API
   *  (sem consumidores externos hoje). Path-grants não implicam módulo inteiro. */
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

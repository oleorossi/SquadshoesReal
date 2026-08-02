import { useMemo } from 'react';
import { useCurrentUserRoles, useCurrentUserPermissions } from './useUserManagement';
import { useAuth } from './useAuth';
import { grantableDestinations } from '@/data/navigation';

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
  // Deep-links do hub do PCP (itens de menu/Cmd+K apontam direto pra aba)
  '/pcp?tab=setores': 'producao',
  '/pcp?tab=quadro&modo=matriz': 'producao',
  '/pcp?tab=quadro&modo=cartoes': 'producao',
  '/pcp?tab=quadro&modo=timeline': 'producao',
  '/pcp?tab=quadro&modo=lote': 'producao',
  '/estoque': 'estoque',
  '/grupos': 'estoque',
  '/fichas-tecnicas': 'produtos',
  '/fichas-tecnicas/padroes': 'produtos', // ferramenta de padrões da Engenharia
  '/escalonamento': 'produtos',
  '/calculadora-tiras': 'produtos',
  '/orders': 'ordens',
  '/setores': 'ordens',
  '/shop-floor': 'ordens',
  '/pcp-dashboard': 'producao',
  '/picking': 'ordens',
  '/mrp': 'producao',
  // '/wip-control' e '/cycle-count' saíram no L4 (29/07/2026): os dois aliases
  // levavam a uma tela semanticamente diferente do que o nome prometia.
  '/ajuste-estoque': 'estoque',
  '/order-flow-audit': 'ordens',
  '/labels': 'expedicao',
  '/label-system': 'expedicao',
  '/entregas': 'expedicao',
  '/sales': 'vendas',
  '/pronta-entrega': 'vendas',
  '/catalogo': 'vendas',
  '/sales-report': 'relatorios',
  '/suppliers': 'fornecedores',
  '/clients': 'clientes',
  '/grupos-economicos': 'clientes',
  '/finance': 'financeiro',
  '/companies': 'empresas_fiscal',
  '/nfe': 'nfe',
  '/contractors': 'terceirizados',
  '/employees': 'rh',
  '/timesheet': 'rh',
  '/time-control': 'rh',
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
  // Rotas do menu de Produção (remodelagem do motor diário, 0747cea) — todas
  // governadas pelo módulo 'producao', igual às demais /producao/*.
  '/producao/planejamento': 'producao',
  '/producao/kanban': 'producao',
  '/producao/kanban/gestao': 'producao', // modo eventual do mesmo Kanban
  '/producao/estouro': 'producao',
  '/producao/setores': 'producao',
  '/producao/apontamento': 'producao',
  '/producao/analises': 'producao',
  '/producao/produtividade': 'producao',
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
  '/financeiro?tab=accounts': 'financeiro', // item "Contas (AR/AP)" deep-linka a aba; mesmo módulo
  '/rh': 'rh',
  '/transporte': 'expedicao',
  '/embalagens': 'expedicao',
  '/optimized-production': 'producao',
  '/capacity-planning': 'producao',
  '/gargalos': 'producao',
  // Hub unificado "Terceirizados" (rota canônica /terceirizados): Na Rua + OS +
  // Planejamento + Prestadores + Receitas + Relatório. Governado pelo módulo
  // 'terceirizados' (mesmo do antigo /contractors) — e o papel 'producao' recebe
  // esse módulo em ROLE_MODULES, então quem acessava QUALQUER uma das duas telas
  // antigas continua com acesso.
  '/terceirizados': 'terceirizados',
  '/ordens-servico': 'terceirizados',       // atalho no menu Compras → aba OS do hub
  '/terceiros': 'terceirizados',            // nome canônico anterior → redireciona pro hub
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
  '/artisanal-recipes': 'terceirizados', // virou aba do hub Terceirizados (2026-07-04)
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
  '/fichas-montadores': 'ficha_montadores',
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
  '/navigation-audit': 'sistema',

  // ── Aliases legados ───────────────────────────────────────────────────
  // Não renderizam tela: só redirecionam. Mesmo assim precisam de módulo,
  // porque `isRouteAllowed` passou a NEGAR rota não classificada (fail-closed,
  // 29/07/2026). Cada um recebe o módulo do seu DESTINO — assim o alias nunca
  // é mais permissivo nem mais restritivo que a tela pra onde ele leva.
  // Ao aposentar um alias, apague a linha daqui junto.
  '/technical-sheets': 'produtos',
  '/products': 'estoque',
  '/consumo-material': 'estoque',
  '/stock': 'estoque',
  '/pedidos': 'vendas',
  '/pedidos-venda': 'vendas',
  '/ordens-de-producao': 'ordens',
  '/ordens': 'ordens',
  '/lead-time': 'producao',
  '/modules': 'producao',
  '/modules/reports': 'vendas',   // leva a /comercial, não à produção
  '/corte': 'producao',
  '/costura': 'producao',
  '/aviamento': 'producao',
  '/montagem': 'producao',
  '/solagem': 'producao',
  '/acabamento': 'producao',
  '/compras': 'financeiro',
  '/fornecedores': 'fornecedores',
  '/clientes': 'clientes',
  '/ponto': 'rh',
  '/auditoria': 'sistema',
  '/diagnostico': 'sistema',
  '/monitoramento': 'sistema',
};

/**
 * Modules each role can access.
 */
export const ROLE_MODULES: Record<string, string[]> = {
  admin: ['*'], // all
  gerente: [
    'dashboard', 'estoque', 'produtos', 'ordens', 'vendas', 'clientes',
    'relatorios', 'financeiro', 'nfe', 'empresas_fiscal',
    'fornecedores', 'terceirizados', 'rh', 'rh_folha',
    'producao', 'expedicao', 'ficha_montadores',
  ],
  producao: [
    'dashboard', 'estoque', 'produtos', 'ordens', 'producao', 'vendas', 'expedicao', 'ficha_montadores',
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
    'terceirizados', 'rh', 'producao', 'expedicao', 'ficha_montadores',
  ],
  // Operador NF-e: emite/cancela NF + vê PVs com valores + cadastra clientes/empresas.
  // Não tem acesso a AR/AP/DRE/bancos/folha.
  nfe_operator: [
    'dashboard', 'vendas', 'clientes', 'nfe', 'empresas_fiscal',
  ],
  // RH: cadastros, ponto, banco de horas, escalas, faltas. SEM folha de pagamento
  // (gera financial_entries, restrito a admin).
  rh: [
    'dashboard', 'rh', 'terceirizados', 'ficha_montadores',
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

// Caminhos de TODOS os destinos concedíveis — usado pra resolver o "dono" de
// uma rota navegada no modo granular por item. Calculado uma vez.
const ALL_MENU_PATHS: string[] = grantableDestinations.map((i) => i.path);

/** Módulo associado a uma rota (maior prefixo do ROUTE_MODULE_MAP que casa). */
export function resolveModuleForPath(path: string): string | null {
  const matchedKey = Object.keys(ROUTE_MODULE_MAP)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'));
  return matchedKey ? ROUTE_MODULE_MAP[matchedKey] : null;
}

/** Destino concedível "dono" de uma rota = maior path concedível que é prefixo dela.
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

/** Ações controláveis por área/tela (module = path). 'view' governa a rota. */
export type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

export interface PermRow {
  module: string;
  can_view: boolean;
  can_create?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
}

export interface RouteAccessInput {
  isAdmin: boolean;
  roles: string[];
  /** Linhas de user_permissions (module pode ser key de módulo OU path '/...'). */
  perms: PermRow[];
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
  //
  // FAIL-CLOSED desde 29/07/2026. Antes era `return true`: rota não classificada
  // era LIBERADA no modo legado e NEGADA assim que o usuário ganhasse qualquer
  // permissão granular — os dois modos discordavam sobre a mesma tela. Agora
  // rota sem módulo é negada nos dois, e classificar virou obrigação:
  // `check-navigation-access.mjs` falha o build em rota sob RouteGuard sem
  // entrada em ROUTE_MODULE_MAP, e os 25 aliases legados foram classificados
  // pelo módulo do destino.
  //
  // A URL inexistente NÃO passa por aqui: o RouteGuard deixa o catch-all
  // renderizar o NotFound, senão errar o endereço viraria "Acesso Restrito".
  if (!mod) return false;
  const roleMods = getAllowedModules(roles);
  if (roleMods.has('*')) return true;
  return roleMods.has(mod);
}

const ACTION_COL: Record<Exclude<PermissionAction, 'view'>, keyof PermRow> = {
  create: 'can_create',
  edit: 'can_edit',
  delete: 'can_delete',
};

/**
 * Pode executar uma AÇÃO (criar/editar/excluir) numa tela/área — regra pura.
 *
 * Precedência (alinhada com isRouteAllowed):
 *   0. Precisa PODER VER a tela; sem visão, nenhuma ação.
 *   1. admin → tudo.
 *   2. 'view' → delega pra isRouteAllowed.
 *   3. tem granular (rows por PATH com flags): usa a flag da AÇÃO na row dona.
 *        - grant legado por MÓDULO (key, sem flags de ação) → concede a ação
 *          (retrocompat: antes ver o módulo já dava tudo).
 *   4. sem granular → RBAC por role: ver a tela ⇒ pode agir (comportamento
 *      legado — não havia gate de ação antes desta feature).
 *
 * Backward-compat garantida pela migration: linhas antigas com can_view=true
 * foram backfilladas com as 3 ações=true, então usuários existentes não perdem
 * capacidade quando os gates passam a valer.
 */
export function isActionAllowed(path: string, action: PermissionAction, input: RouteAccessInput): boolean {
  const { isAdmin, roles, perms } = input;
  if (isAdmin || roles.includes('admin')) return true;
  if (!isRouteAllowed(path, input)) return false; // sem ver, nada
  if (action === 'view') return true;

  const allMenuPaths = input.allMenuPaths ?? ALL_MENU_PATHS;
  const grantsView = perms.filter((p) => p.can_view);
  const hasGranular = grantsView.length > 0;
  // RBAC legado (sem rows): ver a tela já concedia todas as ações.
  if (!hasGranular) return true;

  const owner = resolveMenuOwner(path, allMenuPaths);
  const pathRow = owner ? perms.find((p) => p.module === owner && p.can_view) : undefined;
  if (pathRow) {
    const v = pathRow[ACTION_COL[action]];
    // Coluna AUSENTE (row legado, gravado antes das colunas de ação existirem,
    // ou lido de cache pré-migration) => trata como acesso completo (semântica
    // antiga: ver a tela = poder tudo nela). Só NEGA quando a flag existe e é
    // explicitamente false — restrição salva pela matriz nova. Sem isso, um
    // usuário existente perderia ações no intervalo entre deploy e backfill.
    return v === undefined || v === null ? true : Boolean(v);
  }

  // Retrocompat: liberado por key de módulo (grant antigo sem split de ação).
  const mod = resolveModuleForPath(path);
  const grantedModules = new Set(grantsView.filter((p) => !p.module.startsWith('/')).map((p) => p.module));
  if (mod && grantedModules.has(mod)) return true;
  return false;
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
   // Permissões do próprio usuário ainda na 1ª busca. Os gates de AÇÃO usam isto
   // pra NÃO liberar por RBAC (fail-open) antes dos grants granulares chegarem.
   const permsLoading = !!user && permsQuery.isPending && permsQuery.fetchStatus === 'fetching';
   // Grants do próprio usuário falharam SEM nenhum dado em cache. O guard de rota
   // usa isto pra NEGAR (em vez de cair no RBAC legado — fail-open da auditoria
   // P12): se o usuário tem allow-list restritiva mas ela não pôde ser lida,
   // conceder acesso pelo papel legado vazaria telas que a allow-list negaria.
   const permsError = !!user && permsQuery.isError && granularPerms.length === 0;


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

  /** Pode executar uma ação (view/create/edit/delete) numa tela/área. Admin
   *  sempre pode; sem rows granulares cai no RBAC legado (ver ⇒ agir). */
  const can = (path: string, action: PermissionAction = 'view'): boolean => {
    if (!user) return false;
    return isActionAllowed(path, action, { isAdmin, roles: roleKeys, perms: granularPerms });
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
    can,
    permsLoading,
    permsError,
    canSeeFinancialValues,
  };
}

/**
 * Conveniência: resolve as 4 capacidades de uma tela/área de uma vez.
 * Uso: `const perm = useCan('/financeiro'); perm.canDelete && <BotãoExcluir/>`.
 * ⚠ Passe o path do ITEM DE MENU (o que a matriz grava), não uma rota-redirect.
 */
export function useCan(path: string) {
  const { can, loading, isAdmin, permsLoading } = useAccessControl();
  // NÃO memoizar: `can` fecha sobre perms/roles que chegam async — memoizar por
  // deps incompletas congelava gates desatualizados (fail-open) e não recalculava
  // quando os grants chegavam. Recalcular a cada render é barato e sempre reflete
  // os grants atuais. Enquanto as permissões do próprio usuário carregam, um
  // não-admin pode ter restrições que ainda não chegaram → negar as AÇÕES até
  // saber (conservador). Admin não depende de perms (can() já curto-circuita).
  const actionsReady = isAdmin || !permsLoading;
  return {
    loading: loading || permsLoading,
    isAdmin,
    canView: can(path, 'view'),
    canCreate: actionsReady && can(path, 'create'),
    canEdit: actionsReady && can(path, 'edit'),
    canDelete: actionsReady && can(path, 'delete'),
  };
}

export { ROUTE_MODULE_MAP };

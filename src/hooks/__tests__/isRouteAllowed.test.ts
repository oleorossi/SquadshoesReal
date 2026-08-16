import { describe, it, expect } from 'vitest';
import { isRouteAllowed, isActionAllowed, resolveMenuOwner, resolveModuleForPath } from '@/hooks/useAccessControl';

// Catálogo de menu controlado pros testes de "dono" da rota (sibling resolution).
const MENU = [
  '/estoque', '/estoque/historico', '/estoque/qualidade',
  '/sales', '/pcp', '/producao/kanban', '/orders', '/imprimir-fichas', '/fichas-montadores',
  '/label-system', '/rh', '/contractors',
  '/tiras-artesanais',
];

const perm = (module: string, can_view = true) => ({ module, can_view });

describe('resolveModuleForPath', () => {
  it('casa pelo maior prefixo', () => {
    // Capacidade própria desde 29/07/2026: a ficha mora no grupo RH da sidebar,
    // então não pode depender do módulo 'producao' — senão o RH não a enxerga.
    expect(resolveModuleForPath('/fichas-montadores')).toBe('ficha_montadores');
    expect(resolveModuleForPath('/label-system')).toBe('expedicao');
    expect(resolveModuleForPath('/estoque/historico')).toBe('estoque');
    expect(resolveModuleForPath('/sales/123')).toBe('vendas');
    // Modo Gestão é uma moldura dedicada do MESMO Kanban: herda a entrada pai,
    // não cria um módulo ou destino concedível paralelo.
    expect(resolveModuleForPath('/producao/kanban/gestao')).toBe('producao');
  });
});

describe('resolveMenuOwner', () => {
  it('item próprio vence o pai (não herda do prefixo mais curto)', () => {
    expect(resolveMenuOwner('/estoque/historico', MENU)).toBe('/estoque/historico');
    expect(resolveMenuOwner('/estoque', MENU)).toBe('/estoque');
  });
  it('sub-rota sem item próprio cai no item pai', () => {
    expect(resolveMenuOwner('/sales/123', MENU)).toBe('/sales');
    expect(resolveMenuOwner('/estoque/qualquer-detalhe', MENU)).toBe('/estoque');
    expect(resolveMenuOwner('/producao/kanban/gestao', MENU)).toBe('/producao/kanban');
  });
  it('rota sem nenhum item-prefixo → null', () => {
    expect(resolveMenuOwner('/sac', MENU)).toBeNull();
  });
  it('aliases de tiras preservam o dono concedível do hub', () => {
    expect(resolveMenuOwner('/calculadora-tiras', MENU)).toBe('/tiras-artesanais');
    expect(resolveMenuOwner('/artisanal-recipes', MENU)).toBe('/tiras-artesanais');
    expect(resolveMenuOwner('/terceirizados?foo=1&tab=recipes', MENU)).toBe('/tiras-artesanais');
    expect(resolveModuleForPath('/terceirizados?tab=recipes')).toBe('produtos');
  });
});

describe('isRouteAllowed — admin', () => {
  it('admin acessa tudo, inclusive sistema', () => {
    const o = { isAdmin: true, roles: ['admin'], perms: [], allMenuPaths: MENU };
    expect(isRouteAllowed('/settings', o)).toBe(true);
    expect(isRouteAllowed('/fichas-montadores', o)).toBe(true);
  });
});

describe('isRouteAllowed — RBAC por role (sem granular)', () => {
  const rh = { isAdmin: false, roles: ['rh'], perms: [], allMenuPaths: MENU };
  it('rh vê seus módulos e o dashboard', () => {
    expect(isRouteAllowed('/dashboard', rh)).toBe(true);
    expect(isRouteAllowed('/rh', rh)).toBe(true);
    expect(isRouteAllowed('/contractors', rh)).toBe(true);
    // A Ficha Montadores está no grupo RH da sidebar: se o RH não puder abrir,
    // o item some do menu dele — foi o bug F13 da auditoria de 29/07/2026.
    expect(isRouteAllowed('/fichas-montadores', rh)).toBe(true);
  });
  it('rh NÃO vê produção/expedição', () => {
    expect(isRouteAllowed('/imprimir-fichas', rh)).toBe(false);
    expect(isRouteAllowed('/label-system', rh)).toBe(false);
    expect(isRouteAllowed('/pcp', rh)).toBe(false);
  });
  it('módulos admin-only bloqueados pra não-admin', () => {
    expect(isRouteAllowed('/settings', rh)).toBe(false);
    expect(isRouteAllowed('/security', rh)).toBe(false);
  });
  it('rh_folha só admin/gerente', () => {
    expect(isRouteAllowed('/payroll', rh)).toBe(false);
    expect(isRouteAllowed('/payroll', { isAdmin: false, roles: ['gerente'], perms: [], allMenuPaths: MENU })).toBe(true);
  });
  it('produção vê páginas de produção', () => {
    const prod = { isAdmin: false, roles: ['producao'], perms: [], allMenuPaths: MENU };
    expect(isRouteAllowed('/pcp', prod)).toBe(true);
    expect(isRouteAllowed('/fichas-montadores', prod)).toBe(true);
  });
});

describe('isRouteAllowed — granular POR ITEM (allow-list de paths)', () => {
  // RH + 3 menus liberados por item (o caso do pedido do usuário).
  const rhPlus = {
    isAdmin: false,
    roles: ['rh'],
    perms: [perm('/fichas-montadores'), perm('/label-system'), perm('/imprimir-fichas'), perm('/rh'), perm('/contractors')],
    allMenuPaths: MENU,
  };
  it('vê exatamente os itens liberados (+ dashboard)', () => {
    expect(isRouteAllowed('/dashboard', rhPlus)).toBe(true);
    expect(isRouteAllowed('/fichas-montadores', rhPlus)).toBe(true);
    expect(isRouteAllowed('/label-system', rhPlus)).toBe(true);
    expect(isRouteAllowed('/imprimir-fichas', rhPlus)).toBe(true);
    expect(isRouteAllowed('/rh', rhPlus)).toBe(true);
  });
  it('NÃO vê o resto de produção/expedição (só o item, não o módulo todo)', () => {
    expect(isRouteAllowed('/pcp', rhPlus)).toBe(false);
    expect(isRouteAllowed('/orders', rhPlus)).toBe(false);
    expect(isRouteAllowed('/sales', rhPlus)).toBe(false);
  });

  it('liberar item-pai NÃO libera item-irmão com path próprio', () => {
    const o = { isAdmin: false, roles: ['consulta'], perms: [perm('/estoque')], allMenuPaths: MENU };
    expect(isRouteAllowed('/estoque', o)).toBe(true);
    expect(isRouteAllowed('/estoque/historico', o)).toBe(false); // item próprio, não liberado
    expect(isRouteAllowed('/estoque/qualidade', o)).toBe(false);
    expect(isRouteAllowed('/estoque/detalhe-qualquer', o)).toBe(true); // sub-rota sem item → cobre
  });

  it('sub-rota de um item liberado é coberta', () => {
    const o = { isAdmin: false, roles: ['consulta'], perms: [perm('/sales')], allMenuPaths: MENU };
    expect(isRouteAllowed('/sales', o)).toBe(true);
    expect(isRouteAllowed('/sales/123', o)).toBe(true);
  });

  it('grant do hub novo atravessa os redirects legados de tiras', () => {
    const o = { isAdmin: false, roles: ['consulta'], perms: [perm('/tiras-artesanais')], allMenuPaths: MENU };
    expect(isRouteAllowed('/tiras-artesanais', o)).toBe(true);
    expect(isRouteAllowed('/calculadora-tiras', o)).toBe(true);
    expect(isRouteAllowed('/artisanal-recipes', o)).toBe(true);
    expect(isRouteAllowed('/terceirizados?tab=recipes', o)).toBe(true);
  });

  it('can_view=false é ignorado', () => {
    // A tela precisa ser uma que o RBAC do 'rh' NÃO libera, senão o teste passa
    // pelo motivo errado. '/imprimir-fichas' é do módulo 'producao'.
    const o = { isAdmin: false, roles: ['rh'], perms: [perm('/imprimir-fichas', false)], allMenuPaths: MENU };
    // só essa row (can_view=false) → não conta como granular → cai no RBAC rh
    expect(isRouteAllowed('/imprimir-fichas', o)).toBe(false);
  });
});

describe('isRouteAllowed — retrocompat grant por MÓDULO (legado)', () => {
  const o = { isAdmin: false, roles: ['consulta'], perms: [perm('estoque')], allMenuPaths: MENU };
  it('grant de módulo cobre todas as rotas do módulo', () => {
    expect(isRouteAllowed('/estoque', o)).toBe(true);
    expect(isRouteAllowed('/estoque/historico', o)).toBe(true); // módulo 'estoque'
  });
  it('grant de módulo NÃO cobre outros módulos', () => {
    expect(isRouteAllowed('/sales', o)).toBe(false);
    expect(isRouteAllowed('/pcp', o)).toBe(false);
  });
});

// Grant por PATH com as 4 flags de ação (novo modelo CRUD).
const grant = (module: string, a: { c?: boolean; e?: boolean; d?: boolean } = {}) =>
  ({ module, can_view: true, can_create: !!a.c, can_edit: !!a.e, can_delete: !!a.d });

describe('isActionAllowed — ações CRUD por área', () => {
  it('admin pode tudo', () => {
    const o = { isAdmin: true, roles: ['admin'], perms: [], allMenuPaths: MENU };
    for (const act of ['view', 'create', 'edit', 'delete'] as const) {
      expect(isActionAllowed('/sales', act, o)).toBe(true);
    }
  });

  it('RBAC legado (sem granular): ver a tela ⇒ pode agir', () => {
    const prod = { isAdmin: false, roles: ['producao'], perms: [], allMenuPaths: MENU };
    expect(isActionAllowed('/orders', 'view', prod)).toBe(true);
    expect(isActionAllowed('/orders', 'create', prod)).toBe(true);
    expect(isActionAllowed('/orders', 'delete', prod)).toBe(true);
    // fora do papel (RH não pertence a produção): nem ver, nem agir
    expect(isActionAllowed('/rh', 'edit', prod)).toBe(false);
  });

  it('granular por path respeita cada flag de ação', () => {
    const o = {
      isAdmin: false, roles: ['comercial'], allMenuPaths: MENU,
      perms: [grant('/sales', { e: true }), grant('/orders', { c: true, e: true, d: true })],
    };
    // /sales: só editar
    expect(isActionAllowed('/sales', 'view', o)).toBe(true);
    expect(isActionAllowed('/sales', 'create', o)).toBe(false);
    expect(isActionAllowed('/sales', 'edit', o)).toBe(true);
    expect(isActionAllowed('/sales', 'delete', o)).toBe(false);
    // /orders: tudo
    expect(isActionAllowed('/orders', 'delete', o)).toBe(true);
    // tela não concedida: nada
    expect(isActionAllowed('/pcp', 'view', o)).toBe(false);
    expect(isActionAllowed('/pcp', 'edit', o)).toBe(false);
  });

  it('sem ver a tela, nenhuma ação passa', () => {
    const o = { isAdmin: false, roles: ['comercial'], allMenuPaths: MENU, perms: [grant('/sales', { c: true })] };
    expect(isActionAllowed('/rh', 'view', o)).toBe(false);
    expect(isActionAllowed('/rh', 'create', o)).toBe(false);
  });

  it('grant legado por MÓDULO concede as ações (sem split)', () => {
    const o = { isAdmin: false, roles: ['consulta'], perms: [perm('estoque')], allMenuPaths: MENU };
    expect(isActionAllowed('/estoque', 'view', o)).toBe(true);
    expect(isActionAllowed('/estoque', 'edit', o)).toBe(true);
    expect(isActionAllowed('/estoque', 'delete', o)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// PWA do representante (/m/*) — 05/08/2026
//
// Até esta data o ramo /m tinha só o ProtectedRoute (login + `approved`) e
// nenhuma entrada em ROUTE_MODULE_MAP: qualquer usuário aprovado abria /m/new
// e criava PV. `profiles.is_sales_rep` NÃO barrava nada — ele só escolhe o
// destino do redirect pós-login. Agora /m herda o módulo 'vendas', o mesmo das
// telas de PV do desktop.
// ════════════════════════════════════════════════════════════════════════
describe('PWA /m/* — herda o módulo de vendas', () => {
  it('as 4 rotas do PWA resolvem pro módulo vendas', () => {
    expect(resolveModuleForPath('/m')).toBe('vendas');
    expect(resolveModuleForPath('/m/new')).toBe('vendas');
    expect(resolveModuleForPath('/m/pending')).toBe('vendas');
    expect(resolveModuleForPath('/m/profile')).toBe('vendas');
  });

  it('o prefixo curto "/m" não sequestra rotas que só COMEÇAM com m', () => {
    // A fronteira exigida ('/' ou '?') é o que impede a colisão; chaves mais
    // longas também são testadas antes. Sem isso, /mrp viraria 'vendas'.
    expect(resolveModuleForPath('/mrp')).toBe('producao');
    expect(resolveModuleForPath('/mdfe')).toBe('financeiro');
    expect(resolveModuleForPath('/manifests')).toBe('expedicao');
    expect(resolveModuleForPath('/montagem')).toBe('producao');
    expect(resolveModuleForPath('/modules/reports')).toBe('vendas'); // já era 'vendas' por conta própria
  });

  it('RBAC: perfis sem vendas NÃO alcançam mais o /m/new', () => {
    const almox = { isAdmin: false, roles: ['almoxarifado'], perms: [], allMenuPaths: MENU };
    const rh = { isAdmin: false, roles: ['rh'], perms: [], allMenuPaths: MENU };
    expect(isRouteAllowed('/m', almox)).toBe(false);
    expect(isRouteAllowed('/m/new', almox)).toBe(false);
    expect(isRouteAllowed('/m/new', rh)).toBe(false);
  });

  it('RBAC: perfis com vendas continuam entrando', () => {
    const comercial = { isAdmin: false, roles: ['comercial'], perms: [], allMenuPaths: MENU };
    expect(isRouteAllowed('/m', comercial)).toBe(true);
    expect(isRouteAllowed('/m/new', comercial)).toBe(true);
    expect(isRouteAllowed('/m/new', { isAdmin: true, roles: ['admin'], perms: [], allMenuPaths: MENU })).toBe(true);
  });

  it('allow-list granular que não concede vendas fecha o /m/new', () => {
    // Caso REAL em produção (perfil eaedb95d…, roles consulta+producao+rh com 20
    // grants por PATH, nenhum deles /sales): pelo RBAC ele teria 'vendas', mas a
    // allow-list manda — e antes do fix ele criava PV pelo celular assim mesmo.
    const granular = {
      isAdmin: false,
      roles: ['consulta', 'producao', 'rh'],
      perms: [perm('/estoque'), perm('/orders'), perm('/imprimir-fichas')],
      allMenuPaths: MENU,
    };
    expect(isRouteAllowed('/orders', granular)).toBe(true);
    expect(isRouteAllowed('/m/new', granular)).toBe(false);
  });

  it('grant legado por MÓDULO "vendas" cobre o PWA', () => {
    const o = { isAdmin: false, roles: ['consulta'], perms: [perm('vendas')], allMenuPaths: MENU };
    expect(isRouteAllowed('/m/new', o)).toBe(true);
  });

  // ⚠ LACUNA CONHECIDA, não é o comportamento desejado a longo prazo.
  // `/m` não é um destino concedível (não existe em navigation.ts), então
  // resolveMenuOwner('/m/new') → null e o grant por PATH de '/sales' não o
  // alcança. Hoje isso não afeta ninguém (nenhum profile tem is_sales_rep e o
  // PWA não é usado), mas o dia em que um representante for configurado pela
  // matriz granular ele fica trancado fora do próprio app. Fechar dando um
  // destino concedível ao /m, ou fazendo o dono de /m ser '/sales'.
  it('LACUNA: grant granular por PATH de /sales NÃO cobre o /m', () => {
    const repGranular = {
      isAdmin: false, roles: ['comercial'], perms: [perm('/sales')], allMenuPaths: MENU,
    };
    expect(isRouteAllowed('/sales/new', repGranular)).toBe(true);
    expect(isRouteAllowed('/m/new', repGranular)).toBe(false); // ← trava a decisão até ser revisada
  });
});

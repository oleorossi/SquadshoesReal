import { Package, ShoppingCart, Gear as Settings, Truck, Factory, Kanban, SquaresFour as LayoutDashboard, Wallet, FileText, Users, Briefcase, Ruler, ShieldCheck, Lightning as Zap, ShoppingBag, ChartBar as BarChart3, Receipt, Footprints, Sparkle as Sparkles, ClipboardText as ClipboardCheck, CurrencyDollar as DollarSign, Calendar, Cube as Box, ListChecks, Stack as Boxes, HandHeart as HeartHandshake, FileXls as FileSpreadsheet, Scales as Scale, Warning as AlertTriangle, Path as RouteIcon, Pulse as Activity, Printer, Tag, Barcode, ChatText as MessageSquare, TrendUp as TrendingUp, Calculator, Lock, Monitor, Cpu, Buildings, Gavel, Gauge, FolderOpen, Scissors, Clock } from '@phosphor-icons/react';

/**
 * Superfícies de descoberta.
 *
 * - `hub` — landing do setor (entrada da sidebar)
 * - `hub-child` — tela de trabalho dentro do hub
 * - `command` — achável no Cmd+K
 * - `quick-action` — FAB / ação rápida
 * - `hub-shortcut` — atalho dentro do hub (ferramentas)
 */
export type NavigationSurface = 'hub' | 'hub-child' | 'command' | 'quick-action' | 'hub-shortcut';

/**
 * Recurso navegável canônico.
 *
 * O loader mora aqui porque path não revela com segurança qual chunk Vite deve
 * pré-carregar; manter os dois juntos impede que hover e navegação divirjam.
 */
export interface NavigationResource {
  path: string;
  label: string;
  group: string;
  icon: typeof Box;
  surfaces: NavigationSurface[];
  preload?: () => Promise<unknown>;
}

export interface NavigationGroup {
  label: string;
  icon: typeof Box;
  items: NavigationResource[];
}

export interface NavigationHub {
  path: string;
  label: string;
  icon: typeof Box;
  /** Labels de `group` no catálogo — usados pra puxar ferramentas secundárias. */
  groups: string[];
  children: NavigationResource[];
}

// ════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE NAVEGAÇÃO
//
// Um recurso é descrito uma única vez. HUBS escolhe filhos; secondaryRoutes
// deriva do que NÃO é hub/hub-child.
// ════════════════════════════════════════════════════════════════════════
export const navigationCatalog: NavigationResource[] = [
  // Início
  { path: '/dashboard', label: 'Painel', group: 'Início', icon: LayoutDashboard, surfaces: ['command'], preload: () => import('@/pages/Dashboard') },

  // Comercial — hub landing = /comercial (ComercialDashboard)
  { path: '/comercial', label: 'Comercial', group: 'Comercial', icon: ShoppingCart, surfaces: ['hub', 'command'], preload: () => import('@/pages/ComercialDashboard') },
  { path: '/sales', label: 'Pedidos de Venda', group: 'Comercial', icon: FileText, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/SaleOrders') },
  { path: '/pronta-entrega', label: 'Pronta-Entrega', group: 'Comercial', icon: Box, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/ProntaEntrega') },
  { path: '/catalogo', label: 'Catálogo', group: 'Comercial', icon: Sparkles, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Catalogo') },
  { path: '/clients', label: 'Clientes', group: 'Comercial', icon: Users, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Clients') },
  { path: '/crm', label: 'CRM', group: 'Comercial', icon: HeartHandshake, surfaces: ['command'] /* CRM: 0 interações e 0 respostas de NPS registradas */, preload: () => import('@/pages/CRM') },
  { path: '/tarefas', label: 'Tarefas', group: 'Comercial', icon: ListChecks, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Tarefas') },
  { path: '/price-lists', label: 'Tabelas de Preço', group: 'Comercial', icon: DollarSign, surfaces: ['command'] /* Tabelas de Preço: 1 registro, último em 10/05 */, preload: () => import('@/pages/PriceLists') },
  { path: '/notas', label: 'Anotações', group: 'Comercial', icon: FileText, surfaces: ['command'] /* Anotações: 2 registros, último em 31/05 */, preload: () => import('@/pages/Notes') },
  { path: '/sac', label: 'SAC', group: 'Comercial', icon: MessageSquare, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/SAC') },
  { path: '/forecast', label: 'Forecast', group: 'Comercial', icon: TrendingUp, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/Forecast') },

  // Engenharia (absorve Tiras)
  { path: '/engenharia', label: 'Engenharia', group: 'Engenharia', icon: Ruler, surfaces: ['hub', 'command'], preload: () => import('@/pages/EngenhariaHub') },
  { path: '/fichas-tecnicas', label: 'Fichas Técnicas', group: 'Engenharia', icon: Ruler, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/TechnicalSheets') },
  { path: '/escalonamento', label: 'Escalonamento', group: 'Engenharia', icon: Calculator, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/EscalonamentoCadPage') },
  { path: '/tiras-artesanais', label: 'Central de Tiras', group: 'Engenharia', icon: Scissors, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/ArtisanalStraps') },
  { path: '/solados', label: 'Solados', group: 'Engenharia', icon: Footprints, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/SolesHub') },
  { path: '/silks', label: 'Silks', group: 'Engenharia', icon: Sparkles, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Silks') },
  { path: '/fichas-tecnicas/padroes', label: 'Padrões por Cor', group: 'Engenharia', icon: Sparkles, surfaces: ['command'], preload: () => import('@/pages/ColorStandards') },

  // Produção
  { path: '/producao', label: 'Produção', group: 'Produção', icon: Factory, surfaces: ['hub', 'command'], preload: () => import('@/pages/ProducaoHub') },
  { path: '/producao/planejamento', label: 'Planejamento', group: 'Produção', icon: ClipboardCheck, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/ProducaoPlanejamento') },
  { path: '/producao/antecipacao', label: 'Antecipação', group: 'Produção', icon: Clock, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/ProducaoAntecipacao') },
  // Mantém o path concedível histórico para não invalidar permissões por item;
  // a rota redireciona imediatamente para a Central em Modo Gestão.
  { path: '/producao/kanban', label: 'Modo Gestão', group: 'Produção', icon: Kanban, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/ProducaoKanban') },
  { path: '/producao/estouro', label: 'Estouro de Produção', group: 'Produção', icon: AlertTriangle, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/ProducaoEstouro') },
  { path: '/producao/setores', label: 'Setores', group: 'Produção', icon: Factory, surfaces: ['command'] /* configuração global do motor, não entrada diária */, preload: () => import('@/pages/ProducaoSetoresConfig') },
  { path: '/producao/apontamento', label: 'Apontamento', group: 'Produção', icon: ListChecks, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Setores') },
  { path: '/producao/calculadora-grade', label: 'Calculadora Grade', group: 'Produção', icon: Calculator, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/CalculadoraGrade') },
  { path: '/imprimir-fichas', label: 'Imprimir Fichas', group: 'Produção', icon: Printer, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/PrintWorkSheets') },
  { path: '/producao/analises', label: 'Análises', group: 'Produção', icon: BarChart3, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/ProducaoAnalises') },
  { path: '/producao/produtividade', label: 'Produtividade por Modelo', group: 'Produção', icon: Gauge, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/ProdutividadeModelos') },
  // Ordens não ocupa a sidebar por decisão do dono, mas é aberta pela FAB e
  // por cards; o mesmo recurso governa ação rápida, busca e permissão granular.
  { path: '/orders', label: 'Ordens de Produção', group: 'Produção', icon: ClipboardCheck, surfaces: ['command', 'quick-action'], preload: () => import('@/pages/Orders') },

  // Materiais (ex-Estoque)
  { path: '/materiais', label: 'Materiais', group: 'Materiais', icon: Package, surfaces: ['hub', 'command'], preload: () => import('@/pages/MateriaisHub') },
  { path: '/estoque', label: 'Estoque', group: 'Materiais', icon: Package, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Index') },
  { path: '/grupos', label: 'Grupos', group: 'Materiais', icon: FolderOpen, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Groups') },
  { path: '/ajuste-estoque', label: 'Ajustes', group: 'Materiais', icon: Boxes, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/StockAdjustmentPage') },
  { path: '/estoque/qualidade', label: 'Qualidade de Estoque', group: 'Materiais', icon: ShieldCheck, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/EstoqueQualidade') },
  { path: '/estoque/inventario', label: 'Inventário ABC', group: 'Materiais', icon: BarChart3, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/InventarioABC') },
  { path: '/reservas-estoque', label: 'Reservas e Em Produção', group: 'Materiais', icon: Package, surfaces: ['command'], preload: () => import('@/pages/StockReservations') },
  { path: '/estoque?tab=conversion', label: 'Auditoria de Unidades', group: 'Materiais', icon: Scale, surfaces: ['command'], preload: () => import('@/components/inventory/tabs/UnitConversionAuditTab') },

  // Compras
  { path: '/compras', label: 'Compras', group: 'Compras', icon: ShoppingBag, surfaces: ['hub', 'command'], preload: () => import('@/pages/ComprasHub') },
  { path: '/purchase-planning', label: 'Planejamento', group: 'Compras', icon: Calendar, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/PurchasePlanning') },
  { path: '/quotations', label: 'Cotações (RFQ)', group: 'Compras', icon: FileSpreadsheet, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Quotations') },
  { path: '/purchase-orders', label: 'Ordens de Compra', group: 'Compras', icon: ShoppingBag, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/PurchaseOrders') },
  { path: '/purchase-orders/per-pv', label: 'Compras por Pedido', group: 'Compras', icon: ShoppingCart, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/PurchaseOrdersPerPv') },
  { path: '/compras/inspecao', label: 'Inspeção Receb.', group: 'Compras', icon: ClipboardCheck, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/InspecaoRecebimento') },
  { path: '/suppliers', label: 'Fornecedores', group: 'Compras', icon: Briefcase, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Suppliers') },
  { path: '/custos-insumos', label: 'Custos de Insumos', group: 'Compras', icon: DollarSign, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/InputCostsPage') },
  { path: '/compras/alcadas', label: 'Alçadas', group: 'Compras', icon: Gavel, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/AlcadasCompras') },

  // Expedição (absorve Logística + Etiquetagem)
  { path: '/expedicao', label: 'Expedição', group: 'Expedição', icon: Truck, surfaces: ['hub', 'command'], preload: () => import('@/pages/ExpedicaoHub') },
  { path: '/embalagens', label: 'Embalagens', group: 'Expedição', icon: Box, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/PackagingManagement') },
  { path: '/transporte', label: 'Transporte', group: 'Expedição', icon: Truck, surfaces: ['command'] /* Transporte: 0 tarifas cadastradas */, preload: () => import('@/pages/Transport') },
  { path: '/picking', label: 'Separação · Materiais', group: 'Expedição', icon: ClipboardCheck, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/PickingListPage') },
  { path: '/conferencia-saida', label: 'Conferência · Saída', group: 'Expedição', icon: ClipboardCheck, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/OrderPickingPage') },
  { path: '/manifests', label: 'Romaneios', group: 'Expedição', icon: FileText, surfaces: ['command'] /* Romaneios: 0 registros nas duas tabelas */, preload: () => import('@/pages/Manifests') },
  { path: '/entregas', label: 'Entregas', group: 'Expedição', icon: RouteIcon, surfaces: ['command'] /* Entregas: 0 rotas e 0 rastreamentos */, preload: () => import('@/pages/OwnDeliveriesPage') },
  { path: '/transporters', label: 'Transportadoras', group: 'Expedição', icon: Truck, surfaces: ['command'] /* Transportadoras: 0 registros */, preload: () => import('@/pages/Transporters') },
  { path: '/picking-sessions', label: 'Separação · Bipagem (EAN)', group: 'Expedição', icon: ClipboardCheck, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/Picking') },
  { path: '/delivery-tracking', label: 'Rastreamento', group: 'Expedição', icon: Activity, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/DeliveryTracking') },
  { path: '/label-system', label: 'ETIQUETAGEM', group: 'Expedição', icon: Tag, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/LabelSystem') },
  { path: '/etiquetagem-cliente', label: 'ETIQUETAGEM CLIENTE', group: 'Expedição', icon: Barcode, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/ClientLabeling') },

  // Financeiro
  { path: '/financeiro', label: 'Financeiro', group: 'Financeiro', icon: Wallet, surfaces: ['hub', 'command'], preload: () => import('@/pages/Finance') },
  { path: '/bank-reconciliation', label: 'Conciliação Bancária', group: 'Financeiro', icon: Scale, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/BankReconciliation') },
  { path: '/cnab', label: 'CNAB / Boletos', group: 'Financeiro', icon: FileSpreadsheet, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/CNAB') },
  { path: '/pricing-calculator', label: 'Markup', group: 'Financeiro', icon: Calculator, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/PricingCalculator') },
  { path: '/patrimonio', label: 'Patrimônio', group: 'Financeiro', icon: Buildings, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/Patrimonio') },

  // Fiscal (hub próprio)
  { path: '/fiscal', label: 'Fiscal', group: 'Fiscal', icon: Receipt, surfaces: ['hub', 'command'], preload: () => import('@/pages/FiscalHub') },
  { path: '/nfe', label: 'NF-e', group: 'Fiscal', icon: Receipt, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/NfePage') },
  { path: '/cte', label: 'CT-e', group: 'Fiscal', icon: Truck, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/CTe') },
  { path: '/mdfe', label: 'MDF-e', group: 'Fiscal', icon: FileText, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/MDFe') },
  { path: '/sped', label: 'SPED', group: 'Fiscal', icon: FileText, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/SPED') },
  { path: '/apuracao-impostos', label: 'Impostos', group: 'Fiscal', icon: Calculator, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/ApuracaoImpostos') },
  { path: '/perfis-tributarios', label: 'Perfis Tributários', group: 'Fiscal', icon: Receipt, surfaces: ['command'], preload: () => import('@/pages/PerfisTributarios') },
  { path: '/sped/bloco-k', label: 'SPED Bloco K', group: 'Fiscal', icon: Factory, surfaces: ['command'], preload: () => import('@/pages/BlocoK') },

  // Pessoas
  { path: '/rh', label: 'Pessoas', group: 'RH', icon: Users, surfaces: ['hub', 'command'], preload: () => import('@/pages/RHHub') },
  { path: '/fichas-montadores', label: 'Ficha Montadores', group: 'RH', icon: ClipboardCheck, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/FichaMontadoresPage') },
  { path: '/terceirizados', label: 'Terceirizados', group: 'RH', icon: Truck, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/TerceirizadosHub') },
  // Ajuste de batidas/ausências (workspace único do Ponto). Sem resolver,
  // o dia não desconta nem paga — risco de pagar quem ainda deve horas.
  // Destino final (não o redirect legado /rh/pendencias-ponto).
  { path: '/rh?tab=ponto&subtab=manual', label: 'Pendências de Ponto', group: 'RH', icon: Clock, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Timesheet') },

  // Sistema (admin)
  { path: '/admin/aprovacao-ordens-compra', label: 'Aprovação de Ordens de Compra', group: 'Sistema', icon: ShoppingBag, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/PurchaseOrderApprovals') },
  { path: '/settings', label: 'Configurações', group: 'Sistema', icon: Settings, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Settings') },
  { path: '/automations', label: 'Automações', group: 'Sistema', icon: Zap, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Automations') },
  { path: '/relatorios', label: 'Relatórios', group: 'Sistema', icon: BarChart3, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/RelatoriosHub') },
  { path: '/security', label: 'Segurança & Logs', group: 'Sistema', icon: ShieldCheck, surfaces: ['hub-child', 'command'], preload: () => import('@/pages/Security') },
  // Analytics tem filtros, gráficos e exportação próprios. Não o fundimos ao
  // hub A4 em homologação para não publicar aqueles documentos por associação.
  { path: '/reports', label: 'Analytics & Relatórios', group: 'Sistema', icon: BarChart3, surfaces: ['command'], preload: () => import('@/pages/Reports') },
  { path: '/cost-policies', label: 'Políticas de Custo', group: 'Sistema', icon: Settings, surfaces: ['command'], preload: () => import('@/pages/CostPolicies') },
  { path: '/audit-logs', label: 'Auditoria (Logs)', group: 'Sistema', icon: FileText, surfaces: ['command'], preload: () => import('@/pages/AuditLogs') },
  { path: '/lgpd', label: 'LGPD', group: 'Sistema', icon: Lock, surfaces: ['command'], preload: () => import('@/pages/LGPD') },
  { path: '/system-monitor', label: 'Monitoramento', group: 'Sistema', icon: Monitor, surfaces: ['command'], preload: () => import('@/pages/SystemMonitor') },
  { path: '/system-diagnostics', label: 'Diagnóstico', group: 'Sistema', icon: Cpu, surfaces: ['command'], preload: () => import('@/pages/SystemDiagnostics') },
];

const resourcesByPath = new Map(navigationCatalog.map((resource) => [resource.path, resource]));

function resource(path: string): NavigationResource {
  const item = resourcesByPath.get(path);
  if (!item) throw new Error(`Recurso de navegação ausente: ${path}`);
  return item;
}

/** Obtém o loader e metadados de um destino sem deduzir arquivo pelo path. */
export function getNavigationResource(path: string): NavigationResource | undefined {
  return resourcesByPath.get(path);
}

/** Atalho fixo no topo da sidebar. É o mesmo formato dos outros recursos. */
export const topItem = resource('/dashboard');

/**
 * Atalhos de sistema na faixa fixa da sidebar — filtrados por `canAccessRoute`
 * no chrome. Favoritos do usuário vêm via `useMenuFavorites`.
 */
export const SYSTEM_SHORTCUT_PATHS = [
  '/sales',
  '/producao/planejamento',
  '/materiais',
  '/expedicao',
  '/nfe',
] as const;

export const systemShortcuts: NavigationResource[] = SYSTEM_SHORTCUT_PATHS.map((path) => resource(path));

/**
 * Hubs canônicos da sidebar. Filhos = telas de trabalho; tools secundárias
 * vêm de `getSecondaryRoutesForGroup` pelos `groups`.
 */
const hubsDeclarados: NavigationHub[] = [
  {
    path: '/comercial',
    label: 'Comercial',
    icon: ShoppingCart,
    groups: ['Comercial'],
    children: [
      resource('/sales'),
      resource('/pronta-entrega'),
      resource('/catalogo'),
      resource('/clients'),
      resource('/tarefas'),
    ],
  },
  {
    path: '/engenharia',
    label: 'Engenharia',
    icon: Ruler,
    groups: ['Engenharia'],
    children: [
      resource('/fichas-tecnicas'),
      resource('/escalonamento'),
      resource('/tiras-artesanais'),
      resource('/solados'),
      resource('/silks'),
    ],
  },
  {
    path: '/producao',
    label: 'Produção',
    icon: Factory,
    groups: ['Produção'],
    children: [
      resource('/producao/planejamento'),
      resource('/producao/antecipacao'),
      resource('/producao/kanban'),
      resource('/producao/estouro'),
      resource('/producao/apontamento'),
      resource('/producao/calculadora-grade'),
      resource('/imprimir-fichas'),
      resource('/producao/analises'),
    ],
  },
  {
    path: '/materiais',
    label: 'Materiais',
    icon: Package,
    groups: ['Materiais'],
    children: [
      resource('/estoque'),
      resource('/grupos'),
      resource('/ajuste-estoque'),
      resource('/estoque/qualidade'),
      resource('/estoque/inventario'),
    ],
  },
  {
    path: '/compras',
    label: 'Compras',
    icon: ShoppingBag,
    groups: ['Compras'],
    children: [
      resource('/purchase-planning'),
      resource('/quotations'),
      resource('/purchase-orders'),
      resource('/purchase-orders/per-pv'),
      resource('/compras/inspecao'),
      resource('/suppliers'),
      resource('/custos-insumos'),
      resource('/compras/alcadas'),
    ],
  },
  {
    path: '/expedicao',
    label: 'Expedição',
    icon: Truck,
    groups: ['Expedição'],
    children: [
      resource('/embalagens'),
      resource('/picking'),
      resource('/conferencia-saida'),
      resource('/label-system'),
      resource('/etiquetagem-cliente'),
    ],
  },
  {
    path: '/financeiro',
    label: 'Financeiro',
    icon: Wallet,
    groups: ['Financeiro'],
    children: [
      resource('/bank-reconciliation'),
      resource('/cnab'),
      resource('/pricing-calculator'),
    ],
  },
  {
    path: '/fiscal',
    label: 'Fiscal',
    icon: Receipt,
    groups: ['Fiscal'],
    children: [
      resource('/nfe'),
      resource('/cte'),
      resource('/mdfe'),
      resource('/sped'),
      resource('/apuracao-impostos'),
    ],
  },
  {
    path: '/rh',
    label: 'Pessoas',
    icon: Users,
    groups: ['RH'],
    children: [
      resource('/rh?tab=ponto&subtab=manual'),
      resource('/fichas-montadores'),
      resource('/terceirizados'),
    ],
  },
];

export const HUBS: NavigationHub[] = hubsDeclarados;

const hubsByPath = new Map(HUBS.map((hub) => [hub.path, hub]));

export function getNavigationHub(path: string): NavigationHub | undefined {
  const pathname = path.split('?')[0];
  return hubsByPath.get(pathname);
}

/** Itens da seção admin da sidebar; continuam recursos idênticos aos demais. */
export const systemItems: NavigationResource[] = [
  resource('/admin/aprovacao-ordens-compra'),
  resource('/settings'),
  resource('/automations'),
  resource('/relatorios'),
  resource('/security'),
];

const SYSTEM_PATHS = new Set(systemItems.map((item) => item.path));

/**
 * Destinos de Cmd+K / ferramentas dos hubs que não são hub nem hub-child.
 * Derivado do catálogo — sem lista paralela pra divergir.
 */
export const secondaryRoutes: NavigationResource[] = navigationCatalog.filter(
  (item) =>
    !item.surfaces.includes('hub')
    && !item.surfaces.includes('hub-child')
    && !SYSTEM_PATHS.has(item.path)
    && item.path !== '/dashboard'
    && item.surfaces.some((s) => s === 'command' || s === 'hub-shortcut' || s === 'quick-action'),
);

/** Filtra os atalhos de um hub sem promover a rota para a sidebar. */
export function getSecondaryRoutesForGroup(group: string): NavigationResource[] {
  return secondaryRoutes.filter((route) => route.group === group);
}

/**
 * Compat: grupos “achatados” a partir dos hubs — usados por auditoria,
 * GlobalSearch e testes que ainda esperam `menuGroups`. A sidebar NÃO
 * renderiza estes itens; só os hubs.
 */
export const menuGroups: NavigationGroup[] = HUBS.map((hub) => ({
  label: hub.label,
  icon: hub.icon,
  items: hub.children.filter((item) => item.surfaces.includes('hub-child')),
}));

/** Todos os itens de trabalho (filhos de hub) — base de favoritos. */
export function getAllMenuItems(): NavigationResource[] {
  return [
    ...HUBS.flatMap((hub) => hub.children),
    ...systemItems,
  ];
}

/** Compatibilidade para consumidores que distinguem ação rápida da busca. */
export const actionDestinations: NavigationResource[] = navigationCatalog.filter((item) =>
  item.surfaces.includes('quick-action'),
);

/**
 * Fonte única dos destinos concedíveis. O catálogo já é único por path, então
 * não há mais uma montagem manual que possa divergir das superfícies visuais.
 */
export const grantableDestinations: NavigationResource[] = navigationCatalog.filter((item) =>
  item.surfaces.length > 0,
);

/** Destinos concedíveis agrupados para a matriz de permissões. */
export function getMenuItemsGrouped(): Record<string, NavigationResource[]> {
  const out: Record<string, NavigationResource[]> = {};
  for (const item of grantableDestinations) {
    (out[item.group] ??= []).push(item);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════
// APRESENTAÇÃO POR PERFIL
//
// ⚠ Só apresentação: home + ordem dos hubs. Visibilidade continua em
// ROLE_MODULES + user_permissions (useAccessControl).
// ════════════════════════════════════════════════════════════════════════

export interface RoleMenuPresentation {
  /** Tela onde a pessoa cai ao entrar. */
  home: string;
  /** Ordem dos hubs na sidebar — os sem acesso somem pelo filtro. */
  groupOrder: string[];
}

const ORDEM_COMPLETA = [
  'Comercial', 'Engenharia', 'Produção', 'Materiais',
  'Compras', 'Expedição', 'Financeiro', 'Fiscal', 'RH',
];

export const ROLE_MENU_PRESENTATION: Record<string, RoleMenuPresentation> = {
  admin:   { home: '/dashboard', groupOrder: ORDEM_COMPLETA },
  gerente: { home: '/dashboard', groupOrder: ORDEM_COMPLETA },
  consulta:{ home: '/dashboard', groupOrder: ORDEM_COMPLETA },

  // Quem aponta produção não começa o dia olhando KPI: começa apontando.
  producao:     { home: '/producao/apontamento', groupOrder: ['Produção', 'Materiais', 'Expedição', 'Engenharia', 'RH'] },
  comercial:    { home: '/comercial',            groupOrder: ['Comercial'] },
  nfe_operator: { home: '/fiscal',               groupOrder: ['Fiscal', 'Comercial'] },
  almoxarifado: { home: '/materiais',            groupOrder: ['Materiais'] },
  rh:           { home: '/rh',                   groupOrder: ['RH'] },
};

/**
 * Tela inicial do perfil. Com múltiplos papéis vence o de MAIOR alcance —
 * nunca a ordem incidental das linhas no banco, que mudaria a experiência da
 * pessoa sem ninguém ter decidido nada.
 */
const PRIORIDADE_DE_PAPEL = ['admin', 'gerente', 'consulta', 'producao', 'comercial', 'nfe_operator', 'almoxarifado', 'rh'];

export function resolveRoleHome(roles: readonly string[]): string {
  const papel = PRIORIDADE_DE_PAPEL.find((r) => roles.includes(r));
  return (papel && ROLE_MENU_PRESENTATION[papel]?.home) || '/dashboard';
}

/** Ordena hubs/grupos conforme o perfil. Fora da lista vai pro fim, estável. */
export function orderGroupsForRoles<T extends { label: string }>(groups: T[], roles: readonly string[]): T[] {
  const papel = PRIORIDADE_DE_PAPEL.find((r) => roles.includes(r));
  const ordem = (papel && ROLE_MENU_PRESENTATION[papel]?.groupOrder) || ORDEM_COMPLETA;
  const rank = (label: string) => {
    const i = ordem.indexOf(label);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...groups]
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g.label) - rank(b.g.label) || a.i - b.i)
    .map(({ g }) => g);
}

/** Hub visível se ≥1 filho liberado (Modo 2+3). */
export function hubHasAccessibleChild(
  hub: NavigationHub,
  canAccess: (path: string) => boolean,
): boolean {
  return hub.children.some((child) => canAccess(child.path));
}

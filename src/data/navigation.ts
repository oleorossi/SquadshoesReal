import { Package, ShoppingCart, Gear as Settings, Truck, Factory, Kanban, SquaresFour as LayoutDashboard, Wallet, FileText, Users, Briefcase, Ruler, ShieldCheck, Lightning as Zap, ShoppingBag, ChartBar as BarChart3, Receipt, Footprints, Sparkle as Sparkles, ClipboardText as ClipboardCheck, CurrencyDollar as DollarSign, Calendar, Cube as Box, ListChecks, Stack as Boxes, HandHeart as HeartHandshake, FileXls as FileSpreadsheet, Scales as Scale, Warning as AlertTriangle, Path as RouteIcon, Pulse as Activity, Printer, Tag, ChatText as MessageSquare, TrendUp as TrendingUp, Calculator, Lock, Monitor, Cpu, Buildings, Gavel, Gauge, FolderOpen, Scissors, Clock } from '@phosphor-icons/react';

/** Superfícies onde um recurso pode ser descoberto sem duplicar seu metadado. */
export type NavigationSurface = 'sidebar' | 'command' | 'quick-action' | 'hub-shortcut';

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

// ════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE NAVEGAÇÃO
//
// Um recurso é descrito uma única vez. As listas abaixo só escolhem em qual
// superfície ele aparece e, no caso da sidebar, preservam grupo e ordem.
// ════════════════════════════════════════════════════════════════════════
export const navigationCatalog: NavigationResource[] = [
  // Início
  { path: '/dashboard', label: 'Painel', group: 'Início', icon: LayoutDashboard, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Dashboard') },

  // Comercial
  { path: '/comercial', label: 'Visão Geral', group: 'Comercial', icon: BarChart3, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/ComercialDashboard') },
  { path: '/sales', label: 'Pedidos de Venda', group: 'Comercial', icon: FileText, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/SaleOrders') },
  { path: '/pronta-entrega', label: 'Pronta-Entrega', group: 'Comercial', icon: Box, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/ProntaEntrega') },
  { path: '/clients', label: 'Clientes', group: 'Comercial', icon: Users, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Clients') },
  { path: '/crm', label: 'CRM', group: 'Comercial', icon: HeartHandshake, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/CRM') },
  { path: '/tarefas', label: 'Tarefas', group: 'Comercial', icon: ListChecks, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Tarefas') },
  { path: '/price-lists', label: 'Tabelas de Preço', group: 'Comercial', icon: DollarSign, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/PriceLists') },
  { path: '/notas', label: 'Anotações', group: 'Comercial', icon: FileText, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Notes') },
  { path: '/sac', label: 'SAC', group: 'Comercial', icon: MessageSquare, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/SAC') },
  { path: '/forecast', label: 'Forecast', group: 'Comercial', icon: TrendingUp, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/Forecast') },

  // Engenharia
  { path: '/fichas-tecnicas', label: 'Fichas Técnicas', group: 'Engenharia', icon: Ruler, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/TechnicalSheets') },
  { path: '/escalonamento', label: 'Escalonamento', group: 'Engenharia', icon: Calculator, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/EscalonamentoCadPage') },
  { path: '/calculadora-tiras', label: 'Calculadora de Tiras', group: 'Engenharia', icon: Scissors, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/StrapCalculator') },
  { path: '/solados', label: 'Solados', group: 'Engenharia', icon: Footprints, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/SolesHub') },
  { path: '/silks', label: 'Silks', group: 'Engenharia', icon: Sparkles, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Silks') },
  { path: '/fichas-tecnicas/padroes', label: 'Padrões por Cor', group: 'Engenharia', icon: Sparkles, surfaces: ['command'], preload: () => import('@/pages/ColorStandards') },

  // Produção
  { path: '/producao/planejamento', label: 'Planejamento', group: 'Produção', icon: ClipboardCheck, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/ProducaoPlanejamento') },
  { path: '/producao/kanban', label: 'Kanban', group: 'Produção', icon: Kanban, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/ProducaoKanban') },
  { path: '/producao/estouro', label: 'Estouro de Produção', group: 'Produção', icon: AlertTriangle, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/ProducaoEstouro') },
  { path: '/producao/setores', label: 'Setores', group: 'Produção', icon: Factory, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/ProducaoSetoresConfig') },
  { path: '/producao/apontamento', label: 'Apontamento', group: 'Produção', icon: ListChecks, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Setores') },
  { path: '/imprimir-fichas', label: 'Imprimir Fichas', group: 'Produção', icon: Printer, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/PrintWorkSheets') },
  { path: '/producao/analises', label: 'Análises', group: 'Produção', icon: BarChart3, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/ProducaoAnalises') },
  { path: '/producao/produtividade', label: 'Produtividade por Modelo', group: 'Produção', icon: Gauge, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/ProdutividadeModelos') },
  { path: '/producao/kanban/gestao', label: 'Kanban · Modo Gestão', group: 'Produção', icon: Kanban, surfaces: ['command'], preload: () => import('@/pages/ProducaoKanbanGestao') },
  // Ordens não ocupa a sidebar por decisão do dono, mas é aberta pela FAB e
  // por cards; o mesmo recurso governa ação rápida, busca e permissão granular.
  { path: '/orders', label: 'Ordens de Produção', group: 'Produção', icon: ClipboardCheck, surfaces: ['command', 'quick-action'], preload: () => import('@/pages/Orders') },

  // Materiais
  { path: '/estoque', label: 'Estoque', group: 'Estoque', icon: Package, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Index') },
  { path: '/grupos', label: 'Grupos', group: 'Estoque', icon: FolderOpen, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Groups') },
  { path: '/ajuste-estoque', label: 'Ajustes', group: 'Estoque', icon: Boxes, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/StockAdjustmentPage') },
  { path: '/estoque/qualidade', label: 'Qualidade de Estoque', group: 'Estoque', icon: ShieldCheck, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/EstoqueQualidade') },
  { path: '/estoque/inventario', label: 'Inventário ABC', group: 'Estoque', icon: BarChart3, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/InventarioABC') },
  { path: '/reservas-estoque', label: 'Reservas e Em Produção', group: 'Estoque', icon: Package, surfaces: ['command'], preload: () => import('@/pages/StockReservations') },

  // Compras
  { path: '/purchase-planning', label: 'Planejamento', group: 'Compras', icon: Calendar, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/PurchasePlanning') },
  { path: '/quotations', label: 'Cotações (RFQ)', group: 'Compras', icon: FileSpreadsheet, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Quotations') },
  { path: '/purchase-orders', label: 'Ordens de Compra', group: 'Compras', icon: ShoppingBag, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/PurchaseOrders') },
  { path: '/purchase-orders/per-pv', label: 'Compras por Pedido', group: 'Compras', icon: ShoppingCart, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/PurchaseOrdersPerPv') },
  { path: '/compras/inspecao', label: 'Inspeção Receb.', group: 'Compras', icon: ClipboardCheck, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/InspecaoRecebimento') },
  { path: '/suppliers', label: 'Fornecedores', group: 'Compras', icon: Briefcase, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Suppliers') },
  { path: '/custos-insumos', label: 'Custos de Insumos', group: 'Compras', icon: DollarSign, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/InputCostsPage') },
  { path: '/compras/alcadas', label: 'Alçadas', group: 'Compras', icon: Gavel, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/AlcadasCompras') },

  // Logística
  { path: '/expedicao', label: 'Expedição', group: 'Logística', icon: Package, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/ExpedicaoHub') },
  // Etiquetas pertence à expedição no controle de acesso; agrupá-la aqui evita
  // um grupo de um item que quebra a leitura do fluxo da fábrica.
  { path: '/label-system', label: 'Sistema de Etiquetas', group: 'Logística', icon: Tag, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/LabelSystem') },
  { path: '/embalagens', label: 'Embalagens', group: 'Logística', icon: Box, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/PackagingManagement') },
  { path: '/transporte', label: 'Transporte', group: 'Logística', icon: Truck, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Transport') },
  { path: '/picking', label: 'Separação · Materiais', group: 'Logística', icon: ClipboardCheck, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/PickingListPage') },
  { path: '/conferencia-saida', label: 'Conferência · Saída', group: 'Logística', icon: ClipboardCheck, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/OrderPickingPage') },
  { path: '/manifests', label: 'Romaneios', group: 'Logística', icon: FileText, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Manifests') },
  { path: '/entregas', label: 'Entregas', group: 'Logística', icon: RouteIcon, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/OwnDeliveriesPage') },
  { path: '/transporters', label: 'Transportadoras', group: 'Logística', icon: Truck, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Transporters') },
  { path: '/picking-sessions', label: 'Separação · Bipagem (EAN)', group: 'Logística', icon: ClipboardCheck, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/Picking') },
  { path: '/delivery-tracking', label: 'Rastreamento', group: 'Logística', icon: Activity, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/DeliveryTracking') },

  // Financeiro e obrigações
  { path: '/financeiro', label: 'Financeiro', group: 'Financeiro', icon: Wallet, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Finance') },
  { path: '/bank-reconciliation', label: 'Conciliação Bancária', group: 'Financeiro', icon: Scale, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/BankReconciliation') },
  { path: '/cnab', label: 'CNAB / Boletos', group: 'Financeiro', icon: FileSpreadsheet, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/CNAB') },
  { path: '/pricing-calculator', label: 'Markup', group: 'Financeiro', icon: Calculator, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/PricingCalculator') },
  { path: '/patrimonio', label: 'Patrimônio', group: 'Financeiro', icon: Buildings, surfaces: ['command', 'hub-shortcut'], preload: () => import('@/pages/Patrimonio') },
  { path: '/nfe', label: 'NF-e', group: 'Fiscal', icon: Receipt, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/NfePage') },
  { path: '/cte', label: 'CT-e', group: 'Fiscal', icon: Truck, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/CTe') },
  { path: '/mdfe', label: 'MDF-e', group: 'Fiscal', icon: FileText, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/MDFe') },
  { path: '/sped', label: 'SPED', group: 'Fiscal', icon: FileText, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/SPED') },
  { path: '/apuracao-impostos', label: 'Impostos', group: 'Fiscal', icon: Calculator, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/ApuracaoImpostos') },
  { path: '/perfis-tributarios', label: 'Perfis Tributários', group: 'Fiscal', icon: Receipt, surfaces: ['command'], preload: () => import('@/pages/PerfisTributarios') },
  { path: '/sped/bloco-k', label: 'SPED Bloco K', group: 'Fiscal', icon: Factory, surfaces: ['command'], preload: () => import('@/pages/BlocoK') },

  // Pessoas
  { path: '/rh', label: 'Pessoas', group: 'RH', icon: Users, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/RHHub') },
  { path: '/fichas-montadores', label: 'Ficha Montadores', group: 'RH', icon: ClipboardCheck, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/FichaMontadoresPage') },
  { path: '/terceirizados', label: 'Terceirizados', group: 'RH', icon: Truck, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/TerceirizadosHub') },
  // Esta fila tem filtros, sugestões por padrão e aplicação em lote; não é a
  // mesma revisão manual embutida no Ponto do RH, então permanece no Cmd+K.
  { path: '/rh/pendencias-ponto', label: 'Pendências de Ponto', group: 'RH', icon: Clock, surfaces: ['command'], preload: () => import('@/pages/TimePendings') },

  // Sistema (admin)
  { path: '/settings', label: 'Configurações', group: 'Sistema', icon: Settings, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Settings') },
  { path: '/automations', label: 'Automações', group: 'Sistema', icon: Zap, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Automations') },
  { path: '/relatorios', label: 'Relatórios', group: 'Sistema', icon: BarChart3, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/RelatoriosHub') },
  { path: '/security', label: 'Segurança & Logs', group: 'Sistema', icon: ShieldCheck, surfaces: ['sidebar', 'command'], preload: () => import('@/pages/Security') },
  // Analytics tem filtros, gráficos e exportação próprios. Não o fundimos ao
  // hub A4 em homologação para não publicar aqueles documentos por associação.
  { path: '/reports', label: 'Analytics & Relatórios', group: 'Sistema', icon: BarChart3, surfaces: ['command'], preload: () => import('@/pages/Reports') },
  { path: '/cost-policies', label: 'Políticas de Custo', group: 'Sistema', icon: Settings, surfaces: ['command'], preload: () => import('@/pages/CostPolicies') },
  { path: '/audit-logs', label: 'Auditoria (Logs)', group: 'Sistema', icon: FileText, surfaces: ['command'], preload: () => import('@/pages/AuditLogs') },
  { path: '/lgpd', label: 'LGPD', group: 'Sistema', icon: Lock, surfaces: ['command'], preload: () => import('@/pages/LGPD') },
  { path: '/system-monitor', label: 'Monitoramento', group: 'Sistema', icon: Monitor, surfaces: ['command'], preload: () => import('@/pages/SystemMonitor') },
  { path: '/system-diagnostics', label: 'Diagnóstico', group: 'Sistema', icon: Cpu, surfaces: ['command'], preload: () => import('@/pages/SystemDiagnostics') },
  { path: '/unit-audit', label: 'Auditoria de Unidades', group: 'Sistema', icon: Scale, surfaces: ['command'], preload: () => import('@/pages/UnitAudit') },
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
 * Fonte de desenho da sidebar: preserva agrupamento e ordem deliberada do
 * fluxo fábrica (vender → projetar → produzir → materiais → comprar → expedir
 * → dinheiro → obrigações → pessoas), sem transformar a navegação numa lista.
 */
export const menuGroups: NavigationGroup[] = [
  {
    label: 'Comercial', icon: ShoppingCart,
    items: [resource('/comercial'), resource('/sales'), resource('/pronta-entrega'), resource('/clients'), resource('/crm'), resource('/tarefas'), resource('/price-lists'), resource('/notas')],
  },
  {
    label: 'Engenharia', icon: Ruler,
    items: [resource('/fichas-tecnicas'), resource('/escalonamento'), resource('/calculadora-tiras'), resource('/solados'), resource('/silks')],
  },
  {
    label: 'Produção', icon: Factory,
    items: [resource('/producao/planejamento'), resource('/producao/kanban'), resource('/producao/estouro'), resource('/producao/setores'), resource('/producao/apontamento'), resource('/imprimir-fichas'), resource('/producao/analises')],
  },
  {
    label: 'Estoque', icon: Package,
    items: [resource('/estoque'), resource('/grupos'), resource('/ajuste-estoque'), resource('/estoque/qualidade'), resource('/estoque/inventario')],
  },
  {
    label: 'Compras', icon: ShoppingBag,
    items: [resource('/purchase-planning'), resource('/quotations'), resource('/purchase-orders'), resource('/purchase-orders/per-pv'), resource('/compras/inspecao'), resource('/suppliers'), resource('/custos-insumos'), resource('/compras/alcadas')],
  },
  {
    label: 'Logística', icon: Truck,
    items: [resource('/expedicao'), resource('/label-system'), resource('/embalagens'), resource('/transporte'), resource('/picking'), resource('/conferencia-saida'), resource('/manifests'), resource('/entregas'), resource('/transporters')],
  },
  {
    label: 'Financeiro', icon: Wallet,
    items: [resource('/financeiro'), resource('/bank-reconciliation'), resource('/cnab'), resource('/pricing-calculator')],
  },
  {
    label: 'Fiscal', icon: Receipt,
    items: [resource('/nfe'), resource('/cte'), resource('/mdfe'), resource('/sped'), resource('/apuracao-impostos')],
  },
  {
    label: 'RH', icon: Users,
    items: [resource('/rh'), resource('/fichas-montadores'), resource('/terceirizados')],
  },
];

/** Itens da seção admin da sidebar; continuam recursos idênticos aos demais. */
export const systemItems: NavigationResource[] = [
  resource('/settings'),
  resource('/automations'),
  resource('/relatorios'),
  resource('/security'),
];

/** Destinos de Cmd+K e atalhos dos hubs que não ocupam a sidebar. */
export const secondaryRoutes: NavigationResource[] = [
  resource('/sac'),
  resource('/forecast'),
  resource('/producao/produtividade'),
  resource('/producao/kanban/gestao'),
  resource('/orders'),
  resource('/reservas-estoque'),
  resource('/fichas-tecnicas/padroes'),
  resource('/picking-sessions'),
  resource('/delivery-tracking'),
  resource('/patrimonio'),
  resource('/perfis-tributarios'),
  resource('/sped/bloco-k'),
  resource('/rh/pendencias-ponto'),
  resource('/reports'),
  resource('/cost-policies'),
  resource('/audit-logs'),
  resource('/lgpd'),
  resource('/system-monitor'),
  resource('/system-diagnostics'),
  resource('/unit-audit'),
];

/** Filtra os atalhos de um hub sem promover a rota para a sidebar. */
export function getSecondaryRoutesForGroup(group: string): NavigationResource[] {
  return secondaryRoutes.filter((route) => route.group === group);
}

/** Todos os itens visíveis nos grupos da sidebar, achatados para favoritos. */
export function getAllMenuItems(): NavigationResource[] {
  return menuGroups.flatMap((group) => group.items);
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

import { Package, ShoppingCart, Gear as Settings, Truck, Factory, Kanban, SquaresFour as LayoutDashboard, Wallet, FileText, Users, UserCheck, Briefcase, Ruler, ShieldCheck, Lightning as Zap, ShoppingBag, ChartBar as BarChart3, Receipt, Footprints, Sparkle as Sparkles, ClipboardText as ClipboardCheck, CurrencyDollar as DollarSign, Calendar, Cube as Box, ClockCounterClockwise as History, ListChecks, Stack as Boxes, Clock, HandHeart as HeartHandshake, FileXls as FileSpreadsheet, Scales as Scale, Warning as AlertTriangle, Path as RouteIcon, Pulse as Activity, ChartLine as GanttChartSquare, Printer, Tag, ChatText as MessageSquare, TrendUp as TrendingUp, Calculator, Lock, Monitor, Cpu, Timer, Buildings, Gavel, Gauge } from '@phosphor-icons/react';

// ════════════════════════════════════════════════════════════════════════
// SQUAD SHOES — Sidebar
// Reorganização 2026-05-08 (round-6): 53 → 32 itens visíveis (-40%)
//
// Princípios (referência: SAP Fiori "Spaces & Pages"):
//   1. Sidebar = pontos de entrada por contexto de trabalho, NÃO catálogo
//      de features. Máx 5 itens por grupo.
//   2. Sub-features de cada área viram TABS dentro da página hub
//      (HubTabs.tsx). Ex: Fluxo/Live/Timeline/Visão Agregada/Centro
//      Controle ficam dentro de PCP, não na sidebar.
//   3. Rotas continuam todas válidas — só não enchem o menu lateral.
//      Acesso direto: URL, GlobalSearch (Cmd+K), favoritos, atalhos.
//   4. Round-7 (futuro): role-based filtering mais agressivo — vendedor
//      vê só Comercial+RH, operador vê só Produção, etc.
// ════════════════════════════════════════════════════════════════════════

export const topItem = {
  name: "Painel",
  icon: LayoutDashboard,
  path: "/dashboard",
};

export const menuGroups = [
  {
    label: "Etiquetas",
    icon: Tag,
    items: [
      { name: "Sistema de Etiquetas", icon: Tag, path: "/label-system" },
    ],
  },
  {
    label: "Comercial",
    icon: ShoppingCart,
    items: [
      { name: "Pedidos de Venda", icon: FileText,         path: "/sales" },
      { name: "Pronta-Entrega",   icon: Box,              path: "/pronta-entrega" },
      { name: "Clientes",         icon: Users,            path: "/clients" },
      { name: "CRM",              icon: HeartHandshake,   path: "/crm" },
      { name: "Tarefas",          icon: ListChecks,       path: "/tarefas" },
      { name: "Tabelas de Preço", icon: DollarSign,       path: "/price-lists" },
      { name: "Notas",            icon: FileText,         path: "/notas" },
    ],
  },
  {
    label: "Produção",
    icon: Factory,
    items: [
      { name: "PCP",              icon: Kanban,            path: "/pcp" },
      { name: "Ordens (OPs)",     icon: ListChecks,        path: "/orders" },
      { name: "Imprimir Fichas",  icon: Printer,           path: "/imprimir-fichas" },
      { name: "Capacidade",       icon: BarChart3,         path: "/capacity-planning" },
      { name: "Gargalos",         icon: AlertTriangle,     path: "/gargalos" },
      { name: "Terceiros na Rua", icon: Truck,             path: "/terceiros-na-rua" },
    ],
  },
  {
    label: "Estoque",
    icon: Package,
    items: [
      { name: "Estoque",          icon: Package,        path: "/estoque" },
      { name: "MRP",              icon: Boxes,          path: "/mrp" },
      { name: "Picking",          icon: ClipboardCheck, path: "/picking" },
      { name: "Ajustes",          icon: Boxes,          path: "/ajuste-estoque" },
      { name: "Qualidade",        icon: ShieldCheck,  path: "/estoque/qualidade" },
      { name: "Histórico",        icon: History,      path: "/estoque/historico" },
      { name: "Inventário ABC",   icon: BarChart3,    path: "/estoque/inventario" },
    ],
  },
  {
    label: "Engenharia",
    icon: Ruler,
    items: [
      { name: "Fichas Técnicas",  icon: Ruler,        path: "/fichas-tecnicas" },
      { name: "Solados",          icon: Footprints,   path: "/solados" },
      { name: "Silks",            icon: Sparkles,     path: "/silks" },
      { name: "Receitas",         icon: Sparkles,     path: "/artisanal-recipes" },
    ],
  },
  {
    label: "Compras",
    icon: ShoppingBag,
    items: [
      { name: "Planejamento",     icon: Calendar,        path: "/purchase-planning" },
      { name: "Cotações (RFQ)",   icon: FileSpreadsheet, path: "/quotations" },
      { name: "Ordens de Compra", icon: ShoppingBag,     path: "/purchase-orders" },
      { name: "Inspeção Receb.",  icon: ClipboardCheck,  path: "/compras/inspecao" },
      { name: "Fornecedores",     icon: Briefcase,       path: "/suppliers" },
      { name: "Custos de Insumos", icon: DollarSign,     path: "/custos-insumos" },
      { name: "Alçadas",          icon: Gavel,           path: "/compras/alcadas" },
    ],
  },
  {
    label: "Logística",
    icon: Truck,
    items: [
      { name: "Expedição",        icon: Package,        path: "/expedicao" },
      { name: "Conferência",      icon: ClipboardCheck, path: "/conferencia-saida" },
      { name: "Romaneios",        icon: FileText,       path: "/manifests" },
      { name: "Entregas",         icon: RouteIcon,      path: "/entregas" },
      { name: "Transportadoras",  icon: Truck,          path: "/transporters" },
    ],
  },
  {
    label: "Financeiro",
    icon: Wallet,
    items: [
      { name: "Financeiro",       icon: Wallet,          path: "/financeiro" },
      { name: "Contas (AR/AP)",   icon: DollarSign,      path: "/finance" },
      { name: "Conciliação",      icon: Scale,           path: "/bank-reconciliation" },
      { name: "CNAB / Boletos",   icon: FileSpreadsheet, path: "/cnab" },
      { name: "Markup / Pricing", icon: Calculator,      path: "/pricing-calculator" },
    ],
  },
  {
    label: "Fiscal",
    icon: Receipt,
    items: [
      { name: "NF-e",     icon: Receipt,    path: "/nfe" },
      { name: "CT-e",     icon: Truck,      path: "/cte" },
      { name: "MDF-e",    icon: FileText,   path: "/mdfe" },
      { name: "SPED",     icon: FileText,   path: "/sped" },
      { name: "Impostos", icon: Calculator, path: "/apuracao-impostos" },
    ],
  },
  {
    label: "RH",
    icon: Users,
    items: [
      { name: "Ponto & Folha",      icon: LayoutDashboard,path: "/rh" },
      { name: "Terceirizados",      icon: UserCheck,      path: "/contractors" },
      { name: "Relatório Terceiros",icon: BarChart3,      path: "/terceiros/relatorios" },
    ],
  },
];

// Sistema (admin) — consolidado: 8 → 4 itens. Restantes acessíveis via
// /settings (hub) ou GlobalSearch (Cmd+K).
export const systemItems = [
  { to: '/settings',           icon: Settings,    label: 'Configurações' },
  { to: '/automations',        icon: Zap,         label: 'Automações' },
  { to: '/relatorios',         icon: BarChart3,   label: 'Relatórios' },
  { to: '/security',           icon: ShieldCheck, label: 'Segurança & Logs' },
];

// ════════════════════════════════════════════════════════════════════════
// SECONDARY ROUTES — não aparecem na sidebar pra não poluir, mas:
//   - são indexadas no GlobalSearch (Cmd+K) pra busca por nome
//   - são listadas pelas páginas hub como "Atalhos" / "Outras visualizações"
//   - a rota continua válida e acessível por URL direta / favoritos
// Source of truth única — evita rota-fantasma quando alguém adiciona página
// nova mas esquece de cadastrar em algum lugar.
// ════════════════════════════════════════════════════════════════════════
export const secondaryRoutes: ReadonlyArray<{ name: string; icon: typeof Box; path: string; group: string }> = [
  // Comercial
  { name: "SAC",                  icon: MessageSquare,    path: "/sac",                    group: "Comercial" },
  { name: "Forecast",             icon: TrendingUp,       path: "/forecast",               group: "Comercial" },
  // Produção (visualizações alternativas + utilitários)
  { name: "Fluxo de Produção",    icon: Kanban,           path: "/producao/fluxo",         group: "Produção" },
  { name: "Live (Tempo Real)",    icon: Activity,         path: "/producao/live",          group: "Produção" },
  { name: "Timeline",             icon: GanttChartSquare, path: "/producao/timeline",      group: "Produção" },
  { name: "Visão Agregada",       icon: Kanban,           path: "/producao/visao-agregada", group: "Produção" },
  { name: "Centro de Controle",   icon: AlertTriangle,    path: "/centro-controle",        group: "Produção" },
  { name: "Qualidade",            icon: ShieldCheck,      path: "/quality",                group: "Produção" },
  { name: "Cronoanálise",         icon: Timer,            path: "/cronoanalise",           group: "Produção" },
  { name: "Paradas & OEE",        icon: Gauge,            path: "/producao/paradas",       group: "Produção" },
  { name: "Tempos de Setup",      icon: Clock,            path: "/producao/setup-times",   group: "Produção" },
  // Logística
  { name: "Embalagens",           icon: Box,              path: "/embalagens",             group: "Logística" },
  { name: "Sessões de Picking",   icon: ClipboardCheck,   path: "/picking-sessions",       group: "Logística" },
  { name: "Rastreamento",         icon: Activity,         path: "/delivery-tracking",      group: "Logística" },
  // "Etiquetas" (/label-system) tem grupo próprio "Etiquetas" no topo do menu.
  // Financeiro (visíveis na barra: Financeiro/Contas/Conciliação/CNAB/Pricing)
  { name: "Patrimônio",           icon: Buildings,        path: "/patrimonio",             group: "Financeiro" },
  // Fiscal (visíveis na barra: NF-e/CT-e/MDF-e/SPED/Impostos; estas ficam em Cmd+K)
  { name: "Perfis Tributários",   icon: Receipt,          path: "/perfis-tributarios",     group: "Fiscal" },
  { name: "SPED Bloco K",         icon: Factory,          path: "/sped/bloco-k",           group: "Fiscal" },
  // Sistema (admin)
  { name: "Auditoria (Logs)",     icon: FileText,         path: "/audit-logs",             group: "Sistema" },
  { name: "LGPD",                 icon: Lock,             path: "/lgpd",                   group: "Sistema" },
  { name: "Monitoramento",        icon: Monitor,          path: "/system-monitor",         group: "Sistema" },
  { name: "Diagnóstico",          icon: Cpu,              path: "/system-diagnostics",     group: "Sistema" },
];

/** Filtra secondaryRoutes do grupo informado — usado pelas páginas hub. */
export function getSecondaryRoutesForGroup(group: string) {
  return secondaryRoutes.filter((r) => r.group === group);
}

// ════════════════════════════════════════════════════════════════════════
// Sub-features movidas para TABS internas (rotas continuam ativas):
//   Comercial: /sac /forecast → tabs em /sales ou hub Comercial
//   Produção:  /producao/fluxo /producao/live /producao/timeline
//              /producao/visao-agregada /centro-controle
//              /imprimir-fichas /picking → tabs dentro de /pcp
//   Logística: /embalagens /picking-sessions /delivery-tracking
//              → tabs dentro de /expedicao
//              (/label-system tem grupo próprio "Etiquetas" no topo)
//   Financeiro: /pricing-calculator /cte /mdfe /cnab → tabs dentro
//               de /financeiro
//   Sistema:    /audit-logs /lgpd /system-monitor /system-diagnostics
//               → tabs dentro de /security (e/ou /settings)
//
// Round-5 já tinha removido: /comercial /producao /alertas-estoque
//   /reservas-estoque /consumo-base /transporte
// ════════════════════════════════════════════════════════════════════════

import { Package, ShoppingCart, Gear as Settings, Truck, Factory, Kanban, SquaresFour as LayoutDashboard, Wallet, FileText, Users, Briefcase, Ruler, ShieldCheck, Lightning as Zap, ShoppingBag, ChartBar as BarChart3, Receipt, Footprints, Sparkle as Sparkles, ClipboardText as ClipboardCheck, CurrencyDollar as DollarSign, Calendar, Cube as Box, ClockCounterClockwise as History, ListChecks, Stack as Boxes, Clock, HandHeart as HeartHandshake, FileXls as FileSpreadsheet, Scales as Scale, Warning as AlertTriangle, Path as RouteIcon, Pulse as Activity, ChartLine as GanttChartSquare, Printer, Tag, ChatText as MessageSquare, TrendUp as TrendingUp, Calculator, Lock, Monitor, Cpu, Timer, Buildings, Gavel, Gauge, FolderOpen, Wrench, Scissors } from '@phosphor-icons/react';

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
      { name: "Visão Geral",      icon: BarChart3,        path: "/comercial" },
      { name: "Pedidos de Venda", icon: FileText,         path: "/sales" },
      { name: "Pronta-Entrega",   icon: Box,              path: "/pronta-entrega" },
      { name: "Clientes",         icon: Users,            path: "/clients" },
      { name: "CRM",              icon: HeartHandshake,   path: "/crm" },
      { name: "Tarefas",          icon: ListChecks,       path: "/tarefas" },
      { name: "Tabelas de Preço", icon: DollarSign,       path: "/price-lists" },
      { name: "Anotações",        icon: FileText,         path: "/notas" },
    ],
  },
  {
    label: "Produção",
    icon: Factory,
    items: [
      { name: "PCP",              icon: Kanban,            path: "/pcp" },
      // Atalho direto pro acompanhamento setor a setor (2026-07-01): operação de
      // setor era o destino mais frequente e custava PCP → Produzir → Setores.
      { name: "Setores",          icon: Factory,           path: "/pcp?tab=setores" },
      { name: "Ordens (OPs)",     icon: ListChecks,        path: "/orders" },
      { name: "Imprimir Fichas",  icon: Printer,           path: "/imprimir-fichas" },
      // Saíram daqui (2026-06-28): "Capacidade" (/capacity-planning) já é aba do PCP
      // (Planejar→Capacidade) — evitava o mesmo destino por dois caminhos; "Ficha
      // Montadores" foi pro grupo RH (produtividade das pessoas que montam).
    ],
  },
  {
    label: "Estoque",
    icon: Package,
    items: [
      { name: "Estoque",            icon: Package,      path: "/estoque" },
      { name: "Grupos",             icon: FolderOpen,   path: "/grupos" },
      // Saíram do Estoque (2026-06-28): "MRP" (/mrp) era redirect pro Planejamento de
      // Compras (?tab=mrp) — duplicava aquela aba e MRP é suprimentos, não estoque;
      // "Histórico" (/estoque/historico) já é aba dentro de /estoque.
      { name: "Ajustes",            icon: Boxes,        path: "/ajuste-estoque" },
      { name: "Qualidade de Estoque", icon: ShieldCheck, path: "/estoque/qualidade" },
      { name: "Inventário ABC",     icon: BarChart3,    path: "/estoque/inventario" },
    ],
  },
  {
    label: "Engenharia",
    icon: Ruler,
    items: [
      { name: "Fichas Técnicas",  icon: Ruler,        path: "/fichas-tecnicas" },
      { name: "Escalonamento",    icon: Calculator,   path: "/escalonamento" },
      { name: "Calculadora de Tiras", icon: Scissors, path: "/calculadora-tiras" },
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
      // "MRP (Necessidades)" (/mrp-advanced) unificado na aba MRP do Planejamento
      // (2026-06-28): é o MESMO motor canônico (v_mrp_needs), agora no topo da aba.
      // A rota /mrp-advanced segue viva pra bookmarks antigos.
      { name: "Cotações (RFQ)",   icon: FileSpreadsheet, path: "/quotations" },
      { name: "Ordens de Compra", icon: ShoppingBag,     path: "/purchase-orders" },
      // "Ordens de Serviço" removido da sidebar (auditoria 2026-06-28): era porta
      // DUPLICADA pro hub /terceirizados (a rota /ordens-servico continua como
      // redirect de bookmark em App.tsx → /terceirizados?tab=orders). A gestão de
      // OS de terceirização vive em RH → Terceirizados.
      { name: "Compras por Pedido", icon: ShoppingCart,  path: "/purchase-orders/per-pv" },
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
      // Embalagens (/embalagens) exposto no menu (2026-07-04): módulo próprio de
      // cadastro/estoque de caixas (box_types) + vínculos + débito. Era órfão
      // (só via URL/Cmd+K). Continua sendo uma aba do hub Expedição também.
      { name: "Embalagens",       icon: Box,            path: "/embalagens" },
      // "Transporte" (/transporte) exposto (2026-06-28): hub de baús/embalagens/
      // tarifas/simulador/rotas — era órfão (só alcançável por cards da Expedição).
      { name: "Transporte",       icon: Truck,          path: "/transporte" },
      // Picking/Conferência com nomes distintos pra deixar o FLUXO claro (são 3
      // etapas, não duplicatas): Materiais (semanal, mesma tela da aba "Separação
      // Semanal" do PCP) → Bipagem EAN (em atalhos) → Conferência de Saída.
      { name: "Separação · Materiais (Semanal)", icon: ClipboardCheck, path: "/picking" },
      { name: "Conferência · Saída", icon: ClipboardCheck, path: "/conferencia-saida" },
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
      // "Contas (AR/AP)" removido (2026-06-28): era só deep-link da aba "Contas" do
      // próprio /financeiro — a aba continua lá dentro do hub.
      { name: "Conciliação Bancária", icon: Scale,       path: "/bank-reconciliation" },
      { name: "CNAB / Boletos",   icon: FileSpreadsheet, path: "/cnab" },
      { name: "Markup",           icon: Calculator,      path: "/pricing-calculator" },
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
      // "Pessoas" = hub INTERNO (Funcionários/Ponto/Reconciliação/Folha em /rh).
      // Renomeado de "Ponto & Folha" (2026-06-28, pedido do dono): o nome antigo
      // escondia que ali mora o cadastro de Funcionários. Dois hubs distintos no
      // setor RH — "Pessoas" (interno) e "Terceirizados" (externo) — de propósito.
      { name: "Pessoas",            icon: Users,          path: "/rh" },
      // "Ficha Montadores" trazida de Produção (2026-06-28): produtividade das
      // pessoas que montam → fica no setor de gente.
      { name: "Ficha Montadores",   icon: ClipboardCheck, path: "/fichas-montadores" },
      // "Terceirizados" (/terceirizados) movido do grupo Produção pro RH
      // (pedido do dono 2026-06-20) — gestão de contratadas/terceirizados é
      // função de RH. Mantido SEPARADO de "Pessoas" (externo ≠ interno).
      { name: "Terceirizados",      icon: Truck,          path: "/terceirizados" },
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
  // As 4 visões abaixo viraram MODOS do "Quadro de Produção" no hub PCP
  // (2026-07-01) — as rotas standalone /producao/* redirecionam pra cá.
  { name: "Fluxo de Produção",    icon: Kanban,           path: "/pcp?tab=quadro&modo=matriz",   group: "Produção" },
  { name: "Live (Tempo Real)",    icon: Activity,         path: "/pcp?tab=quadro&modo=cartoes",  group: "Produção" },
  { name: "Timeline",             icon: GanttChartSquare, path: "/pcp?tab=quadro&modo=timeline", group: "Produção" },
  { name: "Visão Agregada",       icon: Kanban,           path: "/pcp?tab=quadro&modo=lote",     group: "Produção" },
  { name: "Centro de Controle",   icon: AlertTriangle,    path: "/centro-controle",        group: "Produção" },
  { name: "Qualidade de Produção", icon: ShieldCheck,     path: "/quality",                group: "Produção" },
  { name: "Cronoanálise",         icon: Timer,            path: "/cronoanalise",           group: "Produção" },
  { name: "Paradas & OEE",        icon: Gauge,            path: "/producao/paradas",       group: "Produção" },
  { name: "Tempos de Setup",      icon: Clock,            path: "/producao/setup-times",   group: "Produção" },
  // Logística
  { name: "Embalagens",           icon: Box,              path: "/embalagens",             group: "Logística" },
  { name: "Separação · Bipagem (EAN)", icon: ClipboardCheck, path: "/picking-sessions",   group: "Logística" },
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
// Catálogo PLANO dos itens de menu (1 entrada por janela da sidebar). Fonte
// única pra: (1) checkboxes de permissão POR ITEM no cadastro/edição de
// usuário; (2) resolução de "dono" de uma rota no controle de acesso granular
// (useAccessControl.isRouteAllowed). Derivado de menuGroups — item novo na
// sidebar aparece automaticamente como permissão selecionável, sem lista
// paralela pra manter em sincronia. (Permissão por menu, user 2026-06-17.)
// ════════════════════════════════════════════════════════════════════════
export interface FlatMenuItem {
  path: string;
  label: string;
  group: string;
}

/** Todos os itens visíveis da sidebar (menuGroups), achatados. */
export function getAllMenuItems(): FlatMenuItem[] {
  return menuGroups.flatMap((g) =>
    g.items.map((it) => ({ path: it.path, label: it.name, group: g.label })),
  );
}

/** Itens de menu agrupados pelo rótulo do grupo (pra render dos checkboxes). */
export function getMenuItemsGrouped(): Record<string, FlatMenuItem[]> {
  const out: Record<string, FlatMenuItem[]> = {};
  for (const g of menuGroups) {
    out[g.label] = g.items.map((it) => ({ path: it.path, label: it.name, group: g.label }));
  }
  return out;
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

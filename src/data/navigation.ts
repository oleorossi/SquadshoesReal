import {
  Package, ShoppingCart, Settings, Truck,
  Factory, Kanban, LayoutDashboard, Wallet,
  FileText, Users, UserCheck, Briefcase,
  Ruler, PackageOpen, ShieldCheck, Zap,
  ShoppingBag, Monitor, Cpu,
  BarChart2, BarChart3, Receipt,
  Footprints, Sparkles, Tag, ClipboardCheck,
  DollarSign, Calendar, Box, History,
  ListChecks, Boxes, Activity, GanttChartSquare, Clock,
  Calculator, TrendingUp, HeartHandshake, MessageSquare,
  FileSpreadsheet, Lock, Scale, FileCheck2, AlertTriangle, Printer,
  Route as RouteIcon,
} from 'lucide-react';

// ════════════════════════════════════════════════════════════════════════
// SQUAD SHOES — Sidebar
// Reorganizado em 2026-05-07 (audit-round-5): 38 → 24 itens visíveis (-37%)
// Princípios:
//   1. Cada grupo no MÁX 4 itens (estava chegando a 9 — confuso)
//   2. Painéis duplicados unificados: "Painel Comercial"/"Painel Produção"/
//      "Painel Financeiro" foram removidos do sidebar — acessíveis pelo
//      header da página principal de cada área
//   3. Sub-features (MRP/Capacidade/Reservas/Histórico/Transporte/Receitas/
//      Consumo Base/Monitor/Diagnóstico) ficam acessíveis via URL direta
//      ou tabs internos das páginas hub (continuam funcionando)
//   4. "Pessoas" virou "RH" (mais óbvio); "Estoque & Compras" splittado em
//      "Estoque" + "Compras" (escopos distintos)
// ════════════════════════════════════════════════════════════════════════

export const topItem = {
  name: "Painel",
  icon: LayoutDashboard,
  path: "/dashboard",
};

export const menuGroups = [
  {
    label: "Comercial",
    icon: ShoppingCart,
    items: [
      { name: "Pedidos de Venda", icon: FileText,         path: "/sales" },
      { name: "Pronta-Entrega",   icon: Box,              path: "/pronta-entrega" },
      { name: "Clientes",         icon: Users,            path: "/clients" },
      { name: "Tabelas de Preço", icon: DollarSign,       path: "/price-lists" },
      { name: "CRM",              icon: HeartHandshake,   path: "/crm" },
      { name: "SAC",              icon: MessageSquare,    path: "/sac" },
      { name: "Forecast",         icon: TrendingUp,       path: "/forecast" },
    ],
  },
  {
    label: "Produção",
    icon: Factory,
    items: [
      { name: "PCP",              icon: Kanban,            path: "/pcp" },
      { name: "Ordens (OPs)",     icon: ListChecks,        path: "/orders" },
      { name: "Live",             icon: Activity,          path: "/producao/live" },
      { name: "Timeline",         icon: GanttChartSquare,  path: "/producao/timeline" },
      { name: "Capacidade",       icon: BarChart3,         path: "/capacity-planning" },
      { name: "Centro Controle",  icon: AlertTriangle,     path: "/centro-controle" },
      { name: "Imprimir Fichas",  icon: Printer,           path: "/imprimir-fichas" },
      { name: "Picking",          icon: ClipboardCheck,    path: "/picking" },
      { name: "Qualidade",        icon: ShieldCheck,       path: "/quality" },
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
    label: "Estoque",
    icon: Package,
    items: [
      { name: "Posição",          icon: Package,      path: "/estoque" },
      { name: "Ajustes",          icon: Boxes,        path: "/ajuste-estoque" },
      { name: "Histórico",        icon: History,      path: "/estoque/historico" },
      { name: "MRP",              icon: Boxes,        path: "/mrp" },
    ],
  },
  {
    label: "Compras",
    icon: ShoppingBag,
    items: [
      { name: "Ordens de Compra", icon: ShoppingBag,  path: "/purchase-orders" },
      { name: "Cotações (RFQ)",   icon: FileSpreadsheet, path: "/quotations" },
      { name: "Planejamento",     icon: Calendar,     path: "/purchase-planning" },
      { name: "Fornecedores",     icon: Briefcase,    path: "/suppliers" },
      { name: "Custos de Insumos", icon: DollarSign,  path: "/custos-insumos" },
    ],
  },
  {
    label: "Logística",
    icon: Truck,
    items: [
      { name: "Expedição",        icon: PackageOpen,    path: "/expedicao" },
      { name: "Conferência",      icon: ClipboardCheck, path: "/conferencia-saida" },
      { name: "Romaneios",        icon: FileCheck2,     path: "/manifests" },
      { name: "Transportadoras",  icon: Truck,          path: "/transporters" },
      { name: "Entregas",         icon: RouteIcon,      path: "/entregas" },
      { name: "Rastreamento",     icon: Activity,       path: "/delivery-tracking" },
      { name: "Etiquetas",        icon: Tag,            path: "/label-system" },
    ],
  },
  {
    label: "Financeiro",
    icon: Wallet,
    items: [
      { name: "Financeiro",       icon: Wallet,         path: "/financeiro" },
      { name: "Contas (AR/AP)",   icon: DollarSign,     path: "/finance" },
      { name: "Markup",           icon: Calculator,     path: "/pricing-calculator" },
      { name: "NF-e",             icon: Receipt,        path: "/nfe" },
      { name: "CT-e",             icon: Truck,          path: "/cte" },
      { name: "MDF-e",            icon: FileText,       path: "/mdfe" },
      { name: "CNAB / Boletos",   icon: FileSpreadsheet, path: "/cnab" },
      { name: "Conciliação",      icon: Scale,          path: "/bank-reconciliation" },
      { name: "SPED",             icon: FileText,       path: "/sped" },
    ],
  },
  {
    label: "RH",
    icon: Users,
    items: [
      { name: "Painel RH",        icon: LayoutDashboard,path: "/rh" },
      { name: "Banco de Horas",   icon: Clock,          path: "/rh/banco-de-horas" },
      { name: "Terceirizados",    icon: UserCheck,      path: "/contractors" },
    ],
  },
];

export const systemItems = [
  { to: '/settings',           icon: Settings,  label: 'Configurações' },
  { to: '/automations',        icon: Zap,       label: 'Automações' },
  { to: '/reports',            icon: BarChart2, label: 'Relatórios' },
  { to: '/audit-logs',         icon: FileText,  label: 'Auditoria' },
  { to: '/lgpd',               icon: Lock,      label: 'LGPD' },
  { to: '/security',           icon: ShieldCheck, label: 'Segurança' },
  { to: '/system-monitor',     icon: Monitor,   label: 'Monitoramento' },
  { to: '/system-diagnostics', icon: Cpu,       label: 'Diagnóstico' },
];

// ════════════════════════════════════════════════════════════════════════
// Itens REMOVIDOS do sidebar (rotas continuam ativas e acessíveis):
//   - /comercial (Painel Comercial) — header/dashboard de /sales
//   - /producao (Painel Produção) — substituído por /pcp + /capacity-planning
//   - /alertas-estoque — alertas integrados em /estoque (badge na lista)
//   - /reservas-estoque — tab interna em /estoque (Reservas)
//   - /consumo-base — tab interna em /fichas-tecnicas
//   - /transporte — tab interna em /expedicao
// ════════════════════════════════════════════════════════════════════════

import {
  Package, ShoppingCart, Settings, Truck,
  Factory, Kanban, LayoutDashboard, Wallet,
  Calculator, FileText, Users, Clock, UserCheck, Briefcase,
  Ruler, PackageOpen, ShieldCheck, Zap, BellRing,
  ArrowUpDown, ShoppingBag, Monitor, Cpu, Scale,
  BarChart2, BarChart3, PieChart, Receipt, Palette,
  BookOpen, Footprints, Sparkles, Tag, ClipboardCheck,
  DollarSign, Calendar, Bookmark, Box, History,
} from 'lucide-react';

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
      { name: "Pedidos",          icon: FileText,     path: "/sales" },
      { name: "Clientes",         icon: Users,        path: "/clients" },
      { name: "Pronta-entrega",   icon: Box,          path: "/pronta-entrega" },
      { name: "Resumo",           icon: BarChart3,    path: "/comercial" },
    ],
  },
  {
    label: "Produção",
    icon: Factory,
    items: [
      { name: "PCP",              icon: Kanban,       path: "/pcp" },
      { name: "Qualidade",        icon: ShieldCheck,  path: "/quality" },
      { name: "Capacidade",       icon: BarChart3,    path: "/capacity-planning" },
      { name: "Painel",           icon: LayoutDashboard, path: "/producao" },
    ],
  },
  {
    label: "Engenharia",
    icon: Ruler,
    items: [
      { name: "Referências",      icon: BookOpen,     path: "/references" },
      { name: "Fichas Técnicas",  icon: Ruler,        path: "/fichas-tecnicas" },
      { name: "Imagens",          icon: Palette,      path: "/imagens-cores" },
      { name: "Solados",          icon: Footprints,   path: "/consumo-base" },
      { name: "Receitas",         icon: Sparkles,     path: "/artisanal-recipes" },
    ],
  },
  {
    label: "Estoque",
    icon: Package,
    items: [
      { name: "Posição",          icon: Package,      path: "/estoque" },
      { name: "Ajustes",          icon: ArrowUpDown,  path: "/ajuste-estoque" },
      { name: "Alertas",          icon: BellRing,     path: "/alertas-estoque" },
      { name: "Reservas",         icon: Bookmark,     path: "/reservas-estoque" },
      { name: "Histórico",        icon: History,      path: "/estoque/historico" },
    ],
  },
  {
    label: "Compras",
    icon: ShoppingBag,
    items: [
      { name: "Planejamento",     icon: Calendar,     path: "/purchase-planning" },
      { name: "Ordens de Compra", icon: ShoppingBag,  path: "/purchase-orders" },
      { name: "Fornecedores",     icon: Briefcase,    path: "/suppliers" },
      { name: "Custos de Insumos",icon: DollarSign,   path: "/custos-insumos" },
      { name: "Markup",           icon: Calculator,   path: "/pricing-calculator" },
    ],
  },
  {
    label: "Logística",
    icon: Truck,
    items: [
      { name: "Expedição",        icon: PackageOpen,  path: "/expedicao" },
      { name: "Conferência",      icon: ClipboardCheck, path: "/conferencia-saida" },
      { name: "Transporte",       icon: Truck,        path: "/transporte" },
      { name: "Etiquetas",        icon: Tag,          path: "/label-system" },
    ],
  },
  {
    label: "Financeiro",
    icon: Wallet,
    items: [
      { name: "Visão Geral",      icon: Wallet,       path: "/finance" },
      { name: "NF-e",             icon: Receipt,      path: "/nfe" },
      { name: "Painel",           icon: PieChart,     path: "/financeiro" },
    ],
  },
  {
    label: "Pessoas",
    icon: Users,
    items: [
      { name: "Equipe",           icon: Users,        path: "/employees" },
      { name: "Ponto",            icon: Clock,        path: "/timesheet" },
      { name: "Terceirizados",    icon: UserCheck,    path: "/contractors" },
      { name: "Painel RH",        icon: LayoutDashboard, path: "/rh" },
    ],
  },
];

export const systemItems = [
  { to: '/settings',           icon: Settings,  label: 'Configurações' },
  { to: '/automations',        icon: Zap,       label: 'Automações' },
  { to: '/reports',            icon: BarChart2, label: 'Relatórios' },
  { to: '/audit-logs',         icon: FileText,  label: 'Auditoria' },
  { to: '/system-monitor',     icon: Monitor,   label: 'Monitoramento' },
  { to: '/system-diagnostics', icon: Cpu,       label: 'Diagnóstico' },
  { to: '/unit-audit',         icon: Scale,     label: 'Auditoria Units' },
];

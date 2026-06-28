import { useLocation, Link } from 'react-router-dom';
import { CaretRight as ChevronRight, House as Home } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const routeLabels: Record<string, string> = {
  'dashboard': 'Painel',
  'pcp': 'PCP',
  'estoque': 'Estoque',
  'fichas-tecnicas': 'Fichas Técnicas',
  'comercial': 'Comercial',
  'sales': 'Pedidos de Venda',
  'pronta-entrega': 'Pronta Entrega',
  'clients': 'Clientes',
  'price-lists': 'Tabelas de Preço',
  'crm': 'CRM',
  'sac': 'SAC',
  'forecast': 'Forecast',
  'sales-report': 'Relatórios',
  'finance': 'Financeiro',
  'financeiro': 'Painel Financeiro',
  'purchase-orders': 'Ordens de Compra',
  'purchase-planning': 'Planejamento Compras',
  'pricing-calculator': 'Markup',
  'quotations': 'Cotações (RFQ)',
  'custos-insumos': 'Custos de Insumos',
  'suppliers': 'Fornecedores',
  'employees': 'Funcionários',
  'timesheet': 'Controle de Ponto',
  'contractors': 'Terceirizados',
  'rh': 'RH',
  'banco-de-horas': 'Banco de Horas',
  'transporte': 'Transporte',
  'transporters': 'Transportadoras',
  'embalagens': 'Embalagens',
  'labels': 'Etiquetas',
  'label-system': 'Etiquetas',
  'orders': 'Ordens de Produção',
  'setores': 'Setores',
  'settings': 'Configurações',
  'automations': 'Automações',
  'reports': 'Relatórios',
  'relatorios': 'Relatórios',
  'system-monitor': 'Monitoramento',
  'system-diagnostics': 'Diagnóstico',
  'audit-logs': 'Auditoria',
  'lgpd': 'LGPD',
  'security': 'Segurança',
  'design-system': 'Design System',
  'pcp-dashboard': 'Painel PCP',
  'producao': 'Produção',
  'fluxo': 'Fluxo',
  'live': 'Ao Vivo',
  'timeline': 'Timeline',
  'visao-agregada': 'Visão Agregada',
  'gargalos': 'Gargalos',
  'centro-controle': 'Centro de Controle',
  'imprimir-fichas': 'Imprimir Fichas',
  'quality': 'Qualidade',
  'production-dashboard': 'Painel Produção',
  'picking': 'Picking',
  'picking-sessions': 'Sessões Picking',
  'mrp': 'MRP',
  'ajuste-estoque': 'Ajuste de Estoque',
  'historico': 'Histórico',
  'order-flow-audit': 'Auditoria de Fluxo',
  'weekly-purchasing-plan': 'Plano Semanal',
  'optimized-production': 'Produção Otimizada',
  'capacity-planning': 'Capacidade',
  'expedicao': 'Expedição',
  'conferencia-saida': 'Conferência de Saída',
  'manifests': 'Romaneios',
  'entregas': 'Entregas',
  'delivery-tracking': 'Rastreamento',
  'cnab': 'CNAB / Boletos',
  'bank-reconciliation': 'Conciliação',
  'sped': 'SPED',
  'nfe': 'NF-e',
  'cte': 'CT-e',
  'mdfe': 'MDF-e',
  'solados': 'Solados',
  'silks': 'Silks',
  'artisanal-recipes': 'Receitas',
  'new': 'Novo',
  'edit': 'Editar',
  'summary': 'Resumo',
  'consumo': 'Consumo',
  'grouped-summary': 'Resumo Agrupado',
};

// Converte slug desconhecido em algo legível em pt-BR (capitalize + troca - por espaço)
function slugToLabel(seg: string): string {
  const decoded = decodeURIComponent(seg).replace(/-/g, ' ');
  return decoded.charAt(0).toUpperCase() + decoded.slice(1);
}

const parentGroups: Record<string, { label: string; to: string }> = {
  'pcp': { label: 'PCP', to: '/pcp' },
  'setores': { label: 'PCP', to: '/pcp' },
  'orders': { label: 'PCP', to: '/pcp' },
  'producao': { label: 'Produção', to: '/pcp' },
  'gargalos': { label: 'Produção', to: '/pcp' },
  'capacity-planning': { label: 'Produção', to: '/pcp' },
  'centro-controle': { label: 'Produção', to: '/pcp' },
  'quality': { label: 'Produção', to: '/pcp' },
  'estoque': { label: 'Estoque & Gestão', to: '/estoque' },
  'fichas-tecnicas': { label: 'Estoque & Gestão', to: '/estoque' },
  'ajuste-estoque': { label: 'Estoque & Gestão', to: '/estoque' },
  'mrp': { label: 'Estoque & Gestão', to: '/estoque' },
  'sales': { label: 'Comercial', to: '/comercial' },
  'pronta-entrega': { label: 'Comercial', to: '/comercial' },
  'clients': { label: 'Comercial', to: '/comercial' },
  'price-lists': { label: 'Comercial', to: '/comercial' },
  'crm': { label: 'Comercial', to: '/comercial' },
  'sac': { label: 'Comercial', to: '/comercial' },
  'forecast': { label: 'Comercial', to: '/comercial' },
  'sales-report': { label: 'Comercial', to: '/comercial' },
  'finance': { label: 'Financeiro', to: '/financeiro' },
  'pricing-calculator': { label: 'Financeiro', to: '/financeiro' },
  'cnab': { label: 'Financeiro', to: '/financeiro' },
  'bank-reconciliation': { label: 'Financeiro', to: '/financeiro' },
  'sped': { label: 'Financeiro', to: '/financeiro' },
  'nfe': { label: 'Financeiro', to: '/financeiro' },
  'cte': { label: 'Financeiro', to: '/financeiro' },
  'mdfe': { label: 'Financeiro', to: '/financeiro' },
  'purchase-orders': { label: 'Compras', to: '/purchase-orders' },
  'purchase-planning': { label: 'Compras', to: '/purchase-orders' },
  'quotations': { label: 'Compras', to: '/purchase-orders' },
  'suppliers': { label: 'Compras', to: '/purchase-orders' },
  'custos-insumos': { label: 'Compras', to: '/purchase-orders' },
  'employees': { label: 'RH', to: '/rh' },
  'timesheet': { label: 'RH', to: '/rh' },
  'contractors': { label: 'RH', to: '/rh' },
  'transporte': { label: 'Logística', to: '/expedicao' },
  'embalagens': { label: 'Logística', to: '/expedicao' },
  'labels': { label: 'Logística', to: '/expedicao' },
  'label-system': { label: 'Logística', to: '/expedicao' },
  'expedicao': { label: 'Logística', to: '/expedicao' },
  'conferencia-saida': { label: 'Logística', to: '/expedicao' },
  'picking': { label: 'Logística', to: '/expedicao' },
  'manifests': { label: 'Logística', to: '/expedicao' },
  'transporters': { label: 'Logística', to: '/expedicao' },
  'entregas': { label: 'Logística', to: '/expedicao' },
  'delivery-tracking': { label: 'Logística', to: '/expedicao' },
  'picking-sessions': { label: 'Logística', to: '/expedicao' },
  'settings': { label: 'Sistema', to: '/settings' },
  'automations': { label: 'Sistema', to: '/settings' },
  'audit-logs': { label: 'Sistema', to: '/settings' },
  'system-monitor': { label: 'Sistema', to: '/settings' },
  'system-diagnostics': { label: 'Sistema', to: '/settings' },
  'lgpd': { label: 'Sistema', to: '/settings' },
  'security': { label: 'Sistema', to: '/settings' },
  'relatorios': { label: 'Sistema', to: '/settings' },
};

export default function PageHeader({ title, subtitle, compact }: { title?: string; subtitle?: string; compact?: boolean }) {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'dashboard')) {
    return null;
  }

  const firstSegment = segments[0];
  const parent = parentGroups[firstSegment];

  const crumbs: { label: string; to?: string }[] = [];

  if (parent) {
    crumbs.push({ label: parent.label, to: parent.to });
  }

  let pathAccum = '';
  segments.forEach((seg, i) => {
    pathAccum += `/${seg}`;
    const label = routeLabels[seg] || slugToLabel(seg);
    const isLast = i === segments.length - 1;
    crumbs.push({ label, to: isLast ? undefined : pathAccum });
  });

  const breadcrumbContent = (
    <>
      <li>
        <Link to="/dashboard" className="flex items-center gap-1 hover:text-foreground transition-colors">
          <Home className="h-3.5 w-3.5" />
        </Link>
      </li>
      {crumbs.map((crumb, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <ChevronRight className="h-3 w-3 opacity-40" />
          {crumb.to ? (
            <Link to={crumb.to} className="hover:text-foreground transition-colors">
              {crumb.label}
            </Link>
          ) : (
            <span className={cn("font-medium", !crumb.to && "text-foreground")}>
              {title || crumb.label}
            </span>
          )}
        </li>
      ))}
    </>
  );

  if (compact) {
    return (
      <nav aria-label="breadcrumb">
        <ol className="flex items-center gap-1.5 ed-eyebrow text-muted-foreground">
          {breadcrumbContent}
        </ol>
      </nav>
    );
  }

  return (
    <nav aria-label="breadcrumb" className="mb-4 animate-in fade-in slide-in-from-left-2 duration-300">
      <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {breadcrumbContent}
      </ol>
    </nav>
  );
}

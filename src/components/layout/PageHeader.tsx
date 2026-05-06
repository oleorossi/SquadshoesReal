import { useLocation, Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
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
  'sales-report': 'Relatórios',
  'finance': 'Financeiro',
  'financeiro': 'Painel Financeiro',
  'purchase-orders': 'Ordens de Compra',
  'purchase-planning': 'Planejamento Compras',
  'pricing-calculator': 'Markup',
  'suppliers': 'Fornecedores',
  'employees': 'Funcionários',
  'timesheet': 'Controle de Ponto',
  'contractors': 'Terceirizados',
  'rh': 'RH',
  'transporte': 'Transporte',
  'embalagens': 'Embalagens',
  'labels': 'Etiquetas',
  'label-system': 'Etiquetas',
  'orders': 'Ordens de Produção',
  'setores': 'Setores',
  'settings': 'Configurações',
  'automations': 'Automações',
  'reports': 'Relatórios',
  'system-monitor': 'Monitoramento',
  'design-system': 'Design System',
  'pcp-dashboard': 'Painel PCP',
  'producao': 'Produção',
  'production-dashboard': 'Painel Produção',
  'picking': 'Picking Semanal',
  'mrp': 'MRP',
  'order-flow-audit': 'Auditoria de Fluxo',
  'weekly-purchasing-plan': 'Plano Semanal',
  'optimized-production': 'Produção Otimizada',
  'capacity-planning': 'Planejamento de Capacidade',
  'new': 'Novo',
  'edit': 'Editar',
  'summary': 'Resumo',
  'consumo': 'Consumo',
  'grouped-summary': 'Resumo Agrupado',
};

const parentGroups: Record<string, { label: string; to: string }> = {
  'pcp': { label: 'PCP', to: '/pcp' },
  'setores': { label: 'PCP', to: '/pcp' },
  'orders': { label: 'PCP', to: '/pcp' },
  'estoque': { label: 'Estoque & Gestão', to: '/estoque' },
  'fichas-tecnicas': { label: 'Estoque & Gestão', to: '/estoque' },
  'sales': { label: 'Comercial', to: '/comercial' },
  'pronta-entrega': { label: 'Comercial', to: '/comercial' },
  'clients': { label: 'Comercial', to: '/comercial' },
  'sales-report': { label: 'Comercial', to: '/comercial' },
  'finance': { label: 'Financeiro', to: '/financeiro' },
  'pricing-calculator': { label: 'Financeiro', to: '/financeiro' },
  'purchase-orders': { label: 'Compras', to: '/purchase-orders' },
  'purchase-planning': { label: 'Compras', to: '/purchase-orders' },
  'employees': { label: 'RH', to: '/rh' },
  'timesheet': { label: 'RH', to: '/rh' },
  'contractors': { label: 'RH', to: '/rh' },
  'transporte': { label: 'Logística', to: '/expedicao' },
  'embalagens': { label: 'Logística', to: '/expedicao' },
  'labels': { label: 'Logística', to: '/expedicao' },
  'label-system': { label: 'Logística', to: '/expedicao' },
  'expedicao': { label: 'Logística', to: '/expedicao' },
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
    const label = routeLabels[seg] || decodeURIComponent(seg);
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
        <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
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

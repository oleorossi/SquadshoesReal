import { useCallback, useRef } from 'react';

type RouteImporter = () => Promise<unknown>;

// L5 vai colocar o loader no metadado canônico de navigation.ts. Até lá, o path
// não permite deduzir o arquivo com segurança, então esta lista explícita cobre
// cada destino navegável e seu chunk real sem criar uma convenção implícita.
const routeImports: Record<string, RouteImporter> = {
  // Início e etiquetas
  '/dashboard': () => import('@/pages/Dashboard'),
  '/label-system': () => import('@/pages/LabelSystem'),

  // Comercial
  '/comercial': () => import('@/pages/ComercialDashboard'),
  '/sales': () => import('@/pages/SaleOrders'),
  '/pronta-entrega': () => import('@/pages/ProntaEntrega'),
  '/clients': () => import('@/pages/Clients'),
  '/crm': () => import('@/pages/CRM'),
  '/tarefas': () => import('@/pages/Tarefas'),
  '/price-lists': () => import('@/pages/PriceLists'),
  '/notas': () => import('@/pages/Notes'),
  '/sac': () => import('@/pages/SAC'),
  '/forecast': () => import('@/pages/Forecast'),

  // Produção
  '/producao/planejamento': () => import('@/pages/ProducaoPlanejamento'),
  '/producao/kanban': () => import('@/pages/ProducaoKanban'),
  '/producao/kanban/gestao': () => import('@/pages/ProducaoKanbanGestao'),
  '/producao/estouro': () => import('@/pages/ProducaoEstouro'),
  '/producao/setores': () => import('@/pages/ProducaoSetoresConfig'),
  '/producao/apontamento': () => import('@/pages/Setores'),
  '/producao/analises': () => import('@/pages/ProducaoAnalises'),
  '/producao/produtividade': () => import('@/pages/ProdutividadeModelos'),
  '/orders': () => import('@/pages/Orders'),
  '/imprimir-fichas': () => import('@/pages/PrintWorkSheets'),

  // Estoque e engenharia
  '/estoque': () => import('@/pages/Index'),
  '/grupos': () => import('@/pages/Groups'),
  '/ajuste-estoque': () => import('@/pages/StockAdjustmentPage'),
  '/estoque/qualidade': () => import('@/pages/EstoqueQualidade'),
  '/estoque/inventario': () => import('@/pages/InventarioABC'),
  '/reservas-estoque': () => import('@/pages/StockReservations'),
  '/fichas-tecnicas': () => import('@/pages/TechnicalSheets'),
  '/fichas-tecnicas/padroes': () => import('@/pages/ColorStandards'),
  '/escalonamento': () => import('@/pages/EscalonamentoCadPage'),
  '/calculadora-tiras': () => import('@/pages/StrapCalculator'),
  '/solados': () => import('@/pages/SolesHub'),
  '/silks': () => import('@/pages/Silks'),

  // Compras
  '/purchase-planning': () => import('@/pages/PurchasePlanning'),
  '/quotations': () => import('@/pages/Quotations'),
  '/purchase-orders': () => import('@/pages/PurchaseOrders'),
  '/purchase-orders/per-pv': () => import('@/pages/PurchaseOrdersPerPv'),
  '/compras/inspecao': () => import('@/pages/InspecaoRecebimento'),
  '/compras/alcadas': () => import('@/pages/AlcadasCompras'),
  '/suppliers': () => import('@/pages/Suppliers'),
  '/custos-insumos': () => import('@/pages/InputCostsPage'),

  // Logística
  '/expedicao': () => import('@/pages/ExpedicaoHub'),
  '/embalagens': () => import('@/pages/PackagingManagement'),
  '/transporte': () => import('@/pages/Transport'),
  '/picking': () => import('@/pages/PickingListPage'),
  '/picking-sessions': () => import('@/pages/Picking'),
  '/conferencia-saida': () => import('@/pages/OrderPickingPage'),
  '/manifests': () => import('@/pages/Manifests'),
  '/entregas': () => import('@/pages/OwnDeliveriesPage'),
  '/transporters': () => import('@/pages/Transporters'),
  '/delivery-tracking': () => import('@/pages/DeliveryTracking'),

  // Financeiro e fiscal
  '/financeiro': () => import('@/pages/Finance'),
  '/bank-reconciliation': () => import('@/pages/BankReconciliation'),
  '/cnab': () => import('@/pages/CNAB'),
  '/pricing-calculator': () => import('@/pages/PricingCalculator'),
  '/patrimonio': () => import('@/pages/Patrimonio'),
  '/nfe': () => import('@/pages/NfePage'),
  '/cte': () => import('@/pages/CTe'),
  '/mdfe': () => import('@/pages/MDFe'),
  '/sped': () => import('@/pages/SPED'),
  '/sped/bloco-k': () => import('@/pages/BlocoK'),
  '/apuracao-impostos': () => import('@/pages/ApuracaoImpostos'),
  '/perfis-tributarios': () => import('@/pages/PerfisTributarios'),

  // RH e sistema
  '/rh': () => import('@/pages/RHHub'),
  '/fichas-montadores': () => import('@/pages/FichaMontadoresPage'),
  '/terceirizados': () => import('@/pages/TerceirizadosHub'),
  '/settings': () => import('@/pages/Settings'),
  '/automations': () => import('@/pages/Automations'),
  '/relatorios': () => import('@/pages/RelatoriosHub'),
  '/security': () => import('@/pages/Security'),
  '/audit-logs': () => import('@/pages/AuditLogs'),
  '/lgpd': () => import('@/pages/LGPD'),
  '/system-monitor': () => import('@/pages/SystemMonitor'),
  '/system-diagnostics': () => import('@/pages/SystemDiagnostics'),
  '/unit-audit': () => import('@/pages/UnitAudit'),
};

const prefetched = new Set<string>();

export function usePrefetchRoute() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prefetch = useCallback((path: string) => {
    if (prefetched.has(path)) return;

    timerRef.current = setTimeout(() => {
      const importer = routeImports[path];
      if (importer) {
        prefetched.add(path);
        importer().catch(() => prefetched.delete(path));
      }
    }, 80);
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { prefetch, cancel };
}

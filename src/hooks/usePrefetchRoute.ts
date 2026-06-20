import { useCallback, useRef } from 'react';

// Map sidebar paths to their lazy import functions for prefetching.
// Mantém alinhado com src/data/navigation.ts — itens órfãos foram removidos.
const routeImports: Record<string, () => Promise<any>> = {
  '/dashboard': () => import('@/pages/Dashboard'),
  '/pcp': () => import('@/pages/PCPHub'),
  '/orders': () => import('@/pages/Orders'),
  '/quality': () => import('@/pages/Quality'),
  '/capacity-planning': () => import('@/pages/CapacityPlanning'),
  '/producao': () => import('@/pages/ProducaoDashboard'),
  '/producao/fluxo': () => import('@/pages/ProductionFlow'),
  '/relatorios/diario-producao': () => import('@/pages/RelDiarioA4'),
  '/relatorios/op': () => import('@/pages/RelOpA4'),
  '/relatorios/oee': () => import('@/pages/RelOeeA4'),
  '/relatorios': () => import('@/pages/RelatoriosHub'),
  '/cost-policies': () => import('@/pages/CostPolicies'),
  '/relatorios/qualidade': () => import('@/pages/RelQualidadeA4'),
  '/relatorios/refugo': () => import('@/pages/RelRefugoA4'),
  '/relatorios/semanal': () => import('@/pages/RelSemanalA4'),
  '/estoque': () => import('@/pages/Index'),
  '/ajuste-estoque': () => import('@/pages/StockAdjustmentPage'),
  '/alertas-estoque': () => import('@/pages/StockAlerts'),
  '/reservas-estoque': () => import('@/pages/StockReservations'),
  '/references': () => import('@/pages/References'),
  '/fichas-tecnicas': () => import('@/pages/TechnicalSheets'),
  '/consumo-base': () => import('@/pages/BaseConsumption'),
  '/artisanal-recipes': () => import('@/pages/ArtisanalRecipes'),
  // /imagens-cores removido — redireciona pra /fichas-tecnicas
  '/imagens-cores': () => import('@/pages/TechnicalSheets'),
  '/suppliers': () => import('@/pages/Suppliers'),
  '/comercial': () => import('@/pages/ComercialDashboard'),
  '/sales': () => import('@/pages/SaleOrders'),
  '/clients': () => import('@/pages/Clients'),
  '/expedicao': () => import('@/pages/ExpedicaoHub'),
  '/conferencia-saida': () => import('@/pages/OrderPickingPage'),
  '/label-system': () => import('@/pages/LabelSystem'),
  '/transporte': () => import('@/pages/Transport'),
  '/purchase-orders': () => import('@/pages/PurchaseOrders'),
  '/purchase-planning': () => import('@/pages/PurchasePlanning'),
  '/custos-insumos': () => import('@/pages/InputCostsPage'),
  '/finance': () => import('@/pages/Finance'),
  '/nfe': () => import('@/pages/NfePage'),
  '/financeiro': () => import('@/pages/Finance'),
  // Atalhos legados — Employees e Timesheet agora vivem como abas dentro do hub /rh.
  // Os paths abaixo fazem prefetch do hub para que os redirects /employees → /rh
  // e /timesheet → /rh sejam instantâneos.
  '/employees': () => import('@/pages/RHHub'),
  '/timesheet': () => import('@/pages/RHHub'),
  // /contractors foi unificado no hub /terceiros (redirect). Prefetch do hub
  // pra que o redirect seja instantâneo, igual ao padrão /employees → /rh.
  '/terceiros': () => import('@/pages/Terceiros'),
  '/contractors': () => import('@/pages/Terceiros'),
  '/pronta-entrega': () => import('@/pages/ProntaEntrega'),
  '/rh': () => import('@/pages/RHHub'),
  '/solados': () => import('@/pages/SolesHub'),
  '/settings': () => import('@/pages/Settings'),
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

import { useCallback, useRef } from 'react';

// Map sidebar paths to their lazy import functions for prefetching
const routeImports: Record<string, () => Promise<any>> = {
  '/dashboard': () => import('@/pages/Dashboard'),
  '/pcp': () => import('@/pages/PCPHub'),
  '/setores': () => import('@/pages/Setores'),
  '/orders': () => import('@/pages/Orders'),
  '/production': () => import('@/pages/Production'),
  '/estoque': () => import('@/pages/Index'),
  '/fichas-tecnicas': () => import('@/pages/TechnicalSheets'),
  '/suppliers': () => import('@/pages/Suppliers'),
  '/comercial': () => import('@/pages/ComercialDashboard'),
  '/sales': () => import('@/pages/SaleOrders'),
  '/clients': () => import('@/pages/Clients'),
  '/expedicao': () => import('@/pages/ExpedicaoHub'),
  '/label-system': () => import('@/pages/LabelSystem'),
  '/embalagens': () => import('@/pages/PackagingManagement'),
  '/transporte': () => import('@/pages/Transport'),
  '/purchase-orders': () => import('@/pages/PurchaseOrders'),
  '/purchase-planning': () => import('@/pages/PurchasePlanning'),
  '/finance': () => import('@/pages/Finance'),
  '/pricing-calculator': () => import('@/pages/PricingCalculator'),
  '/employees': () => import('@/pages/Employees'),
  '/timesheet': () => import('@/pages/Timesheet'),
  '/contractors': () => import('@/pages/Contractors'),
  '/pronta-entrega': () => import('@/pages/ProntaEntrega'),
  '/financeiro': () => import('@/pages/FinanceiroDashboard'),
  '/rh': () => import('@/pages/RHDashboard'),
  '/producao': () => import('@/pages/ProducaoDashboard'),
  '/sales-report': () => import('@/pages/SalesReport'),
  '/settings': () => import('@/pages/Settings'),
  '/design-system': () => import('@/pages/DesignSystem'),
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

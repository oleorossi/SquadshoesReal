import { ThemeProvider } from "@/components/theme-provider";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation, useParams, useRouteError } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentProfile } from "@/hooks/useUserManagement";
import { useAccessControl } from "@/hooks/useAccessControl";
import { CircleNotch as Loader2, ShieldWarning as ShieldAlert, ArrowsClockwise as RefreshCw, SignIn as LogIn } from '@phosphor-icons/react';
import { Button } from "@/components/ui/button";
 import { lazy, Suspense, useState, useEffect } from "react";
import ScrollRestorationComponent from "@/components/ScrollRestoration";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
 import AppLayout from "@/components/layout/AppLayout";
import { TabsProvider } from "@/contexts/TabsContext";
import { VersionChecker, manualVersionCheck } from "@/components/VersionChecker";
import PageSkeleton from "@/components/layout/PageSkeleton";

// Eager-loaded (auth flow)
import Auth from "./pages/Auth";

// Lazy-loaded pages
const Index = lazy(() => import("./pages/Index"));

// Mobile (PWA) pages — fluxo standalone /m/* pra vendedor em campo
const MobileLayout = lazy(() => import("./pages/mobile/MobileLayout"));
const MobileHome = lazy(() => import("./pages/mobile/MobileHome"));
const MobileNewOrder = lazy(() => import("./pages/mobile/MobileNewOrder"));
const MobilePending = lazy(() => import("./pages/mobile/MobilePending"));
const MobileProfile = lazy(() => import("./pages/mobile/MobileProfile"));
const DesignPreview = lazy(() => import("./pages/DesignPreview"));
// References removido em 2026-05 — página estava zerada e o menu apontava
// pra ela sem uso. /references agora redireciona pra /fichas-tecnicas.
// ColorImagesPage removido — duplicava a aba "Fotos & Histórico" da ficha técnica.
// Rota /imagens-cores agora redireciona pra /fichas-tecnicas.
const InputCostsPage = lazy(() => import("./pages/InputCostsPage"));
 const TechnicalSheets = lazy(() => import("./pages/TechnicalSheets"));
const Silks = lazy(() => import("./pages/Silks"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const Orders = lazy(() => import("./pages/Orders"));
const OrderEdit = lazy(() => import("./pages/OrderEdit"));
const SaleOrders = lazy(() => import("./pages/SaleOrders"));
const SaleOrderForm = lazy(() => import("./pages/SaleOrderForm"));
const SaleOrdersConsumption = lazy(() => import("./pages/SaleOrdersConsumption"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
 const StockHistoryPage = lazy(() => import("./pages/StockHistory"));
// SalesReport removido — funcionalidade unificada em /comercial (ComercialDashboard).
const Settings = lazy(() => import("./pages/Settings"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const Finance = lazy(() => import("./pages/Finance"));
const Clients = lazy(() => import("./pages/Clients"));
const EconomicGroupDetail = lazy(() => import("./pages/EconomicGroupDetail"));
const Contractors = lazy(() => import("./pages/Contractors"));
// Employees/Timesheet agora são abas dentro do hub /rh (RHHub).
// Rotas legadas (/employees, /timesheet) redirecionam para /rh?tab=...
const PurchaseOrders = lazy(() => import("./pages/PurchaseOrders"));
const ComercialDashboard = lazy(() => import("./pages/ComercialDashboard"));
const ProducaoDashboard = lazy(() => import("./pages/ProducaoDashboard"));
const ProductionLive = lazy(() => import("./pages/ProductionLive"));
const ProductionTimeline = lazy(() => import("./pages/ProductionTimeline"));
const BankHours = lazy(() => import("./pages/BankHours"));
const EspelhoPontoPage = lazy(() => import("./pages/EspelhoPontoPage"));
// ProductionDashboardPage removido — funcionalidade unificada em /producao (ProducaoDashboard).
// FinanceiroDashboard removido — /financeiro agora renderiza o Finance.tsx unificado (mai/2026).
const RHHub = lazy(() => import("./pages/RHHub"));
// Labels page removed — unified into LabelSystem
const Transport = lazy(() => import("./pages/Transport"));
const PackagingManagement = lazy(() => import("./pages/PackagingManagement"));
const ExpedicaoHub = lazy(() => import("./pages/ExpedicaoHub"));
const OrderPickingPage = lazy(() => import("./pages/OrderPickingPage"));
// Setores agora vive como aba dentro do PCP Hub (rota /setores redireciona)

const PCPDashboard = lazy(() => import("./pages/PCPDashboard"));
const PickingListPage = lazy(() => import("./pages/PickingListPage"));
const MrpPage = lazy(() => import("./pages/MrpPage"));
const StockAdjustmentPage = lazy(() => import("./pages/StockAdjustmentPage"));
const OrderFlowAudit = lazy(() => import("./pages/OrderFlowAudit"));
const NavigationAudit = lazy(() => import("./pages/NavigationAudit"));
const UnitAudit = lazy(() => import("./pages/UnitAudit"));
const NotFound = lazy(() => import("./pages/NotFound"));
const OrdersSummary = lazy(() => import("./pages/OrdersSummary"));
const GroupedReportSummary = lazy(() => import("./pages/GroupedReportSummary"));
const CapacityPlanning = lazy(() => import("./pages/CapacityPlanning"));
const CapacityDistribution = lazy(() => import("./pages/CapacityDistribution"));
const BottlenecksPage = lazy(() => import("./pages/Bottlenecks"));
const OutsourcedInFieldPage = lazy(() => import("./pages/OutsourcedInField"));
const ContractorReportsPage = lazy(() => import("./pages/ContractorReports"));
const TimePendingsPage = lazy(() => import("./pages/TimePendings"));
const WeeklyClosePage = lazy(() => import("./pages/WeeklyClose"));
const EmployeeAbsencesPage = lazy(() => import("./pages/EmployeeAbsences"));
const SectorAggregatedView = lazy(() => import("./pages/SectorAggregatedView"));
const ProductionControlCenter = lazy(() => import("./pages/ProductionControlCenter"));
const PrintWorkSheets = lazy(() => import("./pages/PrintWorkSheets"));
const LabelSystem = lazy(() => import("./pages/LabelSystem"));
const PurchasePlanning = lazy(() => import("./pages/PurchasePlanning"));
const PricingCalculator = lazy(() => import("./pages/PricingCalculator"));
const PCPHub = lazy(() => import("./pages/PCPHub"));
const ProntaEntrega = lazy(() => import("./pages/ProntaEntrega"));
const ProductionWavesPage = lazy(() => import("./pages/ProductionWavesPage"));
const ArtisanalRecipes = lazy(() => import("./pages/ArtisanalRecipes"));
const BaseConsumption = lazy(() => import("./pages/BaseConsumption"));
const StockAlerts = lazy(() => import("./pages/StockAlerts"));
const StockReservations = lazy(() => import("./pages/StockReservations"));
const NfePage = lazy(() => import("./pages/NfePage"));
const SolesHub = lazy(() => import("./pages/SolesHub"));


// Lazy loading de componentes pesados (requested snippet)
const ProductionModule = lazy(() => import('./modules/ProductionModule'));
const QualityModule = lazy(() => import('./modules/QualityModule'));
const ReportsModule = lazy(() => import('./modules/ReportsModule'));

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error: unknown, query) => {
      // Show a toast for every failed query that hasn't been handled locally.
      // Auth errors are silent (user will be redirected to login).
      const e = error as any;
      const isAuthError = e?.status === 401 || e?.status === 403 || e?.message?.includes('JWT');
      if (!isAuthError) {
        const label = (query.queryKey[0] as string) || 'dados';
        toast.error(`Falha ao carregar "${label}": ${e?.message || 'erro desconhecido'}`, { id: `qerr-${label}` });
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error: unknown) => {
      const e = error as any;
      const isAuthError = e?.status === 401 || e?.status === 403 || e?.message?.includes('JWT');
      if (!isAuthError && !e?._handled) {
        toast.error(e?.message || 'Operação falhou. Tente novamente.');
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        // Don't retry on auth errors or specific 4xx
        if (error?.status === 401 || error?.status === 403 || error?.message?.includes('JWT')) return false;
        return failureCount < 2;
      },
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 10000),
      staleTime: 30 * 1000,
      gcTime: 15 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

 const PageLoader = () => {
  const [showRetry, setShowRetry] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
 
   useEffect(() => {
     const timer = setTimeout(() => setShowRetry(true), 8000);
     return () => clearTimeout(timer);
   }, []);
 
   return (
     <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
       <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
       {showRetry && (
         <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
           <p className="text-muted-foreground text-sm mb-4 max-w-xs">
             O sistema está demorando mais do que o esperado para carregar.
           </p>
            <div className="flex flex-col gap-2">
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => window.location.reload()}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Recarregar Sistema
              </Button>
              <Button 
                size="sm" 
                variant="ghost"
                disabled={checkingVersion}
                onClick={async () => {
                  setCheckingVersion(true);
                  await manualVersionCheck();
                  setCheckingVersion(false);
                }}
                className="text-xs text-muted-foreground"
              >
                {checkingVersion ? "Verificando..." : "Forçar verificação de versão"}
              </Button>
            </div>
         </div>
       )}
     </div>
   );
 };

const InlinePageLoader = () => <PageSkeleton key="page-skeleton" />;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const { data: profile, isLoading: profileLoading } = useCurrentProfile();
  const [profileTimeout, setProfileTimeout] = useState(false);

  useEffect(() => {
    if (!loading && user && profileLoading && !profile) {
      if (import.meta.env.DEV) console.log("[ProtectedRoute] Profile still loading for authenticated user...");
    }
  }, [loading, user, profileLoading, profile]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (profileLoading && !profile && user) {
      timer = setTimeout(() => {
        console.warn("[ProtectedRoute] Profile loading timeout reached");
        setProfileTimeout(true);
      }, 5000);
    }
    return () => clearTimeout(timer);
  }, [profileLoading, profile, user]);

  if (loading) return <PageLoader />;

  if (!user) return <Navigate to="/auth" replace />;

  if (profileLoading && !profile && !profileTimeout) {
    return <PageLoader />;
  }

  if (profileTimeout && !profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-md">
          <ShieldAlert className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold">Sessão Expirada ou Erro de Perfil</h2>
          <p className="text-muted-foreground text-sm">
            Não conseguimos carregar suas informações. Por segurança, tente entrar novamente.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => window.location.href = '/auth'} className="gap-2">
              <LogIn className="h-4 w-4" />
              Ir para Login
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>Recarregar</Button>
            <Button variant="ghost" size="sm" onClick={signOut}>Sair</Button>
          </div>
        </div>
      </div>
    );
  }

  if (profile && !profile.approved) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-md">
          <ShieldAlert className="h-12 w-12 text-warning mx-auto" />
          <h2 className="text-xl font-bold">Aguardando Aprovação</h2>
          <p className="text-muted-foreground text-sm">
            Sua conta foi criada, mas ainda precisa ser aprovada por um administrador para acessar o sistema.
          </p>
          <Button variant="outline" onClick={signOut}>Sair</Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function RouteGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
   const { loading, isError, canAccessRoute } = useAccessControl();

   const path = location.pathname;
   const canAccess = path === '/' ? true : canAccessRoute(path);

  // Failsafe DEFENSIVO: se ficar carregando muito tempo (15s) mostramos o
  // skeleton com aviso suave em vez de "Sessão Instável", que assustava
  // usuários em qualquer flutuação de rede.
  const [showSlowHint, setShowSlowHint] = useState(false);
  useEffect(() => {
    if (!loading) { setShowSlowHint(false); return; }
    const t = setTimeout(() => setShowSlowHint(true), 8000);
    return () => clearTimeout(t);
  }, [loading]);

  // Audit visual #10 + #21: grace period antes de mostrar "Acesso Restrito".
  // Bug: navegação direta pra rota nova podia retornar canAccess=false
  // brevemente durante refetch dos roles, gerando flash da página de erro.
  // Aumentado pra 1500ms (era 500ms) — eliminava flash em redes rápidas mas
  // pegava em redes lentas/cancelar form. Negação real continua intacta
  // depois desse intervalo curto.
  const [showDeniedConfirmed, setShowDeniedConfirmed] = useState(false);
  useEffect(() => {
    if (canAccess) { setShowDeniedConfirmed(false); return; }
    const t = setTimeout(() => setShowDeniedConfirmed(true), 1500);
    return () => clearTimeout(t);
  }, [canAccess, path]);

  if (loading) {
    if (!showSlowHint) return <PageSkeleton />;
    return (
      <div className="min-h-[400px] flex items-center justify-center px-4">
        <div className="text-center space-y-3 max-w-md">
          <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-muted border-t-primary" />
          <p className="text-sm text-muted-foreground">
            Validando suas permissões… Isso está demorando mais que o normal.
          </p>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-[400px] flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-md">
          <ShieldAlert className="h-10 w-10 text-destructive mx-auto" />
          <h3 className="text-lg font-semibold">Sessão Instável</h3>
          <p className="text-sm text-muted-foreground">
            Não foi possível validar suas permissões de acesso. Tente fazer login novamente para restaurar o acesso.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => window.location.href = '/auth'} className="gap-2">
              <LogIn className="h-4 w-4" />
              Fazer Login
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Tentar Novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!canAccess && !showDeniedConfirmed) {
    return <PageSkeleton />;
  }

   if (!canAccess) {
     if (import.meta.env.DEV) console.log("[RouteGuard] Access denied for:", path);

    // Se o erro for na dashboard, mostramos uma mensagem específica e evitamos o loop de redirecionamento
    const isAtRoot = path === '/' || path === '/dashboard';

    return (
      <div className="min-h-[400px] flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-md">
          <ShieldAlert className="h-10 w-10 text-destructive mx-auto" />
          <h3 className="text-lg font-semibold">{isAtRoot ? "Sem acesso ao Painel" : "Acesso Restrito"}</h3>
          <p className="text-sm text-muted-foreground">
            {isAtRoot 
              ? "Sua conta está ativa, mas você não tem permissão para visualizar o Painel Principal. Peça a um administrador para habilitar o módulo 'Dashboard'."
              : "Você não tem permissão para acessar esta página. Contate um administrador."}
          </p>
          <div className="flex flex-col gap-2">
            {!isAtRoot && (
              <Button variant="outline" asChild>
                <a href="/dashboard">Voltar ao Painel</a>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => window.location.reload()} className="text-xs">
              Atualizar Permissões
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AuthRoute() {
  const { user, loading } = useAuth();
  const [salesRepLoaded, setSalesRepLoaded] = useState<boolean | null>(null);

  // F3 (24/05/2026): se profile.is_sales_rep=true, redireciona pra /m
  // (app mobile) em vez do dashboard desktop. Vendedor logando no celular
  // entra direto no fluxo de venda sem ver o ERP completo.
  useEffect(() => {
    if (!user) { setSalesRepLoaded(null); return; }
    (async () => {
      try {
        const mod = await import('@/integrations/supabase/client');
        const { data } = await mod.supabase
          .from('profiles')
          .select('is_sales_rep')
          .eq('id', user.id)
          .maybeSingle();
        setSalesRepLoaded(Boolean(data?.is_sales_rep));
      } catch {
        setSalesRepLoaded(false);
      }
    })();
  }, [user]);

  if (loading) {
    return <PageLoader />;
  }
  if (user) {
    if (salesRepLoaded === null) return <PageLoader />;
    return <Navigate to={salesRepLoaded ? '/m' : '/dashboard'} replace />;
  }
  return <Auth />;
}

/**
 * F3 (24/05/2026): root index (/). Lê profile.is_sales_rep e redireciona
 * pra /m (mobile) ou /dashboard (desktop). Diferente do AuthRoute que
 * só roda em /auth — este roda em / DEPOIS do login bem-sucedido.
 */
function RootRedirect() {
  const { user, loading } = useAuth();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const mod = await import('@/integrations/supabase/client');
        const { data } = await mod.supabase
          .from('profiles')
          .select('is_sales_rep')
          .eq('id', user.id)
          .maybeSingle();
        setTarget((data as any)?.is_sales_rep ? '/m' : '/dashboard');
      } catch {
        setTarget('/dashboard');
      }
    })();
  }, [user]);

  if (loading || !target) return <PageLoader />;
  return <Navigate to={target} replace />;
}

function LegacyInventoryRedirect() {
  const location = useLocation();
  return <Navigate to={`/estoque${location.search}`} replace />;
}

function LegacyRouteRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

function PedidosRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={id ? `/sales/edit/${id}` : '/sales'} replace />;
}

// Router configuration using createBrowserRouter
const RouteErrorFallback = () => {
  const error = useRouteError() as any;
  console.error('[RouteErrorFallback] error:', error);
  try { (window as any).__lastError = error; } catch {}
  const message = error?.message || error?.statusText || error?.toString?.() || 'Erro desconhecido';
  const stack = error?.stack || error?.componentStack;
  return (
    <div className="min-h-[300px] flex flex-col items-center justify-center p-8 gap-4">
      <ShieldAlert className="h-10 w-10 text-destructive" />
      <div className="text-center">
        <h3 className="text-lg font-semibold">Algo deu errado</h3>
        <p className="text-sm text-muted-foreground">Ocorreu um erro ao carregar esta página.</p>
      </div>
      <div className="w-full max-w-3xl bg-destructive/5 border border-destructive/30 rounded-lg p-4">
        <p className="text-sm font-semibold text-destructive mb-2">Erro:</p>
        <pre className="text-xs bg-background rounded p-3 overflow-auto max-h-80 whitespace-pre-wrap break-words">
{message}
{stack ? `\n${stack}` : ''}
        </pre>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => window.location.reload()}>Recarregar página</Button>
        <Button variant="outline" onClick={() => { window.location.href = '/'; }}>
          Ir para o início
        </Button>
        <Button variant="ghost" onClick={() => (window as any).forceAppUpdate?.()}>
          Limpar cache
        </Button>
      </div>
    </div>
  );
};

const router = createBrowserRouter([
  {
    path: "/auth",
    element: <AuthRoute />,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: "/login",
    element: <Navigate to="/auth" replace />,
  },
  {
    path: "/design-preview",
    element: (
      <Suspense fallback={<InlinePageLoader />}>
        <DesignPreview />
      </Suspense>
    ),
    errorElement: <RouteErrorFallback />,
  },
  // ── Mobile app (/m/*) — fluxo PWA standalone ──
  // Layout próprio (sem sidebar desktop), bottom tab nav, offline-first
  // via service worker + IndexedDB queue. Vendedor instala como app no
  // iPhone/iPad ("Add to Home Screen") e usa em campo.
  {
    path: "/m",
    element: (
      <ProtectedRoute>
        <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">Carregando...</div>}>
          <MobileLayout />
        </Suspense>
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorFallback />,
    children: [
      { index: true, element: <MobileHome /> },
      { path: "new", element: <MobileNewOrder /> },
      { path: "pending", element: <MobilePending /> },
      { path: "profile", element: <MobileProfile /> },
    ],
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <TabsProvider>
          <AppLayout>
            <ScrollRestorationComponent />
            <Suspense fallback={<InlinePageLoader />}>
              <RouteGuard>
                <Outlet />
              </RouteGuard>
            </Suspense>
          </AppLayout>
        </TabsProvider>
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorFallback />,
    children: [
       {
         index: true,
         // F3 (24/05/2026): vendedores (is_sales_rep=true) entram em /m
         // direto, sem passar pelo dashboard desktop.
         element: <RootRedirect />,
       },
      {
        path: "dashboard",
        element: <Dashboard />,
      },
      {
        path: "pcp",
        element: <PCPHub />,
      },
      {
        path: "pcp/ondas",
        element: <ProductionWavesPage />,
      },
      {
        path: "pronta-entrega",
        element: <ProntaEntrega />,
      },
      {
        path: "lead-time",
        element: <Navigate to="/pcp?tab=lead-time" replace />,
      },
       {
         path: "estoque",
         children: [
           { index: true, element: <Index /> },
           { path: ":id", element: <ProductDetail /> },
           { path: "historico", element: <StockHistoryPage /> },
         ],
       },
      {
        path: "ajuste-estoque",
        element: <StockAdjustmentPage />,
      },
      {
        // Legacy: /references → /fichas-tecnicas (página References foi removida)
        path: "references",
        element: <Navigate to="/fichas-tecnicas" replace />,
      },
      {
        // Legacy: /imagens-cores → /fichas-tecnicas (aba Fotos & Histórico)
        path: "imagens-cores",
        element: <Navigate to="/fichas-tecnicas" replace />,
      },
       {
         path: "fichas-tecnicas",
         element: <TechnicalSheets />,
       },
       {
         path: "silks",
         element: <Silks />,
       },
       {
         // Compat: rota antiga redireciona pra /silks
         path: "silk-registrations",
         element: <Navigate to="/silks" replace />,
       },
      {
        path: "consumo-base",
        element: <BaseConsumption />,
      },
      {
        path: "alertas-estoque",
        element: <StockAlerts />,
      },
      {
        path: "reservas-estoque",
        element: <StockReservations />,
      },
      {
        // Hub unificado de solados (Frente 3 — substitui telas dispersas)
        path: "solados",
        element: <SolesHub />,
      },
      {
        path: "technical-sheets",
        element: <LegacyRouteRedirect to="/fichas-tecnicas" />,
      },
      {
        path: "products",
        element: <LegacyRouteRedirect to="/estoque" />,
      },
      {
        path: "component-sheets",
        element: <LegacyRouteRedirect to="/estoque" />,
      },
      {
        path: "consumo-material",
        element: <LegacyRouteRedirect to="/estoque" />,
      },
      {
        path: "orders",
        children: [
          { index: true, element: <Orders /> },
          { path: ":id/edit", element: <OrderEdit /> },
          { path: "summary", element: <OrdersSummary /> },
          { path: "grouped-summary", element: <GroupedReportSummary /> },
        ],
      },
      {
        path: "pedidos/:id",
        element: <PedidosRedirect />,
      },
      {
        path: "setores",
        element: <Navigate to="/pcp?tab=setores" replace />,
      },
      {
        path: "shop-floor",
        element: <Navigate to="/pcp" replace />,
      },
      {
        // Rota legada: PCPDashboard agora vive como aba dentro de /pcp.
        // Componente PCPDashboard.tsx é mantido (usado pelo PCPHub como tab).
        path: "pcp-dashboard",
        element: <Navigate to="/pcp?tab=dashboard" replace />,
      },
      {
        path: "picking",
        element: <PickingListPage />,
      },
      {
        // Monitoramento de gargalos por setor (Costura, Aviamento, Corte).
        // Detecta sobrecarga e oferece criar OS terceirizada pra costureira
        // externa. Bloqueia OP de avançar pra Montagem até OS confirmar prazo.
        path: "gargalos",
        element: <BottlenecksPage />,
      },
      {
        // Tudo o que está fora da fábrica AGORA — OSs ativas de gargalo +
        // OPs inteiras terceirizadas (orders.outsourced_to_contractor_id).
        // Operacional: cards por contratada + tabela com prazo/atraso/ações.
        path: "terceiros-na-rua",
        element: <OutsourcedInFieldPage />,
      },
      {
        // Relatório agregado por contractor — taxa de pontualidade, R$ pago,
        // atraso médio + histórico de OSs finalizadas no período.
        path: "terceiros/relatorios",
        element: <ContractorReportsPage />,
      },
      {
        // Pendências de ponto — dias com batidas inconsistentes/irregulares
        // que precisam ser completadas pelo RH antes de fechar a semana.
        path: "rh/pendencias-ponto",
        element: <TimePendingsPage />,
      },
      {
        // Fechamento semanal — trava o cálculo do banco de horas por semana
        // pra impedir edição retroativa silenciosa. Cron auto toda segunda.
        path: "rh/fechamento-semanal",
        element: <WeeklyClosePage />,
      },
      {
        // Ausências justificadas (férias/atestado/licença/folga). Dias
        // cadastrados aqui ficam isentos do cálculo do banco de horas.
        path: "rh/ausencias",
        element: <EmployeeAbsencesPage />,
      },
      {
        // Visão consolidada de carga por setor. Em vez de N OPs individuais
        // de 12 pares, mostra o LOTE agregado por modelo (+cor onde faz
        // sentido) — costura/corte trabalham por bloco consolidado.
        path: "producao/visao-agregada",
        element: <SectorAggregatedView />,
      },
      {
        path: "mrp",
        element: <Navigate to="/purchase-planning?tab=mrp" replace />,
      },
      {
        path: "wip-control",
        element: <Navigate to="/pcp" replace />,
      },
      {
        path: "cycle-count",
        element: <Navigate to="/pcp" replace />,
      },
      {
        path: "order-flow-audit",
        element: <OrderFlowAudit />,
      },
      {
        path: "navigation-audit",
        element: <NavigationAudit />,
      },
      {
        path: "unit-audit",
        element: <UnitAudit />,
      },
      {
        path: "labels",
        element: <Navigate to="/label-system" replace />,
      },
      {
        path: "label-system",
        element: <LabelSystem />,
      },
      {
        path: "sales",
        children: [
          { index: true, element: <SaleOrders /> },
          { path: "new", element: <SaleOrderForm /> },
          { path: "edit/:id", element: <SaleOrderForm /> },
          { path: "consumo", element: <SaleOrdersConsumption /> },
        ],
      },
      {
        // Rota legada: relatório de vendas unificado em /comercial (ComercialDashboard).
        path: "sales-report",
        element: <Navigate to="/comercial" replace />,
      },
      {
        path: "suppliers",
        element: <Suppliers />,
      },
      {
        path: "clients",
        element: <Clients />,
      },
      {
        path: "grupos-economicos/:id",
        element: <EconomicGroupDetail />,
      },
      {
        path: "finance",
        element: <Navigate to="/financeiro" replace />,
      },
      {
        path: "custos-insumos",
        element: <InputCostsPage />,
      },
      {
        path: "nfe",
        element: <NfePage />,
      },
      {
        path: "contractors",
        element: <Contractors />,
      },
      {
        path: "artisanal-recipes",
        element: <ArtisanalRecipes />,
      },
      {
        // Rota legada: agora aba dentro do hub /rh (Funcionários)
        path: "employees",
        element: <Navigate to="/rh?tab=funcionarios" replace />,
      },
      {
        // Rota legada: agora aba dentro do hub /rh (Ponto)
        path: "timesheet",
        element: <Navigate to="/rh?tab=ponto" replace />,
      },
      {
        path: "time-control",
        element: <Navigate to="/rh?tab=ponto" replace />,
      },
      {
        path: "purchase-orders",
        element: <PurchaseOrders />,
      },
      {
        path: "purchase-planning",
        element: <PurchasePlanning />,
      },
      {
        path: "pricing-calculator",
        element: <PricingCalculator />,
      },
      {
        path: "weekly-purchasing-plan",
        element: <Navigate to="/purchase-planning?tab=weekly" replace />,
      },
      {
        path: "comercial",
        element: <ComercialDashboard />,
      },
      {
        path: "producao",
        element: <ProducaoDashboard />,
      },
      {
        path: "producao/live",
        element: <ProductionLive />,
      },
      {
        path: "producao/timeline",
        element: <ProductionTimeline />,
      },
      {
        // Rota legada: dashboard unificado em /producao (ProducaoDashboard).
        path: "production-dashboard",
        element: <Navigate to="/producao" replace />,
      },
      {
        path: "financeiro",
        element: <Finance />,
      },
      {
        path: "rh",
        element: <RHHub />,
      },
      {
        // Banco de Horas — visão completa (KPIs + funcionário + setor + drill-down)
        path: "rh/banco-de-horas",
        element: <BankHours />,
      },
      {
        // Espelho de Ponto Eletrônico — Portaria MTE 671/2021 art. 84
        path: "rh/espelho-ponto/:employeeId",
        element: <EspelhoPontoPage />,
      },
      {
        // Alias legado
        path: "rh/bank-hours",
        element: <Navigate to="/rh/banco-de-horas" replace />,
      },
      {
        // Atalho direto: Folha de Pagamento (tab dentro de /rh)
        path: "rh/payroll",
        element: <Navigate to="/rh?tab=folha" replace />,
      },
      {
        path: "transporte",
        element: <Transport />,
      },
      {
        path: "embalagens",
        element: <PackagingManagement />,
      },
      {
        path: "expedicao",
        element: <ExpedicaoHub />,
      },
      {
        path: "conferencia-saida",
        element: <OrderPickingPage />,
      },
      {
        path: "settings",
        element: <Settings />,
      },
      {
        path: "capacity-planning",
        element: <CapacityPlanning />,
      },
      {
        path: "capacity-planning/distribuir",
        element: <CapacityDistribution />,
      },
      {
        path: "centro-controle",
        element: <ProductionControlCenter />,
      },
      {
        path: "imprimir-fichas",
        element: <PrintWorkSheets />,
      },
      // Requested snippet routes with lazy property
      {
        path: "inventory",
        element: <LegacyInventoryRedirect />,
      },
      {
        // Rota legada: Production unificado em /producao (ProducaoDashboard).
        path: "production",
        element: <Navigate to="/producao" replace />,
      },
      {
        path: "quality",
        lazy: () => import("./pages/Quality").then(m => ({ Component: m.default })),
      },
      {
        path: "reports",
        lazy: () => import("./pages/Reports").then(m => ({ Component: m.default })),
      },
      {
        // Hub de Relatórios A4 (Novidade) — index com 6 cards
        path: "relatorios",
        lazy: () => import("./pages/RelatoriosHub").then(m => ({ Component: m.default })),
      },
      {
        // Editor de cost_policies (defaults fiscais + overhead + embalagem)
        path: "cost-policies",
        lazy: () => import("./pages/CostPolicies").then(m => ({ Component: m.default })),
      },
      {
        // Cronoanálise — estudo de tempos que alimenta bom_operations.standard_time_minutes
        path: "cronoanalise",
        lazy: () => import("./pages/Cronoanalise").then(m => ({ Component: m.default })),
      },
      {
        // Patrimônio / Imobilizado — cadastro de bens, depreciação linear e baixa
        path: "patrimonio",
        lazy: () => import("./pages/Patrimonio").then(m => ({ Component: m.default })),
      },
      {
        // SPED Bloco K — livro de produção e estoque (K100/K200/K230/K235)
        path: "sped/bloco-k",
        lazy: () => import("./pages/BlocoK").then(m => ({ Component: m.default })),
      },
      {
        // Perfis tributários por NCM (CST/CFOP/alíquotas/ST)
        path: "perfis-tributarios",
        lazy: () => import("./pages/PerfisTributarios").then(m => ({ Component: m.default })),
      },
      {
        // Apuração mensal de impostos (estimativa via perfis tributários)
        path: "apuracao-impostos",
        lazy: () => import("./pages/ApuracaoImpostos").then(m => ({ Component: m.default })),
      },
      {
        // Novidade A4 — relatório diário de produção (template do redesign)
        path: "relatorios/diario-producao",
        lazy: () => import("./pages/RelDiarioA4").then(m => ({ Component: m.default })),
      },
      {
        path: "relatorios/op",
        lazy: () => import("./pages/RelOpA4").then(m => ({ Component: m.default })),
      },
      {
        path: "relatorios/oee",
        lazy: () => import("./pages/RelOeeA4").then(m => ({ Component: m.default })),
      },
      {
        path: "relatorios/qualidade",
        lazy: () => import("./pages/RelQualidadeA4").then(m => ({ Component: m.default })),
      },
      {
        path: "relatorios/refugo",
        lazy: () => import("./pages/RelRefugoA4").then(m => ({ Component: m.default })),
      },
      {
        path: "relatorios/semanal",
        lazy: () => import("./pages/RelSemanalA4").then(m => ({ Component: m.default })),
      },
      {
        // Novidade — quadro tipo kanban CORTE→COSTURA→MONTAGEM→ACABAMENTO→EMBALAGEM
        path: "producao/fluxo",
        lazy: () => import("./pages/ProductionFlow").then(m => ({ Component: m.default })),
      },
      {
        path: "automations",
        lazy: () => import("./pages/Automations").then(m => ({ Component: m.default })),
      },
       {
         path: "system-monitor",
         lazy: () => import("./pages/SystemMonitor").then(m => ({ Component: m.default })),
       },
       {
         path: "system-diagnostics",
         lazy: () => import("./pages/SystemDiagnostics").then(m => ({ Component: m.default })),
       },
       {
         path: "audit-logs",
         lazy: () => import("./pages/AuditLogs").then(m => ({ Component: m.default })),
       },
       // ─── Expansão ERP (gap analysis 2026-05-10) ───
       { path: "price-lists",         lazy: () => import("./pages/PriceLists").then(m => ({ Component: m.default })) },
       { path: "crm",                 lazy: () => import("./pages/CRM").then(m => ({ Component: m.default })) },
       { path: "notas",               lazy: () => import("./pages/Notes").then(m => ({ Component: m.default })) },
       { path: "sac",                 lazy: () => import("./pages/SAC").then(m => ({ Component: m.default })) },
       { path: "forecast",            lazy: () => import("./pages/Forecast").then(m => ({ Component: m.default })) },
       { path: "quotations",          lazy: () => import("./pages/Quotations").then(m => ({ Component: m.default })) },
       { path: "cte",                 lazy: () => import("./pages/CTe").then(m => ({ Component: m.default })) },
       { path: "mdfe",                lazy: () => import("./pages/MDFe").then(m => ({ Component: m.default })) },
       { path: "cnab",                lazy: () => import("./pages/CNAB").then(m => ({ Component: m.default })) },
       { path: "bank-reconciliation", lazy: () => import("./pages/BankReconciliation").then(m => ({ Component: m.default })) },
       { path: "sped",                lazy: () => import("./pages/SPED").then(m => ({ Component: m.default })) },
       { path: "picking-sessions",    lazy: () => import("./pages/Picking").then(m => ({ Component: m.default })) },
       { path: "manifests",           lazy: () => import("./pages/Manifests").then(m => ({ Component: m.default })) },
       { path: "transporters",        lazy: () => import("./pages/Transporters").then(m => ({ Component: m.default })) },
       { path: "delivery-tracking",   lazy: () => import("./pages/DeliveryTracking").then(m => ({ Component: m.default })) },
       { path: "entregas",            lazy: () => import("./pages/OwnDeliveriesPage").then(m => ({ Component: m.default })) },
       { path: "lgpd",                lazy: () => import("./pages/LGPD").then(m => ({ Component: m.default })) },
       { path: "security",            lazy: () => import("./pages/Security").then(m => ({ Component: m.default })) },
      // Heavy modules (can be used elsewhere if needed)
      {
        path: "modules",
        children: [
          { path: "production", element: <ProductionModule /> },
          { path: "quality", element: <QualityModule /> },
          { path: "reports", element: <ReportsModule /> },
        ]
      },
      // ── Aliases / rotas legadas ───────────────────────────────────────────
      // Redirecionam rotas em inglês ou paths antigos que ainda aparecem em
      // tabs persistidas no localStorage, evitando 404 quando o usuário
      // recarrega com uma aba antiga.
      { path: "stock",             element: <Navigate to="/estoque" replace /> },
      { path: "inventory",         element: <Navigate to="/estoque" replace /> },
      { path: "auditoria",         element: <Navigate to="/audit-logs" replace /> },
      { path: "diagnostico",       element: <Navigate to="/system-diagnostics" replace /> },
      { path: "monitoramento",     element: <Navigate to="/system-monitor" replace /> },
      { path: "technical-sheets",  element: <Navigate to="/fichas-tecnicas" replace /> },
      // Auditoria visual 23/05/2026: URLs em pt-br intuitivas caíam no
      // catch-all "*" gerando log "404 Debug" no console. Adicionado
      // redirects explícitos pras URLs internas reais. Reduz ruído nos
      // logs + UX previsível (usuário digita /pedidos-venda e funciona).
      { path: "pedidos-venda",      element: <Navigate to="/sales" replace /> },
      { path: "ordens-de-producao", element: <Navigate to="/orders" replace /> },
      { path: "ordens",             element: <Navigate to="/orders" replace /> },
      { path: "corte",              element: <Navigate to="/pcp?tab=setores&sub=corte" replace /> },
      { path: "costura",            element: <Navigate to="/pcp?tab=setores&sub=costura" replace /> },
      { path: "aviamento",          element: <Navigate to="/pcp?tab=setores&sub=aviamento" replace /> },
      { path: "montagem",           element: <Navigate to="/pcp?tab=setores&sub=montagem" replace /> },
      { path: "solagem",            element: <Navigate to="/pcp?tab=setores&sub=solagem" replace /> },
      { path: "acabamento",         element: <Navigate to="/pcp?tab=setores&sub=acabamento" replace /> },
      { path: "compras",            element: <Navigate to="/purchase-orders" replace /> },
      { path: "fornecedores",       element: <Navigate to="/suppliers" replace /> },
      { path: "clientes",           element: <Navigate to="/clients" replace /> },
      { path: "ponto",              element: <Navigate to="/timesheet" replace /> },
      // NOTA: /financeiro, /rh, /expedicao, /relatorios, /pronta-entrega
      // já são rotas reais (Finance/RHHub/ExpedicaoHub/etc) acima — não
      // precisam de redirect. /configuracoes não existe e é ambíguo
      // (system-monitor? user-management?) — fica no NotFound até decidir.
      {
        path: "*",
        element: <NotFound />,
      },
    ],
  },
], {
  future: {
    v7_startTransition: true,
    v7_relativeSplatPath: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_skipActionErrorRevalidation: true,
  },
});

const App = () => (
  <GlobalErrorBoundary>
    <ThemeProvider defaultTheme="light" storageKey="squad-shoes-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <VersionChecker />
          <Sonner position="top-right" closeButton richColors />
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </GlobalErrorBoundary>
);

export default App;

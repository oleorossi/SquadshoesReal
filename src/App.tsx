import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentProfile } from "@/hooks/useUserManagement";
import { useAccessControl } from "@/hooks/useAccessControl";
import { Loader2, ShieldAlert, RefreshCw, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
 import { lazy, Suspense, useState, useEffect } from "react";
import ScrollRestorationComponent from "@/components/ScrollRestoration";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
 import AppLayout from "@/components/layout/AppLayout";
import { VersionChecker, manualVersionCheck } from "@/components/VersionChecker";
import PageSkeleton from "@/components/layout/PageSkeleton";

// Eager-loaded (auth flow)
import Auth from "./pages/Auth";

// Lazy-loaded pages
const Index = lazy(() => import("./pages/Index"));
const References = lazy(() => import("./pages/References"));
// ColorImagesPage removido — duplicava a aba "Fotos & Histórico" da ficha técnica.
// Rota /imagens-cores agora redireciona pra /fichas-tecnicas.
const InputCostsPage = lazy(() => import("./pages/InputCostsPage"));
 const TechnicalSheets = lazy(() => import("./pages/TechnicalSheets"));
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
const Contractors = lazy(() => import("./pages/Contractors"));
// Employees/Timesheet agora são abas dentro do hub /rh (RHHub).
// Rotas legadas (/employees, /timesheet) redirecionam para /rh?tab=...
const PurchaseOrders = lazy(() => import("./pages/PurchaseOrders"));
const ComercialDashboard = lazy(() => import("./pages/ComercialDashboard"));
const ProducaoDashboard = lazy(() => import("./pages/ProducaoDashboard"));
// ProductionDashboardPage removido — funcionalidade unificada em /producao (ProducaoDashboard).
const FinanceiroDashboard = lazy(() => import("./pages/FinanceiroDashboard"));
const RHHub = lazy(() => import("./pages/RHHub"));
// Labels page removed — unified into LabelSystem
const Transport = lazy(() => import("./pages/Transport"));
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
      console.log("[ProtectedRoute] Profile still loading for authenticated user...");
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

  // Failsafe DEFENSIVO: se ficar carregando muito tempo (15s) mostramos o
  // skeleton com aviso suave em vez de "Sessão Instável", que assustava
  // usuários em qualquer flutuação de rede.
  const [showSlowHint, setShowSlowHint] = useState(false);
  useEffect(() => {
    if (!loading) { setShowSlowHint(false); return; }
    const t = setTimeout(() => setShowSlowHint(true), 8000);
    return () => clearTimeout(t);
  }, [loading]);

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

   const path = location.pathname;
  // Always allow home path to resolve to Navigate which then goes to /dashboard
  // This prevents infinite loops or stuck states on the root path
  const canAccess = path === '/' ? true : canAccessRoute(path);
 
   if (!canAccess) {
     console.log("[RouteGuard] Access denied for:", path);
 
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
  if (loading) {
    return <PageLoader />;
  }
  if (user) return <Navigate to="/dashboard" replace />;
  return <Auth />;
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
  return (
    <div className="min-h-[300px] flex items-center justify-center p-8">
      <div className="text-center space-y-4 max-w-md">
        <ShieldAlert className="h-10 w-10 text-destructive mx-auto" />
        <h3 className="text-lg font-semibold">Algo deu errado</h3>
        <p className="text-sm text-muted-foreground">
          Ocorreu um erro ao carregar esta página.
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Recarregar página
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
    path: "/",
    element: (
      <ProtectedRoute>
        <AppLayout>
          <ScrollRestorationComponent />
          <Suspense fallback={<InlinePageLoader />}>
            <RouteGuard>
              <Outlet />
            </RouteGuard>
          </Suspense>
        </AppLayout>
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorFallback />,
    children: [
       {
         index: true,
         element: <Navigate to="/dashboard" replace />,
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
        path: "references",
        element: <References />,
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
         path: "silk-registrations",
         element: <Navigate to="/consumo-base" replace />,
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
        path: "finance",
        element: <Finance />,
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
        // Rota legada: dashboard unificado em /producao (ProducaoDashboard).
        path: "production-dashboard",
        element: <Navigate to="/producao" replace />,
      },
      {
        path: "financeiro",
        element: <FinanceiroDashboard />,
      },
      {
        path: "rh",
        element: <RHHub />,
      },
      {
        // Atalho direto: Banco de Horas (sub-aba dentro de Folha)
        path: "rh/bank-hours",
        element: <Navigate to="/rh?tab=folha" replace />,
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
        element: <Navigate to="/transporte?tab=packaging" replace />,
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
      // Heavy modules (can be used elsewhere if needed)
      {
        path: "modules",
        children: [
          { path: "production", element: <ProductionModule /> },
          { path: "quality", element: <QualityModule /> },
          { path: "reports", element: <ReportsModule /> },
        ]
      },
      {
        path: "*",
        element: <NotFound />,
      },
    ],
  },
]);

const App = () => (
  <GlobalErrorBoundary>
    <ThemeProvider defaultTheme="light" storageKey="squad-shoes-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <VersionChecker />
          <Toaster />
          <Sonner position="top-right" closeButton richColors />
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </GlobalErrorBoundary>
);

export default App;

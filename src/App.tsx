import { ThemeProvider } from "@/components/theme-provider";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation, useParams, useRouteError, type RouteObject } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentProfile, useUserRoleNames } from "@/hooks/useUserManagement";
import { resolveRoleHome } from "@/data/navigation";
import { resolveModuleForPath, useAccessControl } from "@/hooks/useAccessControl";
import { CircleNotch as Loader2, ShieldWarning as ShieldAlert, ArrowsClockwise as RefreshCw, SignIn as LogIn } from '@phosphor-icons/react';
import { Button } from "@/components/ui/button";
 import { lazy, Suspense, useState, useEffect } from "react";
import ScrollRestorationComponent from "@/components/ScrollRestoration";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { VersionChecker, manualVersionCheck } from "@/components/VersionChecker";
import PageSkeleton, { DashboardSkeleton } from "@/components/layout/PageSkeleton";

// Eager-loaded (auth flow)
import Auth from "./pages/Auth";

// ⚠ PERF (2026-07-26): AppLayout é lazy DE PROPÓSITO. Como import estático ele
// arrastava a casca inteira do ERP desktop (sidebar, GlobalSearch, NotificationBell
// e os ~49 ícones de src/data/navigation.ts) pro chunk de ENTRADA — ou seja,
// /auth e o PWA mobile /m, que nunca renderizam o layout desktop, baixavam tudo isso
// antes de pintar. Quem está logado não paga nada: o chunk vem em paralelo com as
// queries da rota, sob o <Suspense fallback={<PageSkeleton />}> da rota "/".
const AppLayout = lazy(() => import("@/components/layout/AppLayout"));

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
// Padrões do Calçado — regras GLOBAIS de componente/tira por cor
// (component_color_defaults): grupo + cor do pedido → SKU padrão.
const ColorStandards = lazy(() => import("./pages/ColorStandards"));
const EscalonamentoCadPage = lazy(() => import("./pages/EscalonamentoCadPage"));
const StrapCalculator = lazy(() => import("./pages/StrapCalculator"));
const Silks = lazy(() => import("./pages/Silks"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const Orders = lazy(() => import("./pages/Orders"));
const OrderEdit = lazy(() => import("./pages/OrderEdit"));
const SaleOrders = lazy(() => import("./pages/SaleOrders"));
// Catálogo — foto crua → foto de estúdio por IA em cada cor da cartela →
// lâmina do catálogo montada no navegador (Edge Function generate-catalog-photo).
const Catalogo = lazy(() => import("./pages/Catalogo"));
const SaleOrderForm = lazy(() => import("./pages/SaleOrderForm"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Groups = lazy(() => import("./pages/Groups"));
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
const PurchaseOrdersPerPv = lazy(() => import("./pages/PurchaseOrdersPerPv"));
const ComercialDashboard = lazy(() => import("./pages/ComercialDashboard"));
// ProductionLive/ProductionTimeline não têm rota própria: views legadas chegam
// em /producao/analises, que mantém esses componentes sob o motor canônico.
const EspelhoPontoPage = lazy(() => import("./pages/EspelhoPontoPage"));
// FinanceiroDashboard removido — /financeiro agora renderiza o Finance.tsx unificado (mai/2026).
const RHHub = lazy(() => import("./pages/RHHub"));
// Labels page removed — unified into LabelSystem
const Transport = lazy(() => import("./pages/Transport"));
const PackagingManagement = lazy(() => import("./pages/PackagingManagement"));
const ExpedicaoHub = lazy(() => import("./pages/ExpedicaoHub"));
const OrderPickingPage = lazy(() => import("./pages/OrderPickingPage"));
// /setores permanece somente como alias para o Apontamento canônico.

const PickingListPage = lazy(() => import("./pages/PickingListPage"));
const StockAdjustmentPage = lazy(() => import("./pages/StockAdjustmentPage"));
// OrderFlowAudit é uma view de /producao/analises; a URL standalone sobrevive
// só como alias para não quebrar bookmarks antigos.
const NavigationAudit = lazy(() => import("./pages/NavigationAudit"));
const UnitAudit = lazy(() => import("./pages/UnitAudit"));
const NotFound = lazy(() => import("./pages/NotFound"));
const OrdersSummary = lazy(() => import("./pages/OrdersSummary"));
const GroupedReportSummary = lazy(() => import("./pages/GroupedReportSummary"));
// CapacityPlanning: rota standalone /capacity-planning aposentada em favor dos
// tempos-padrão. A filha /capacity-planning/distribuir segue aposentada (R9.3,
// redireciona pro Planejamento novo) — não ressuscitar o 3º motor de PCP.
const TerceirizadosHub = lazy(() => import("./pages/TerceirizadosHub"));
const TimePendingsPage = lazy(() => import("./pages/TimePendings"));
// SectorAggregatedView é a visão legada "lote" de /producao/analises.
const PrintWorkSheets = lazy(() => import("./pages/PrintWorkSheets"));
const LabelSystem = lazy(() => import("./pages/LabelSystem"));
const PurchasePlanning = lazy(() => import("./pages/PurchasePlanning"));
const PricingCalculator = lazy(() => import("./pages/PricingCalculator"));
const PCPHub = lazy(() => import("./pages/PCPHub"));
// Remodelagem Produção 2026-07-12 (specs/remodelagem-producao.md): 7 itens
// diretos no lugar do hub de 14 abas. PCPHub virou só o redirect legado.
const ProducaoPlanejamento = lazy(() => import("./pages/ProducaoPlanejamento"));
const ProducaoKanban = lazy(() => import("./pages/ProducaoKanban"));
const ProducaoKanbanGestao = lazy(() => import("./pages/ProducaoKanbanGestao"));
const ProducaoEstouro = lazy(() => import("./pages/ProducaoEstouro"));
const ProducaoSetoresConfig = lazy(() => import("./pages/ProducaoSetoresConfig"));
const ProducaoApontamento = lazy(() => import("./pages/Setores"));
const ProducaoAnalises = lazy(() => import("./pages/ProducaoAnalises"));
const ProdutividadeModelos = lazy(() => import("./pages/ProdutividadeModelos"));
const ProntaEntrega = lazy(() => import("./pages/ProntaEntrega"));
// /pcp/ondas é compatibilidade para a rota de Planejamento; ondas foram
// substituídas pelo motor diário canônico.
const StockReservations = lazy(() => import("./pages/StockReservations"));
const NfePage = lazy(() => import("./pages/NfePage"));
const SolesHub = lazy(() => import("./pages/SolesHub"));


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
      staleTime: 60 * 1000,
      gcTime: 15 * 60 * 1000,
      // refetchOnWindowFocus DESLIGADO (perf): num ERP com 500+ useQuery, voltar
      // pra aba re-disparava dezenas de fetches simultâneos — causa nº1 da
      // lentidão geral / ao navegar. Seguro porque cada mutação já invalida as
      // queries afetadas, e refetchOnMount/Reconnect garantem dado fresco ao
      // navegar entre telas e ao reconectar. staleTime subiu 30s→60s pra cortar
      // refetch redundante das ~228 queries que não definem staleTime próprio.
      refetchOnWindowFocus: false,
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
   const { loading, isError, canAccessRoute, permsLoading, permsError, isAdmin } = useAccessControl();

   const path = location.pathname;
   // URL que não resolve módulo nenhum é URL que não existe: cai no catch-all e
   // tem que renderizar o NotFound. Sem isso, errar o endereço devolveria
   // "Acesso Restrito" — mensagem de permissão pra um problema de digitação.
   // Toda rota REAL tem módulo: `check-navigation-access.mjs` falha o build se
   // alguém adicionar uma sem classificar (inclusive os aliases legados).
   const isKnownRoute = path === '/' || resolveModuleForPath(path) !== null;
   const canAccess = !isKnownRoute || canAccessRoute(path);

   // Fecha o fail-open da auditoria (P12): pra NÃO-admin, a rota só pode ser
   // avaliada depois que os grants granulares chegam — antes disso `canAccessRoute`
   // cai no RBAC legado e libera telas que a allow-list negaria. Admin não depende
   // de grants (canAccessRoute já retorna true), então não é atrasado.
   const guardLoading = loading || (!isAdmin && permsLoading);
   const guardError = isError || (!isAdmin && permsError);

  // Failsafe DEFENSIVO: se ficar carregando muito tempo (15s) mostramos o
  // skeleton com aviso suave em vez de "Sessão Instável", que assustava
  // usuários em qualquer flutuação de rede.
  const [showSlowHint, setShowSlowHint] = useState(false);
  useEffect(() => {
    if (!guardLoading) { setShowSlowHint(false); return; }
    const t = setTimeout(() => setShowSlowHint(true), 8000);
    return () => clearTimeout(t);
  }, [guardLoading]);

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

  // Endereço inexistente não é uma negação de permissão: deixa o catch-all
  // renderizar NotFound em vez de converter um erro de digitação em acesso restrito.
  if (!isKnownRoute) return <>{children}</>;

  if (guardLoading) {
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

  if (guardError) {
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
  const location = useLocation();
  // ⚠ PERF (2026-07-26): antes isto era um fetch de `profiles` num useEffect, FORA do
  // React Query, que segurava a tela num <PageLoader /> — um round-trip bloqueante no
  // caminho de boot, duplicando o profile que o layout já busca logo em seguida.
  // useCurrentProfile tem a mesma origem, staleTime de 5min e é COMPARTILHADO: vira
  // 1 requisição em vez de 2 e, em navegações seguintes, o redirect é instantâneo
  // porque o cache já está quente.
  const { data: profile, isPending, isError } = useCurrentProfile();
  const { data: roleNames = [] } = useUserRoleNames(user?.id);

  if (loading) return <PageLoader />;
  if (user && isPending && !isError) return <PageLoader />;
  // `is_sales_rep` não está na interface Profile (types gerados) — mesmo cast que o
  // código anterior fazia. Erro ao ler o profile cai no desktop, igual ao catch antigo.
  // Round-7 (30/07/2026): a tela inicial passou a ser do PERFIL. Antes todo
  // mundo caía em /dashboard — faz sentido pro gerente, não pra quem aponta
  // produção no chão de fábrica e começa o dia apontando, nem pro RH, que via
  // um painel de KPIs e 8 grupos vazios.
  const destination = (profile as any)?.is_sales_rep ? '/m' : resolveRoleHome(roleNames);
  return <Navigate to={`${destination}${location.search}${location.hash}`} replace />;
}

function LegacyRouteRedirect({ to }: { to: string }) {
  const location = useLocation();
  const [pathname, targetQuery = ''] = to.split('?');
  const targetParams = new URLSearchParams(targetQuery);
  const sourceParams = new URLSearchParams(location.search);

  // A query do destino fixa a visão canônica; os demais parâmetros (IDs, filtros)
  // precisam viajar do link legado para não quebrar fluxos com seleção.
  sourceParams.forEach((value, key) => {
    if (!targetParams.has(key)) targetParams.append(key, value);
  });

  const search = targetParams.toString();
  return <Navigate to={`${pathname}${search ? `?${search}` : ''}${location.hash}`} replace />;
}

function PedidosRedirect() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const destination = id ? `/sales/edit/${id}` : '/sales';
  return <Navigate to={`${destination}${location.search}${location.hash}`} replace />;
}

/**
 * Compatibilidade de URLs legadas.
 *
 * Só /, /login e /pedidos/:id são permanentes. Todos os demais aliases expiram
 * em 12/01/2027 e devem ser removidos antes disso assim que ficarem 90 dias sem
 * acesso. Este é apenas o contrato de manutenção: não adicionamos telemetria ao
 * roteador para não acoplar observabilidade ao caminho crítico de navegação.
 */
const LEGACY_ALIAS_ROUTES: {
  permanent: { public: RouteObject[]; protected: RouteObject[] };
  expiresOn2027_01_12: RouteObject[];
} = {
  permanent: {
    public: [
      { path: '/login', element: <LegacyRouteRedirect to="/auth" /> },
    ],
    protected: [
      { index: true, element: <RootRedirect /> },
      { path: 'pedidos/:id', element: <PedidosRedirect /> },
    ],
  },
  expiresOn2027_01_12: [
    // Engenharia e estoque
    { path: 'references', element: <LegacyRouteRedirect to="/fichas-tecnicas" /> },
    { path: 'imagens-cores', element: <LegacyRouteRedirect to="/fichas-tecnicas" /> },
    { path: 'silk-registrations', element: <LegacyRouteRedirect to="/silks" /> },
    { path: 'technical-sheets', element: <LegacyRouteRedirect to="/fichas-tecnicas" /> },
    { path: 'products', element: <LegacyRouteRedirect to="/estoque" /> },
    { path: 'component-sheets', element: <LegacyRouteRedirect to="/estoque" /> },
    { path: 'consumo-material', element: <LegacyRouteRedirect to="/estoque" /> },
    { path: 'inventory', element: <LegacyRouteRedirect to="/estoque" /> },
    { path: 'estoque/historico', element: <LegacyRouteRedirect to="/estoque?tab=history" /> },

    // Produção — /pcp permanece somente para bookmarks até vencer o prazo.
    { path: 'pcp', element: <PCPHub /> },
    { path: 'pcp/ondas', element: <LegacyRouteRedirect to="/producao/planejamento" /> },
    { path: 'lead-time', element: <LegacyRouteRedirect to="/producao/analises?view=lead-time" /> },
    { path: 'setores', element: <LegacyRouteRedirect to="/producao/apontamento" /> },
    { path: 'shop-floor', element: <LegacyRouteRedirect to="/producao/planejamento" /> },
    { path: 'pcp-dashboard', element: <LegacyRouteRedirect to="/producao/analises?view=dashboard" /> },
    { path: 'gargalos', element: <LegacyRouteRedirect to="/producao/analises?view=gargalos" /> },
    { path: 'producao/visao-agregada', element: <LegacyRouteRedirect to="/producao/analises?view=lote" /> },
    { path: 'order-flow-audit', element: <LegacyRouteRedirect to="/producao/analises?view=auditoria" /> },
    { path: 'producao', element: <LegacyRouteRedirect to="/producao/planejamento" /> },
    { path: 'producao/live', element: <LegacyRouteRedirect to="/producao/kanban" /> },
    { path: 'producao/timeline', element: <LegacyRouteRedirect to="/producao/analises?view=timeline" /> },
    { path: 'production-dashboard', element: <LegacyRouteRedirect to="/producao/analises?view=dashboard" /> },
    { path: 'production', element: <LegacyRouteRedirect to="/producao/analises?view=dashboard" /> },
    { path: 'producao/fluxo', element: <LegacyRouteRedirect to="/producao/analises?view=matriz" /> },
    { path: 'modules/production', element: <LegacyRouteRedirect to="/producao/planejamento" /> },
    { path: 'capacity-planning', element: <LegacyRouteRedirect to="/producao/analises?view=tempos-padrao" /> },
    { path: 'capacity-planning/distribuir', element: <LegacyRouteRedirect to="/producao/planejamento" /> },
    { path: 'centro-controle', element: <LegacyRouteRedirect to="/producao/analises?view=centro-controle" /> },
    { path: 'quality', element: <LegacyRouteRedirect to="/producao/analises?view=qualidade" /> },
    { path: 'cronoanalise', element: <LegacyRouteRedirect to="/producao/analises?view=cronoanalise" /> },
    { path: 'producao/paradas', element: <LegacyRouteRedirect to="/producao/analises?view=oee" /> },
    { path: 'producao/setup-times', element: <LegacyRouteRedirect to="/producao/analises?view=setup" /> },
    { path: 'corte', element: <LegacyRouteRedirect to="/producao/apontamento?sub=corte" /> },
    { path: 'costura', element: <LegacyRouteRedirect to="/producao/apontamento?sub=costura" /> },
    { path: 'aviamento', element: <LegacyRouteRedirect to="/producao/apontamento?sub=aviamento" /> },
    { path: 'montagem', element: <LegacyRouteRedirect to="/producao/apontamento?sub=montagem" /> },
    { path: 'solagem', element: <LegacyRouteRedirect to="/producao/apontamento?sub=solagem" /> },
    { path: 'acabamento', element: <LegacyRouteRedirect to="/producao/apontamento?sub=acabamento" /> },

    // RH
    { path: 'employees', element: <LegacyRouteRedirect to="/rh?tab=funcionarios" /> },
    { path: 'timesheet', element: <LegacyRouteRedirect to="/rh?tab=ponto" /> },
    { path: 'time-control', element: <LegacyRouteRedirect to="/rh?tab=ponto" /> },
    { path: 'ponto', element: <LegacyRouteRedirect to="/rh?tab=ponto" /> },
    { path: 'rh/fechamento-semanal', element: <LegacyRouteRedirect to="/rh" /> },
    { path: 'rh/ausencias', element: <LegacyRouteRedirect to="/rh?tab=ponto&subtab=ausencias" /> },
    { path: 'rh/banco-de-horas', element: <LegacyRouteRedirect to="/rh" /> },
    { path: 'rh/bank-hours', element: <LegacyRouteRedirect to="/rh" /> },
    { path: 'rh/payroll', element: <LegacyRouteRedirect to="/rh?tab=folha" /> },

    // Comercial, compras e parceiros
    { path: 'sales/consumo', element: <LegacyRouteRedirect to="/sales?view=consumo" /> },
    { path: 'sales-report', element: <LegacyRouteRedirect to="/comercial" /> },
    { path: 'pedidos-venda', element: <LegacyRouteRedirect to="/sales" /> },
    { path: 'finance', element: <LegacyRouteRedirect to="/financeiro" /> },
    { path: 'mrp', element: <LegacyRouteRedirect to="/purchase-planning?tab=mrp" /> },
    { path: 'mrp-advanced', element: <LegacyRouteRedirect to="/purchase-planning?tab=mrp" /> },
    { path: 'weekly-purchasing-plan', element: <LegacyRouteRedirect to="/purchase-planning?tab=weekly" /> },
    { path: 'compras', element: <LegacyRouteRedirect to="/purchase-orders" /> },
    { path: 'fornecedores', element: <LegacyRouteRedirect to="/suppliers" /> },
    { path: 'clientes', element: <LegacyRouteRedirect to="/clients" /> },
    { path: 'ordens-servico', element: <LegacyRouteRedirect to="/terceirizados?tab=orders" /> },
    { path: 'contractors', element: <LegacyRouteRedirect to="/terceirizados?tab=orders" /> },
    { path: 'terceiros', element: <LegacyRouteRedirect to="/terceirizados?tab=orders" /> },
    { path: 'terceiros-na-rua', element: <LegacyRouteRedirect to="/terceirizados?tab=orders" /> },
    { path: 'terceiros/relatorios', element: <LegacyRouteRedirect to="/terceirizados?tab=relatorio" /> },
    { path: 'artisanal-recipes', element: <LegacyRouteRedirect to="/terceirizados?tab=recipes" /> },

    // Logística e sistema
    { path: 'labels', element: <LegacyRouteRedirect to="/label-system" /> },
    { path: 'modules/quality', element: <LegacyRouteRedirect to="/producao/analises?view=qualidade" /> },
    { path: 'modules/reports', element: <LegacyRouteRedirect to="/comercial" /> },
    { path: 'stock', element: <LegacyRouteRedirect to="/estoque" /> },
    { path: 'auditoria', element: <LegacyRouteRedirect to="/audit-logs" /> },
    { path: 'diagnostico', element: <LegacyRouteRedirect to="/system-diagnostics" /> },
    { path: 'monitoramento', element: <LegacyRouteRedirect to="/system-monitor" /> },
    { path: 'ordens-de-producao', element: <LegacyRouteRedirect to="/orders" /> },
    { path: 'ordens', element: <LegacyRouteRedirect to="/orders" /> },
  ],
};

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
  ...LEGACY_ALIAS_ROUTES.permanent.public,
  {
    path: "/auth",
    element: <AuthRoute />,
    errorElement: <RouteErrorFallback />,
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
  {
    // Central de Produção — o Kanban como "programa dedicado de gestão":
    // TELA CHEIA fora do AppLayout (sem sidebar/tabs), pro analista deixar
    // aberta num monitor. Permissão herda de /producao/kanban: o RouteGuard
    // resolve o módulo pelo prefixo e o owner de menu é o próprio item Kanban.
    path: "/producao/kanban/gestao",
    element: (
      <ProtectedRoute>
        <Suspense fallback={<PageLoader />}>
          <RouteGuard>
            <ProducaoKanbanGestao />
          </RouteGuard>
        </Suspense>
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorFallback />,
  },
  // ── Mobile app (/m/*) — fluxo PWA standalone ──
  // Layout próprio (sem sidebar desktop), bottom tab nav. Vendedor instala como
  // app no iPhone/iPad ("Add to Home Screen") e usa em campo. A fila de pedidos
  // (IndexedDB + syncEngine) tolera ficar sem sinal e sincroniza ao voltar; o
  // SW de cache offline está desligado (selfDestroying) — o app não carrega a
  // frio totalmente offline (ver vite.config.ts / CLAUDE.md sobre o cache-trap).
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
        {/* Suspense externo: AppLayout é lazy, então precisa de um boundary
            ACIMA dele. O interno continua cobrindo a troca de rota (Outlet). */}
        <Suspense fallback={<PageSkeleton />}>
          <AppLayout>
            <ScrollRestorationComponent />
            <Suspense fallback={<InlinePageLoader />}>
              <RouteGuard>
                <Outlet />
              </RouteGuard>
            </Suspense>
          </AppLayout>
        </Suspense>
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorFallback />,
    children: [
      {
        path: "dashboard",
        // Skeleton dedicado (8 KPIs + 2 gráficos) em vez do PageSkeleton genérico
        // — placeholder fiel ao layout enquanto o chunk + as queries carregam,
        // pra não dar a sensação de "tela branca" no /dashboard (issue ALTA).
        element: (
          <Suspense fallback={<DashboardSkeleton />}>
            <Dashboard />
          </Suspense>
        ),
      },
      // ── Produção remodelada (2026-07-12): 7 itens diretos ──────────────────
      {
        path: "producao/planejamento",
        element: <ProducaoPlanejamento />,
      },
      {
        path: "producao/kanban",
        element: <ProducaoKanban />,
      },
      {
        path: "producao/estouro",
        element: <ProducaoEstouro />,
      },
      {
        path: "producao/setores",
        element: <ProducaoSetoresConfig />,
      },
      {
        path: "producao/apontamento",
        element: <ProducaoApontamento />,
      },
      {
        path: "producao/analises",
        element: <ProducaoAnalises />,
      },
      {
        // Engine de capacidade (specs/produtividade-por-modelo.md) — rota
        // secundária (Cmd+K / hub Atalhos), NÃO entra na sidebar (cap de 7, R7.1).
        path: "producao/produtividade",
        element: <ProdutividadeModelos />,
      },
      {
        path: "pronta-entrega",
        element: <ProntaEntrega />,
      },
      {
        path: "catalogo",
        element: <Catalogo />,
      },
       {
         path: "estoque",
         children: [
           { index: true, element: <Index /> },
           { path: ":id", element: <ProductDetail /> },
         ],
       },
      {
        // Gestão de grupos de produtos + itens dentro de cada grupo (página Grupos)
        path: "grupos",
        element: <Groups />,
      },
      {
        path: "ajuste-estoque",
        element: <StockAdjustmentPage />,
      },
       {
         path: "fichas-tecnicas",
         element: <TechnicalSheets />,
       },
       {
         // Hub de padrões globais do calçado (regras de componente/tira por
         // cor) — acessado pelo botão "Padrões por Cor" em /fichas-tecnicas.
         path: "fichas-tecnicas/padroes",
         element: <ColorStandards />,
       },
       {
         // Escalonamento / CAD — calculadora independente (saiu da ficha técnica
         // em 2026-06-28). Escaneia molde / importa DXF → curva de consumo por nº.
         path: "escalonamento",
         element: <EscalonamentoCadPage />,
       },
       {
         // Calculadora de Tiras — rendimento de corte artesanal (tira reta, 1D).
         // Ferramenta avulsa; parity travada com strapRollCut (motor do PV).
         path: "calculadora-tiras",
         element: <StrapCalculator />,
       },
       {
         path: "silks",
         element: <Silks />,
       },
      {
        // L5: Consumos, silk e o aviso de embalagem agora usam os mesmos painéis
        // dentro de Solados. A query abre a aba certa para não ocultar o conteúdo.
        path: "consumo-base",
        element: <LegacyRouteRedirect to="/solados?tab=consumos" />,
      },
      {
        // L5: a aba Alertas passou a renderizar também déficits de solado por
        // numeração a partir de useLowStockAlerts, mesma fonte da tela antiga.
        path: "alertas-estoque",
        element: <LegacyRouteRedirect to="/estoque?tab=alerts" />,
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
        path: "orders",
        children: [
          { index: true, element: <Orders /> },
          { path: ":id/edit", element: <OrderEdit /> },
          // Continuam como rota própria até `/orders` saber ler `?view=`.
          // Redirecionar antes disso deixaria as duas telas INALCANÇÁVEIS: 7
          // telas de setor (Silk, Costura, Aviamento, Colagem, Montagem,
          // Solagem, Acabamento) navegam pra `grouped-summary?sector=…&ids=…`
          // e cairiam na lista simples, sem o preview de impressão. A migração
          // pra `?view=` é do lote L6, junto com o contrato de deep-link.
          { path: "summary", element: <OrdersSummary /> },
          { path: "grouped-summary", element: <GroupedReportSummary /> },
        ],
      },
      {
        path: "picking",
        element: <PickingListPage />,
      },
      {
        // Hub "Terceirizados" (rota canônica) — unifica Na Rua + OS +
        // Planejamento + Prestadores + Receitas + Relatório em abas.
        // Ver src/pages/TerceirizadosHub.tsx.
        path: "terceirizados",
        element: <TerceirizadosHub />,
      },
      {
        // Pendências de ponto — dias com batidas inconsistentes/irregulares
        // que precisam ser completadas pelo RH antes de fechar a semana.
        path: "rh/pendencias-ponto",
        element: <TimePendingsPage />,
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
        path: "label-system",
        element: <LabelSystem />,
      },
      {
        path: "sales",
        children: [
          { index: true, element: <SaleOrders /> },
          { path: "new", element: <SaleOrderForm /> },
          { path: "edit/:id", element: <SaleOrderForm /> },
        ],
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
        path: "custos-insumos",
        element: <InputCostsPage />,
      },
      {
        path: "nfe",
        element: <NfePage />,
      },
      {
        path: "purchase-orders/per-pv",
        element: <PurchaseOrdersPerPv />,
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
        path: "comercial",
        element: <ComercialDashboard />,
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
        // Espelho de Ponto Eletrônico — Portaria MTE 671/2021 art. 84
        path: "rh/espelho-ponto/:employeeId",
        element: <EspelhoPontoPage />,
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
        path: "imprimir-fichas",
        element: <PrintWorkSheets />,
      },
      {
        // Ficha de Montadores — fichas de corte/montagem por dia (tabela ficha_montadores)
        path: "fichas-montadores",
        lazy: () => import("./pages/FichaMontadoresPage").then(m => ({ Component: m.default })),
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
        // Qualidade de estoque — quarentena/bloqueio/descarte + recall de lote
        path: "estoque/qualidade",
        lazy: () => import("./pages/EstoqueQualidade").then(m => ({ Component: m.default })),
      },
      {
        // Alçadas de aprovação de compras (gate por valor)
        path: "compras/alcadas",
        lazy: () => import("./pages/AlcadasCompras").then(m => ({ Component: m.default })),
      },
      {
        // Inspeção de recebimento (qualidade/NC → quarentena)
        path: "compras/inspecao",
        lazy: () => import("./pages/InspecaoRecebimento").then(m => ({ Component: m.default })),
      },
      {
        // Inventário cíclico + curva ABC
        path: "estoque/inventario",
        lazy: () => import("./pages/InventarioABC").then(m => ({ Component: m.default })),
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
       { path: "tarefas",             lazy: () => import("./pages/Tarefas").then(m => ({ Component: m.default })) },
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
      ...LEGACY_ALIAS_ROUTES.permanent.protected,
      ...LEGACY_ALIAS_ROUTES.expiresOn2027_01_12,
      {
        path: "*",
        element: <NotFound />,
      },
    ],
  },
], {
  // v7_startTransition não faz parte do FutureConfig do createBrowserRouter
  // (é flag do <RouterProvider future>), mas mantê-lo aqui suprime o
  // deprecation warning do logV6DeprecationWarnings — cast localizado.
  future: {
    v7_startTransition: true,
    v7_relativeSplatPath: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_skipActionErrorRevalidation: true,
  } as Record<string, boolean>,
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

import React, { useState, useEffect, createContext, useContext } from 'react';
import { SignOut as LogOut, List as Menu, X, SidebarSimple as PanelLeftClose, SidebarSimple as PanelLeftOpen, Gear as Settings, ArrowLeft, Plus, ShoppingCart, Package, Star } from '@phosphor-icons/react';
import {
  HUBS,
  systemItems,
  systemShortcuts,
  topItem,
  orderGroupsForRoles,
  hubHasAccessibleChild,
  getAllMenuItems,
  getNavigationResource,
  type NavigationHub,
} from '@/data/navigation';
import logoImg from '@/assets/logo-squad-shoes.jpg';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useMenuFavorites } from '@/hooks/useMenuFavorites';
import { useAccessControl } from '@/hooks/useAccessControl';
import { useCurrentProfile, useCurrentUserRoles, ROLES } from '@/hooks/useUserManagement';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import NotificationBell from './NotificationBell';
import { GlobalSearch } from './GlobalSearch';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ModeToggle } from './ModeToggle';
import PageHeader, { resolveMobileNavMeta } from './PageHeader';
import { BottomNav } from './BottomNav';
import { usePrefetchRoute } from '@/hooks/usePrefetchRoute';
import { useNavOrder, reorderKeys } from '@/hooks/useNavOrder';
import { NavigationAuditWatcher } from './NavigationAuditWatcher';
import { DiagnosticsFab } from '@/components/DiagnosticsFab';
import InboundAllocationHost from '@/components/inventory/InboundAllocationHost';
import { useArtisanalStrapPurchaseOrderApprovalCount } from '@/hooks/useArtisanalStraps';

const QuickActionsFAB = () => {
  const navigate = useNavigate();
  const { canAccessRoute } = useAccessControl();
  const canCreateSales = canAccessRoute('/sales');
  const canManageOrders = canAccessRoute('/orders');
  const canManageStock = canAccessRoute('/estoque');

  // O FAB não pode oferecer um atalho que o RouteGuard bloquearia ao clicar.
  if (!canCreateSales && !canManageOrders && !canManageStock) return null;

  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-5 md:bottom-7 md:right-7 z-50">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            aria-label="Ações rápidas: novo pedido, OP ou entrada de estoque"
            className="h-14 w-14 rounded-full shadow-elevated bg-primary hover:bg-primary/90 text-primary-foreground transition-all duration-200 hover:scale-105 hover:shadow-[0_8px_24px_-4px_hsl(var(--primary)/0.5)]"
          >
            <Plus className="h-6 w-6" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-56 mb-3 shadow-elevated rounded-xl border-border/60">
          {canCreateSales && (
            <DropdownMenuItem onClick={() => navigate('/sales/new')} className="gap-3 cursor-pointer py-3 text-base">
              <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <ShoppingCart className="h-3.5 w-3.5" />
              </div>
              <div>
                <p className="font-medium">Pedido de Venda</p>
                <p className="text-xs text-muted-foreground">Criar novo PV</p>
              </div>
            </DropdownMenuItem>
          )}
          {canManageOrders && (
            <DropdownMenuItem onClick={() => navigate('/orders')} className="gap-3 cursor-pointer py-3 text-base">
              <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Plus className="h-3.5 w-3.5" />
              </div>
              <div>
                <p className="font-medium">Ordem de Produção</p>
                <p className="text-xs text-muted-foreground">Ver e criar OPs</p>
              </div>
            </DropdownMenuItem>
          )}
          {canManageStock && (
            <DropdownMenuItem onClick={() => navigate('/estoque')} className="gap-3 cursor-pointer py-3 text-base">
              <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Package className="h-3.5 w-3.5" />
              </div>
              <div>
                <p className="font-medium">Entrada de Estoque</p>
                <p className="text-xs text-muted-foreground">Abrir estoque</p>
              </div>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const AppLayoutContext = createContext<boolean>(false);

export default function AppLayout({ children, printMode = false }: { children: React.ReactNode; printMode?: boolean }) {
  const { signOut } = useAuth();
  const { isAdmin, canAccessRoute } = useAccessControl();
  const approvalCountQuery = useArtisanalStrapPurchaseOrderApprovalCount(isAdmin);
  const purchaseApprovalCount = approvalCountQuery.data || 0;
  const { data: currentProfile } = useCurrentProfile();
  const { data: currentRoles = [] } = useCurrentUserRoles();
  // `useCurrentUserRoles` devolve objetos; a apresentação por perfil trabalha
  // com nomes. Memo pra não recriar o array a cada render e invalidar os memos
  // que dependem dele.
  const roleNames = React.useMemo(() => currentRoles.map((r) => r.role), [currentRoles]);
  const [mobileOpen, setMobileOpen] = useState(false);
  // O drawer mobile é um aside artesanal (não usa o primitive Sheet): prender o
  // foco, fechar no Escape e DEVOLVER o foco ao gatilho são responsabilidade
  // nossa. Antes só o foco inicial e o Escape estavam feitos (achado F17): o Tab
  // escapava e ia navegar a página ATRÁS do drawer, e ao fechar o foco caía no
  // <body> — quem usa teclado perdia o lugar.
  const mobileDrawerRef = React.useRef<HTMLElement>(null);
  const gatilhoMenuRef = React.useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!mobileOpen) return;

    gatilhoMenuRef.current = document.activeElement as HTMLElement | null;
    mobileDrawerRef.current?.querySelector<HTMLElement>('button, a, [tabindex]')?.focus();

    const focaveis = () => Array.from(
      mobileDrawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((el) => el.offsetParent !== null);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMobileOpen(false); return; }
      if (e.key !== 'Tab') return;
      const els = focaveis();
      if (els.length === 0) return;
      const primeiro = els[0];
      const ultimo = els[els.length - 1];
      const atual = document.activeElement;
      if (e.shiftKey && (atual === primeiro || !mobileDrawerRef.current?.contains(atual))) {
        e.preventDefault(); ultimo.focus();
      } else if (!e.shiftKey && atual === ultimo) {
        e.preventDefault(); primeiro.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      gatilhoMenuRef.current?.focus?.();
    };
  }, [mobileOpen]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const isInsideLayout = useContext(AppLayoutContext);
  const navigate = useNavigate();
  const location = useLocation();

  // Favoritos persistidos NO BANCO por usuário (useMenuFavorites). Antes
  // viviam só no localStorage e sumiam ao limpar cache / trocar de navegador /
  // mudar de domínio — esse era o motivo de "os favoritos sumiram". O hook
  // mantém o localStorage como cache e migra o que existir nele pro banco.
  const { favorites, toggleFavorite: toggleFav, reorderFavorites } = useMenuFavorites();
  // DnD dos FAVORITOS — reordena dentro da lista de favoritos (persistência
  // própria via useMenuFavorites, separada da ordem de grupos/itens do menu).
  const [favDrag, setFavDrag] = React.useState<string | null>(null);
  const [favDropTarget, setFavDropTarget] = React.useState<string | null>(null);
  const handleFavDragStart = (path: string) => (e: React.DragEvent) => { setFavDrag(path); e.dataTransfer.effectAllowed = 'move'; };
  const handleFavDragOver = (path: string) => (e: React.DragEvent) => { if (!favDrag || favDrag === path) return; e.preventDefault(); setFavDropTarget(path); };
  const handleFavDrop = (path: string) => (e: React.DragEvent) => { e.preventDefault(); if (favDrag && favDrag !== path) reorderFavorites(favDrag, path); setFavDrag(null); setFavDropTarget(null); };
  const clearFavDrag = () => { setFavDrag(null); setFavDropTarget(null); };
  const favDropStyle = (path: string): React.CSSProperties | undefined =>
    favDropTarget === path ? { boxShadow: 'inset 0 2px 0 0 hsl(var(--primary))' } : undefined;

  const filteredFavorites = React.useMemo(
    () => favorites.filter(item => canAccessRoute(item.path)),
    [favorites, canAccessRoute]
  );

  const toggleFavorite = (e: React.MouseEvent, name: string, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFav(name, path);
  };

  const iconForPath = (path: string) =>
    getNavigationResource(path)?.icon
    ?? getAllMenuItems().find((i) => i.path === path)?.icon
    ?? Star;

  // Hubs visíveis: ≥1 filho liberado. Ordem por papel, depois preferência DnD.
  const filteredHubs = React.useMemo(
    () => orderGroupsForRoles(
      HUBS.filter((hub) => hubHasAccessibleChild(hub, canAccessRoute)),
      roleNames,
    ),
    [canAccessRoute, roleNames],
  );

  const { applyNavOrder, setGroupOrder, resetOrder, hasCustomOrder } = useNavOrder();
  const orderedHubs = React.useMemo(() => {
    const asGroups = filteredHubs.map((hub) => ({
      label: hub.label,
      items: [{ path: hub.path }],
      hub,
    }));
    return applyNavOrder(asGroups).map((g) => (g as typeof asGroups[number]).hub);
  }, [applyNavOrder, filteredHubs]);

  // Atalhos = sistema (filtrados) + favoritos, sem duplicar path.
  const filteredSystemShortcuts = React.useMemo(
    () => systemShortcuts.filter((item) => canAccessRoute(item.path)),
    [canAccessRoute],
  );
  const atalhoPaths = React.useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; path: string; icon: typeof Star; favorited: boolean }[] = [];
    for (const item of filteredSystemShortcuts) {
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      out.push({
        name: item.label,
        path: item.path,
        icon: item.icon,
        favorited: filteredFavorites.some((f) => f.path === item.path),
      });
    }
    for (const fav of filteredFavorites) {
      if (seen.has(fav.path)) continue;
      seen.add(fav.path);
      out.push({ name: fav.name, path: fav.path, icon: iconForPath(fav.path), favorited: true });
    }
    return out;
  }, [filteredSystemShortcuts, filteredFavorites]);

  // DnD só entre hubs (modelo v2).
  const dragInfo = React.useRef<{ kind: 'hub'; label: string } | null>(null);
  const [dropTarget, setDropTarget] = React.useState<{ key: string; pos: 'before' | 'after' } | null>(null);

  const filteredSystemItems = isAdmin ? systemItems : [];
  const { prefetch, cancel: cancelPrefetch } = usePrefetchRoute();
  const isDashboard = location.pathname === '/' || location.pathname === '/dashboard';
  const mobileNavMeta = resolveMobileNavMeta(location.pathname, location.search);

  // Fecha o drawer ao navegar — senão a pessoa troca de tela pelo BottomNav e
  // o menu lateral continua aberto por cima.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  if (isInsideLayout) return <>{children}</>;

  const isHubActive = (hub: NavigationHub) => {
    if (location.pathname === hub.path || location.pathname.startsWith(hub.path + '/')) return true;
    return hub.children.some((item) => {
      const p = item.path.split('?')[0];
      return location.pathname === p || location.pathname.startsWith(p + '/');
    });
  };

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar-collapsed', String(next)); } catch {}
      return next;
    });
  };

  const clearDrag = () => { dragInfo.current = null; setDropTarget(null); };

  const dropPos = (e: React.DragEvent): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY - rect.top > rect.height / 2 ? 'after' : 'before';
  };

  const handleHubDragStart = (label: string) => (e: React.DragEvent) => {
    dragInfo.current = { kind: 'hub', label };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', label); } catch { /* firefox */ }
  };

  const handleHubDragOver = (label: string) => (e: React.DragEvent) => {
    if (dragInfo.current?.kind !== 'hub') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ key: label, pos: dropPos(e) });
  };

  const handleHubDrop = (label: string) => (e: React.DragEvent) => {
    const drag = dragInfo.current;
    if (drag?.kind !== 'hub') return;
    e.preventDefault();
    setGroupOrder(reorderKeys(orderedHubs.map((h) => h.label), drag.label, label, dropPos(e)));
    clearDrag();
  };

  const hubDropStyle = (label: string): React.CSSProperties | undefined => {
    if (dropTarget?.key !== label) return undefined;
    return {
      boxShadow: dropTarget.pos === 'before'
        ? 'inset 0 3px 0 0 hsl(var(--primary))'
        : 'inset 0 -3px 0 0 hsl(var(--primary))',
      borderRadius: '2px',
    };
  };

  // ── Nav item active class ────────────────────────────────
  // Painel flutuante (ref. visual 2026-10): ativo = barra vermelha + ícone
  // vermelho + texto branco, SEM wash de fundo. Inativo = cinza muted.
  /**
   * ⚠ A estrela de favorito NÃO pode viver dentro do NavLink: `<button>` dentro
   * de `<a>` é HTML inválido e cria uma parada de teclado ambígua — ativar a
   * estrela podia disparar a navegação junto (achado F16 da auditoria de IA).
   * Ela é irmã, posicionada em cima; por isso o `pr-8` reserva o espaço dela.
   */
  const navItemClass = (isActive: boolean, reserveRight = false) => cn(
    "group flex items-center justify-between text-[13px] font-medium transition-colors duration-150 relative",
    reserveRight ? "pr-8" : "pr-3",
    isActive
      ? "border-l-[3px] border-primary pl-[13px] py-2.5 text-sidebar-foreground"
      : "border-l-[3px] border-transparent pl-[13px] py-2.5 text-sidebar-muted hover:text-sidebar-foreground"
  );

  const navIconClass = (isActive: boolean) =>
    cn("h-[18px] w-[18px] shrink-0", isActive ? "text-primary" : "text-sidebar-muted group-hover:text-sidebar-foreground");

  const collapsedItemClass = (isActive: boolean) => cn(
    "group flex items-center justify-center h-10 w-10 mx-auto mb-1 transition-colors duration-100",
    isActive
      ? "border-l-[3px] border-primary text-primary"
      : "border-l-[3px] border-transparent text-sidebar-muted hover:text-sidebar-foreground"
  );

  const sectionLabelClass = "px-4 pt-3 pb-1.5 text-[11px] font-medium text-sidebar-muted/80";

  // ── Sidebar content ──────────────────────────────────────
  const sidebarContent = (mobile: boolean) => {
    const isCollapsed = !mobile && sidebarCollapsed;

    return (
      <div className={cn("flex flex-col h-full text-sidebar-foreground overflow-hidden", mobile && "safe-top")}>

        {/* ── Brand header ── */}
        <div className={cn(
          "border-b border-sidebar-border/60 shrink-0",
          isCollapsed ? "px-1.5 py-3 flex flex-col items-center gap-2" : "px-4 pt-4 pb-3"
        )}>
          {isCollapsed ? (
            <>
              <div className="h-9 w-9 rounded-md overflow-hidden ring-1 ring-sidebar-border/80 bg-card shrink-0">
                <img src={logoImg} alt="Squad Shoes" className="h-full w-full object-contain" />
              </div>
              <GlobalSearch compact />
              <ModeToggle className="h-8 w-8 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent" />
              <NotificationBell key="desktop-notif" className="h-8 w-8" />
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-md overflow-hidden ring-1 ring-sidebar-border/80 shrink-0 bg-card">
                  <img src={logoImg} alt="Squad Shoes" className="h-full w-full object-contain" />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="ed-display text-[22px] uppercase tracking-tight text-sidebar-foreground leading-none">
                    Squad<span className="text-primary">·</span>Shoes
                  </p>
                  <p className="mt-2 text-[10px] font-medium tracking-[0.14em] uppercase text-sidebar-muted">
                    Gestão Industrial
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0 -mt-0.5">
                  <ModeToggle className="h-8 w-8 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent" />
                  <NotificationBell key="sidebar-mobile-notif" className="h-8 w-8" />
                  {mobile && (
                    <Button variant="ghost" size="icon" aria-label="Fechar menu lateral" className="shrink-0 md:hidden h-8 w-8 text-sidebar-muted" onClick={() => setMobileOpen(false)}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-3.5">
                <GlobalSearch />
              </div>
            </>
          )}
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">

          {/* Dashboard — item fixo no topo */}
          {isCollapsed ? (
            <div className="px-2 pt-1 pb-2 border-b border-sidebar-border/40 mb-1">
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={topItem.path}
                    className={({ isActive }) => collapsedItemClass(isActive)}
                  >
                    {({ isActive }) => <topItem.icon className={navIconClass(isActive)} weight={isActive ? 'bold' : 'regular'} />}
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8} className="text-xs font-medium">
                  {topItem.label}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="px-2 pb-2 border-b border-sidebar-border/40 mb-1">
              <p className={sectionLabelClass}>Painel</p>
              <NavLink
                to={topItem.path}
                className={({ isActive }) => navItemClass(isActive)}
              >
                {({ isActive }) => (
                  <div className="flex items-center gap-3 min-w-0">
                    <topItem.icon className={navIconClass(isActive)} weight={isActive ? 'bold' : 'regular'} />
                    <span className="truncate">{topItem.label}</span>
                  </div>
                )}
              </NavLink>
            </div>
          )}

          {/* Atalhos — sistema + favoritos */}
          {isCollapsed ? (
            atalhoPaths.length > 0 && (
              <div className="px-2 pb-2 mb-1 border-b border-sidebar-border/40 space-y-1">
                {atalhoPaths.map((item) => (
                  <Tooltip key={item.path} delayDuration={0}>
                    <TooltipTrigger asChild>
                      <NavLink to={item.path} className={({ isActive }) => cn(collapsedItemClass(isActive), 'relative')}>
                        {({ isActive }) => (
                          <>
                            <item.icon className={navIconClass(isActive)} weight={isActive ? 'bold' : 'regular'} />
                            {item.favorited && (
                              <div className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
                            )}
                          </>
                        )}
                      </NavLink>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8} className="text-xs font-medium">
                      {item.name}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )
          ) : (
            atalhoPaths.length > 0 && (
              <div className="px-2 pb-2 mb-1 border-b border-sidebar-border/40">
                <p className={sectionLabelClass}>Atalhos</p>
                <div className="mt-0.5 space-y-0.5">
                  {atalhoPaths.map((item) => (
                    <div key={item.path} className="relative">
                      <NavLink
                        to={item.path}
                        draggable={!mobile && item.favorited}
                        onDragStart={!mobile && item.favorited ? handleFavDragStart(item.path) : undefined}
                        onDragOver={!mobile && item.favorited ? handleFavDragOver(item.path) : undefined}
                        onDrop={!mobile && item.favorited ? handleFavDrop(item.path) : undefined}
                        onDragEnd={!mobile ? clearFavDrag : undefined}
                        onClick={mobile ? () => setMobileOpen(false) : undefined}
                        onMouseEnter={() => prefetch(item.path)}
                        onMouseLeave={cancelPrefetch}
                        onFocus={() => prefetch(item.path)}
                        style={item.favorited ? favDropStyle(item.path) : undefined}
                        className={({ isActive }) => cn(navItemClass(isActive, item.favorited), !mobile && item.favorited && 'cursor-grab active:cursor-grabbing select-none')}
                      >
                        {({ isActive }) => (
                          <div className="flex items-center gap-3 min-w-0">
                            <item.icon className={navIconClass(isActive)} weight={isActive ? 'bold' : 'regular'} />
                            <span className="truncate">{item.name}</span>
                          </div>
                        )}
                      </NavLink>
                      {item.favorited && (
                        <button
                          onClick={(e) => toggleFavorite(e, item.name, item.path)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-sm text-sidebar-muted hover:text-primary transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Remover ${item.name} dos favoritos`}
                        >
                          <Star className="h-3 w-3 fill-current" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Hubs */}
          {isCollapsed ? (
            <div className="px-2 space-y-1">
              {orderedHubs.map((hub) => (
                <Tooltip key={hub.path} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <NavLink
                      to={hub.path}
                      onMouseEnter={() => prefetch(hub.path)}
                      onMouseLeave={cancelPrefetch}
                      className={() => collapsedItemClass(isHubActive(hub))}
                    >
                      <hub.icon className={navIconClass(isHubActive(hub))} weight={isHubActive(hub) ? 'bold' : 'regular'} />
                    </NavLink>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8} className="text-xs font-medium">
                    {hub.label}
                  </TooltipContent>
                </Tooltip>
              ))}
              {filteredSystemItems.length > 0 && (
                <div className="pt-2 mt-2 border-t border-sidebar-border/40 space-y-1">
                  {filteredSystemItems.map((item) => (
                    <Tooltip key={item.path} delayDuration={0}>
                      <TooltipTrigger asChild>
                        <NavLink to={item.path} className={({ isActive }) => cn(collapsedItemClass(isActive), 'relative')}>
                          {({ isActive }) => (
                            <>
                              <item.icon className={navIconClass(isActive)} weight={isActive ? 'bold' : 'regular'} />
                              {item.path === '/admin/aprovacao-ordens-compra' && purchaseApprovalCount > 0 && (
                                <span className="absolute -right-0.5 -top-0.5 text-[10px] font-medium tabular-nums text-sidebar-muted">
                                  {purchaseApprovalCount > 99 ? '99+' : purchaseApprovalCount}
                                </span>
                              )}
                            </>
                          )}
                        </NavLink>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8} className="text-xs font-medium">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="px-2 space-y-0.5">
              {orderedHubs.length === 0 && (
                <div className="mx-2 mt-2 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/40 p-3">
                  <p className="text-xs font-semibold text-sidebar-foreground">Nenhuma área liberada</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-sidebar-muted">
                    Sua conta ainda não tem permissão para nenhuma área do sistema.
                    Peça a um administrador para liberar os acessos em Configurações.
                  </p>
                </div>
              )}
              {orderedHubs.length > 0 && (
                <p className={sectionLabelClass}>Áreas</p>
              )}
              {orderedHubs.map((hub) => {
                const active = isHubActive(hub);
                return (
                  <div
                    key={hub.path}
                    onDragOver={!mobile ? handleHubDragOver(hub.label) : undefined}
                    onDrop={!mobile ? handleHubDrop(hub.label) : undefined}
                    style={hubDropStyle(hub.label)}
                  >
                    <NavLink
                      to={hub.path}
                      draggable={!mobile}
                      onDragStart={!mobile ? handleHubDragStart(hub.label) : undefined}
                      onDragEnd={!mobile ? clearDrag : undefined}
                      onClick={mobile ? () => setMobileOpen(false) : undefined}
                      onMouseEnter={() => prefetch(hub.path)}
                      onMouseLeave={cancelPrefetch}
                      onFocus={() => prefetch(hub.path)}
                      className={() => cn(navItemClass(active), !mobile && 'cursor-grab active:cursor-grabbing select-none')}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <hub.icon className={navIconClass(active)} weight={active ? 'bold' : 'regular'} />
                        <span className="truncate">{hub.label}</span>
                      </div>
                    </NavLink>
                  </div>
                );
              })}

              {!mobile && hasCustomOrder && (
                <button
                  onClick={() => { resetOrder(); }}
                  className="w-full text-left px-4 py-2 mt-1 text-[11px] font-medium text-sidebar-muted hover:text-sidebar-foreground transition-colors"
                >
                  ↺ Restaurar ordem padrão
                </button>
              )}

              {filteredSystemItems.length > 0 && (
                <div className="mt-2 pt-2 border-t border-sidebar-border/40">
                  <p className={sectionLabelClass}>Sistema</p>
                  {filteredSystemItems.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onMouseEnter={() => prefetch(item.path)}
                      onMouseLeave={cancelPrefetch}
                      onFocus={() => prefetch(item.path)}
                      className={({ isActive }) => navItemClass(isActive)}
                    >
                      {({ isActive }) => (
                        <div className="flex items-center gap-3 min-w-0 w-full">
                          <item.icon className={navIconClass(isActive)} weight={isActive ? 'bold' : 'regular'} />
                          <span className="truncate">{item.label}</span>
                          {item.path === '/admin/aprovacao-ordens-compra' && purchaseApprovalCount > 0 && (
                            <span className="ml-auto text-[12px] font-medium tabular-nums text-sidebar-muted">
                              {purchaseApprovalCount > 99 ? '99+' : purchaseApprovalCount}
                            </span>
                          )}
                        </div>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* ── Footer ── */}
        <div className={cn(
          "border-t border-sidebar-border/60 shrink-0",
          isCollapsed ? "px-2 py-3 flex flex-col items-center gap-2" : "px-3 py-3"
        )}>
          {isCollapsed ? (
            <>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button onClick={toggleSidebar} className="flex items-center justify-center h-9 w-9 rounded-md text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
                    <PanelLeftOpen className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Expandir menu</TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button onClick={signOut} className="flex items-center justify-center h-9 w-9 rounded-md text-sidebar-muted hover:text-destructive hover:bg-destructive/10 transition-colors">
                    <LogOut className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Sair</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2.5 px-1.5 py-1">
                <div className="h-8 w-8 rounded-full bg-sidebar-accent ring-1 ring-sidebar-border flex items-center justify-center shrink-0 text-sidebar-foreground font-semibold text-[11px]">
                  {currentProfile?.full_name
                    ? currentProfile.full_name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                    : '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-sidebar-foreground truncate leading-tight">
                    {currentProfile?.full_name || 'Usuário'}
                  </p>
                  <p className="text-[11px] text-sidebar-muted truncate leading-tight mt-0.5">
                    {currentRoles.length > 0
                      ? ROLES.find(r => r.key === currentRoles[0].role)?.label || currentRoles[0].role
                      : (import.meta.env.VITE_APP_VERSION?.split('-')[0] || 'ERP Industrial')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={signOut}
                  className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-sidebar-muted hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5 shrink-0" />
                  <span>Sair</span>
                </button>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button onClick={toggleSidebar} className="flex items-center justify-center h-8 w-8 rounded-md text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors shrink-0">
                      <PanelLeftClose className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Recolher menu</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Mobile top bar — sistema agora via Settings icon (mantém acesso móvel)
  const mobileSystemMenu = filteredSystemItems.length > 0 ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Menu do sistema" className="h-9 w-9 text-foreground/60 hover:text-foreground">
          <Settings className="h-5 w-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {filteredSystemItems.map((item) => (
          <DropdownMenuItem key={item.path} onClick={() => navigate(item.path)} className="gap-2 cursor-pointer">
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
            {item.path === '/admin/aprovacao-ordens-compra' && purchaseApprovalCount > 0 && (
              <span className="ml-auto text-[12px] font-medium tabular-nums text-muted-foreground">
                {purchaseApprovalCount > 99 ? '99+' : purchaseApprovalCount}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  // Slot desktop = painel + gutters (12px cada lado). 248+24 / 64+24.
  const desktopSidebarSlot = sidebarCollapsed ? 'w-[88px]' : 'w-[272px]';

  return (
    <AppLayoutContext.Provider value={true}>
      <TooltipProvider delayDuration={300}>
        <NavigationAuditWatcher />
        {/* Skip-link — fica oculto até receber foco por Tab. Permite usuários
            de teclado/leitor pular a sidebar e ir direto ao conteúdo. */}
        <a
          href="#conteudo-principal"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-foreground focus:text-background focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          Pular para o conteúdo
        </a>
        <div className={cn('min-h-screen flex bg-background overflow-x-hidden', printMode && 'print:bg-background')}>
          {mobileOpen && (
            <div
              className={cn('fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden transition-opacity', printMode && 'print:hidden')}
              onClick={() => setMobileOpen(false)}
            />
          )}

          {/* Mobile sidebar — painel flutuante com margem (mesma linguagem do desktop) */}
          <aside
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
            aria-hidden={!mobileOpen}
            className={cn(
              'fixed z-50 flex flex-col transform transition-transform duration-200 ease-out md:hidden',
              'top-3 bottom-3 left-3 w-[min(260px,calc(100vw-1.5rem))]',
              mobileOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1.5rem)]',
              printMode && 'print:hidden'
            )}
          >
            <div className="sidebar-panel flex flex-col h-full w-full shadow-[0_12px_40px_-12px_rgba(0,0,0,0.55)]">
              {sidebarContent(true)}
            </div>
          </aside>

          {/* Desktop sidebar — painel flutuante 248px / 64px + gutter 12px */}
          <aside className={cn(
            'hidden md:flex shrink-0 sticky top-0 h-screen box-border p-3 transition-all duration-200 ease-in-out',
            desktopSidebarSlot,
            printMode && 'print:hidden'
          )}>
            <div className="sidebar-panel flex flex-col h-full w-full min-h-0 shadow-[0_8px_30px_-14px_rgba(0,0,0,0.45)]">
              {sidebarContent(false)}
            </div>
          </aside>

          <div className="flex-1 min-w-0 flex flex-col min-h-screen relative overflow-x-hidden">
            {/* Mobile top bar */}
            <header className={cn(
              'md:hidden sticky top-0 z-30 border-b border-border/60 h-14 flex items-center px-4 gap-2 bg-background/95 backdrop-blur-sm safe-top box-content',
              printMode && 'print:hidden'
            )}>
              <Button variant="ghost" size="icon" aria-label="Abrir menu lateral" className="h-9 w-9 shrink-0" onClick={() => setMobileOpen(true)}>
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
              {!isDashboard && (
                <Button variant="ghost" size="icon" aria-label="Voltar para a tela anterior" className="h-9 w-9 shrink-0 -ml-1" onClick={() => navigate(-1)}>
                  <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                </Button>
              )}
              <div className="h-8 w-8 rounded-lg overflow-hidden ring-1 ring-border bg-card shrink-0 shadow-sm">
                <img src={logoImg} alt="Squad Shoes" className="h-full w-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-extrabold text-foreground leading-tight tracking-tight truncate">
                  {isDashboard ? 'Squad Shoes' : mobileNavMeta.label}
                </p>
                <p className="text-xs text-muted-foreground leading-tight mt-0.5 font-semibold tracking-[0.05em] uppercase truncate">
                  {isDashboard ? 'Gestão Industrial' : (mobileNavMeta.group || 'Squad Shoes')}
                </p>
              </div>
              <div className="flex items-center gap-0.5">
                <GlobalSearch compact />
                <ModeToggle />
                 <NotificationBell key="header-mobile-notif" className="text-foreground/60 hover:text-foreground hover:bg-accent" />
                 {mobileSystemMenu}
              </div>
            </header>

            {/* Desktop breadcrumb bar */}
            {!isDashboard && (
              <div className={cn(
                "hidden md:flex border-b border-border/40 bg-background/96 backdrop-blur-md sticky top-0 z-20",
                "shadow-[0_1px_0_0_hsl(var(--border)/0.4)]",
                printMode && 'print:hidden'
              )}>
                <div className="w-full h-9 flex items-center px-3 md:px-4 lg:px-6 xl:px-8 gap-2">
                  <PageHeader compact />
                </div>
              </div>
            )}

            <main id="conteudo-principal" tabIndex={-1} className={cn(
              // Layout fluido: usa 100% da largura disponível, sem cap em 1600px.
              // Densificação 2026-10: laterais −1 degrau; py-4 no desktop.
              // Mobile mantém px-4 e pb seguro pro BottomNav (alvos de toque).
              'flex-1 w-full px-4 md:px-4 lg:px-6 xl:px-8 2xl:px-10 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-4 overflow-auto',
              printMode && 'print:px-0 print:py-0 print:overflow-visible'
            )}>
              <div className="md:hidden">
                <PageHeader />
              </div>
              {/* Transição de página: keyed por pathname (NÃO search — senão
                  troca de aba via ?tab=/?sub=/?modo= remontaria a página inteira)
                  pra re-disparar o keyframe `page-enter` a cada navegação. */}
              <div key={location.pathname} className="page-enter">
                {children}
              </div>
            </main>
            <BottomNav />
            <QuickActionsFAB />
            <DiagnosticsFab />
            {/* Rateio da entrada de estoque (spec integracao-estoque-pv-compras §4):
                abre sozinho depois de uma entrada que quitou falta de PV. */}
            <InboundAllocationHost />
          </div>
        </div>
      </TooltipProvider>
    </AppLayoutContext.Provider>
  );
}

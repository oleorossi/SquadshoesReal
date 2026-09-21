import React, { useState, useEffect, createContext, useContext } from 'react';
import { SignOut as LogOut, List as Menu, X, SidebarSimple as PanelLeftClose, SidebarSimple as PanelLeftOpen, Gear as Settings, ArrowLeft, Plus, ShoppingCart, Package, Star, Lightning as Zap } from '@phosphor-icons/react';
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
  // Industrial Editorial Pro: active state ganha borda esquerda 2px vermelho
  // squad + texto foreground. Rounded-sm em vez de lg. Sem bg colorido — borda
  // diz tudo. Hover sutil em foreground/5.
  // 22/05/2026: fonte reduzida text-base → text-[13px] + py mais apertado
  // (1.5 em vez de 2) pra densidade maior no menu — pedido user.
  // Industrial Editorial Pro 2.0: border-left ativo bump 2px → 3px pra
  // statement editorial mais decisivo. Padding interno compensado pra
  // manter alinhamento visual com itens não-ativos.
  /**
   * ⚠ A estrela de favorito NÃO pode viver dentro do NavLink: `<button>` dentro
   * de `<a>` é HTML inválido e cria uma parada de teclado ambígua — ativar a
   * estrela podia disparar a navegação junto (achado F16 da auditoria de IA).
   * Ela é irmã, posicionada em cima; por isso o `pr-9` reserva o espaço dela.
   */
  const navItemClass = (isActive: boolean) => cn(
    "group flex items-center justify-between rounded-sm text-[13px] font-medium transition-all duration-150 relative pr-9",
    isActive
      ? "border-l-[3px] border-primary pl-[10px] pr-3 py-1.5 text-sidebar-foreground font-semibold bg-sidebar-foreground/[0.04]"
      : "border-l-2 border-transparent px-3 py-1.5 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-foreground/[0.04]"
  );

  const collapsedItemClass = (isActive: boolean) => cn(
    "flex items-center justify-center h-9 w-9 rounded-sm mx-auto mb-0.5 transition-all duration-100",
    isActive
      ? "border-l-[3px] border-primary text-sidebar-foreground bg-sidebar-foreground/[0.04]"
      : "border-l-2 border-transparent text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-foreground/[0.04]"
  );

  // ── Sidebar content ──────────────────────────────────────
  const sidebarContent = (mobile: boolean) => {
    const isCollapsed = !mobile && sidebarCollapsed;

    return (
      <div className={cn("flex flex-col h-full bg-sidebar text-sidebar-foreground overflow-hidden glass-sidebar", mobile && "safe-top")}>

        {/* ── Brand header ── */}
        <div className={cn(
          "border-b border-sidebar-border shrink-0",
          isCollapsed ? "px-2 py-2.5 flex flex-col items-center gap-2" : "px-4 py-3"
        )}>
          {isCollapsed ? (
            <>
              <div className="h-8 w-8 rounded-lg overflow-hidden ring-1 ring-sidebar-border shadow-sm bg-card shrink-0">
                <img src={logoImg} alt="Squad Shoes" className="h-full w-full object-contain" />
              </div>
              <GlobalSearch compact />
              <ModeToggle className="h-7 w-7 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent" />
               <NotificationBell key="desktop-notif" className="h-7 w-7" />
            </>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-sm overflow-hidden ring-1 ring-sidebar-border shrink-0 bg-card">
                  <img src={logoImg} alt="Squad Shoes" className="h-full w-full object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  {/* Industrial Editorial Pro: nome em Anton uppercase com
                      ponto separador vermelho squad (espelha o /design-preview). */}
                  <p className="ed-display text-xl text-sidebar-foreground leading-none">
                    Squad<span className="text-primary">·</span>Shoes
                  </p>
                  <p className="ed-eyebrow text-sidebar-muted mt-1">Gestão Industrial</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <ModeToggle className="h-7 w-7 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent" />
               <NotificationBell key="sidebar-mobile-notif" className="h-7 w-7" />
                  {mobile && (
                    <Button variant="ghost" size="icon" aria-label="Fechar menu lateral" className="shrink-0 md:hidden h-7 w-7 text-sidebar-muted" onClick={() => setMobileOpen(false)}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-2.5">
                <GlobalSearch />
              </div>
            </>
          )}
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">

          {/* Dashboard — item fixo no topo */}
          {isCollapsed ? (
            <div className="px-2 pt-1 pb-2 border-b border-sidebar-border/30 mb-1">
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={topItem.path}
                    className={({ isActive }) => collapsedItemClass(isActive)}
                  >
                    <topItem.icon className="h-4 w-4 shrink-0" />
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8} className="text-xs font-medium">
                  {topItem.label}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="px-2 pb-2 border-b border-sidebar-border/30 mb-1">
              <NavLink
                to={topItem.path}
                className={({ isActive }) => navItemClass(isActive)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <topItem.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{topItem.label}</span>
                </div>
              </NavLink>
            </div>
          )}

          {/* Atalhos — sistema + favoritos */}
          {isCollapsed ? (
            atalhoPaths.length > 0 && (
              <div className="px-2 pb-2 mb-1 border-b border-sidebar-border/30 space-y-0.5">
                {atalhoPaths.map((item) => (
                  <Tooltip key={item.path} delayDuration={0}>
                    <TooltipTrigger asChild>
                      <NavLink to={item.path} className={({ isActive }) => cn(collapsedItemClass(isActive), 'relative')}>
                        <item.icon className="h-4 w-4 shrink-0" />
                        {item.favorited && (
                          <div className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
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
              <div className="px-2 pb-2 mb-1 border-b border-sidebar-border/30">
                <p className="px-3 py-1.5 ed-eyebrow text-sidebar-muted flex items-center gap-1.5">
                  <Zap className="h-3 w-3 shrink-0 text-primary" />
                  Atalhos
                </p>
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
                        className={({ isActive }) => cn(navItemClass(isActive), !mobile && item.favorited && 'cursor-grab active:cursor-grabbing select-none')}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{item.name}</span>
                        </div>
                      </NavLink>
                      {item.favorited && (
                        <button
                          onClick={(e) => toggleFavorite(e, item.name, item.path)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-sm opacity-100 text-primary hover:text-primary/60 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <div className="px-2 space-y-0.5">
              {orderedHubs.map((hub) => (
                <Tooltip key={hub.path} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <NavLink
                      to={hub.path}
                      onMouseEnter={() => prefetch(hub.path)}
                      onMouseLeave={cancelPrefetch}
                      className={() => collapsedItemClass(isHubActive(hub))}
                    >
                      <hub.icon className="h-4 w-4 shrink-0" />
                    </NavLink>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8} className="text-xs font-medium">
                    {hub.label}
                  </TooltipContent>
                </Tooltip>
              ))}
              {filteredSystemItems.length > 0 && (
                <div className="pt-2 mt-2 border-t border-sidebar-border/40 space-y-0.5">
                  {filteredSystemItems.map((item) => (
                    <Tooltip key={item.path} delayDuration={0}>
                      <TooltipTrigger asChild>
                        <NavLink to={item.path} className={({ isActive }) => cn(collapsedItemClass(isActive), 'relative')}>
                          <item.icon className="h-4 w-4 shrink-0" />
                          {item.path === '/admin/aprovacao-ordens-compra' && purchaseApprovalCount > 0 && (
                            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                              {purchaseApprovalCount > 99 ? '99+' : purchaseApprovalCount}
                            </span>
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
                <div className="mx-1 mt-2 rounded-md border border-sidebar-border/60 bg-sidebar-accent/30 p-3">
                  <p className="text-xs font-semibold text-sidebar-foreground">Nenhuma área liberada</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-sidebar-foreground/70">
                    Sua conta ainda não tem permissão para nenhuma área do sistema.
                    Peça a um administrador para liberar os acessos em Configurações.
                  </p>
                </div>
              )}
              {orderedHubs.length > 0 && (
                <p className="px-3 py-1.5 mt-1 ed-eyebrow text-sidebar-muted">Áreas</p>
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
                      <div className="flex items-center gap-2.5 min-w-0">
                        <hub.icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{hub.label}</span>
                      </div>
                    </NavLink>
                  </div>
                );
              })}

              {!mobile && hasCustomOrder && (
                <button
                  onClick={() => { resetOrder(); }}
                  className="w-full text-left px-3 py-1.5 mt-1 ed-eyebrow text-sidebar-muted hover:text-sidebar-foreground transition-colors"
                >
                  ↺ Restaurar ordem padrão
                </button>
              )}

              {filteredSystemItems.length > 0 && (
                <div className="mt-3 pt-3 border-t border-sidebar-border/40">
                  <p className="px-3 py-1 ed-eyebrow text-sidebar-muted">Sistema</p>
                  {filteredSystemItems.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onMouseEnter={() => prefetch(item.path)}
                      onMouseLeave={cancelPrefetch}
                      onFocus={() => prefetch(item.path)}
                      className={({ isActive }) => navItemClass(isActive)}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        {item.path === '/admin/aprovacao-ordens-compra' && purchaseApprovalCount > 0 && (
                          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                            {purchaseApprovalCount > 99 ? '99+' : purchaseApprovalCount}
                          </span>
                        )}
                      </div>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* ── Footer ── */}
        <div className={cn(
          "border-t border-sidebar-border shrink-0",
          isCollapsed ? "px-2 py-3 flex flex-col items-center gap-1.5" : "px-3 py-2.5"
        )}>
          {isCollapsed ? (
            <>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button onClick={toggleSidebar} className="flex items-center justify-center h-8 w-8 rounded-lg text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
                    <PanelLeftOpen className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Expandir menu</TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button onClick={signOut} className="flex items-center justify-center h-8 w-8 rounded-lg text-sidebar-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-all duration-150">
                    <LogOut className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Sair</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              {/* User row */}
              <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-sidebar-accent/40">
                <div className="h-7 w-7 rounded-full bg-sidebar-primary/20 ring-1 ring-sidebar-primary/30 flex items-center justify-center shrink-0 text-sidebar-primary font-bold text-xs">
                  {currentProfile?.full_name
                    ? currentProfile.full_name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                    : '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-sidebar-foreground/90 truncate leading-tight">
                    {currentProfile?.full_name || 'Usuário'}
                  </p>
                  <p className="text-xs text-sidebar-muted truncate leading-tight">
                    {currentRoles.length > 0
                      ? ROLES.find(r => r.key === currentRoles[0].role)?.label || currentRoles[0].role
                      : (import.meta.env.VITE_APP_VERSION?.split('-')[0] || 'ERP Industrial')}
                  </p>
                </div>
              </div>
              {/* Action row */}
              <div className="flex items-center gap-1">
                <button
                  onClick={signOut}
                  className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-medium text-sidebar-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-all duration-150"
                >
                  <LogOut className="h-3.5 w-3.5 shrink-0" />
                  <span>Sair</span>
                </button>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button onClick={toggleSidebar} className="flex items-center justify-center h-7 w-7 rounded-lg text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors shrink-0">
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
              <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                {purchaseApprovalCount > 99 ? '99+' : purchaseApprovalCount}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

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

          {/* Mobile sidebar */}
          <aside
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
            aria-hidden={!mobileOpen}
            className={cn(
            'fixed inset-y-0 left-0 z-50 w-[260px] flex flex-col transform transition-transform duration-200 ease-out md:hidden',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
            printMode && 'print:hidden'
          )}
            style={{ boxShadow: mobileOpen ? '4px 0 30px -4px rgba(0,0,0,0.5)' : 'none' }}
          >
            {sidebarContent(true)}
          </aside>

          {/* Desktop sidebar — dimensões do handoff: 232px expandida / 68px colapsada */}
          <aside className={cn(
            'hidden md:flex shrink-0 border-r border-sidebar-border flex-col sticky top-0 h-screen transition-all duration-200 ease-in-out overflow-hidden',
            sidebarCollapsed ? 'w-[68px]' : 'w-[232px]',
            printMode && 'print:hidden'
          )}>
            {sidebarContent(false)}
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
                <div className="w-full h-11 flex items-center px-4 md:px-6 lg:px-8 xl:px-10 gap-3">
                  <PageHeader compact />
                </div>
              </div>
            )}

            <main id="conteudo-principal" tabIndex={-1} className={cn(
              // Layout fluido: usa 100% da largura disponível, sem cap em 1600px.
              // Antes em telas grandes (1080p+/4K/ultrawide) o sistema ficava com
              // barras vazias gigantes nas laterais — pedido user 19/05/2026
              // "sempre se adequar à resolução de quem está acessando".
              // Padding cresce com a tela (mobile 4 → md 6 → lg 8 → xl 10 → 2xl 12).
              'flex-1 w-full px-4 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6 overflow-auto',
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
          </div>
        </div>
      </TooltipProvider>
    </AppLayoutContext.Provider>
  );
}

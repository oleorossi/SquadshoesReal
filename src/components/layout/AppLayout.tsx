import React, { useState, createContext, useContext } from 'react';
import { SignOut as LogOut, List as Menu, X, CaretDown as ChevronDown, SidebarSimple as PanelLeftClose, SidebarSimple as PanelLeftOpen, Gear as Settings, ArrowLeft, Plus, ShoppingCart, Package, Star, House as Home } from '@phosphor-icons/react';
import { menuGroups, systemItems, topItem } from '@/data/navigation';
import logoImg from '@/assets/logo-squad-shoes.jpg';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
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
import PageHeader from './PageHeader';
import { TabBar } from './TabBar';
import { BottomNav } from './BottomNav';
import { usePrefetchRoute } from '@/hooks/usePrefetchRoute';
import { NavigationAuditWatcher } from './NavigationAuditWatcher';
import { DiagnosticsFab } from '@/components/DiagnosticsFab';

const QuickActionsFAB = () => {
  const navigate = useNavigate();
  return (
    <div className="fixed bottom-20 right-5 md:bottom-7 md:right-7 z-50">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            className="h-13 w-13 rounded-full shadow-elevated bg-primary hover:bg-primary/90 text-primary-foreground transition-all duration-200 hover:scale-105 hover:shadow-[0_8px_24px_-4px_hsl(var(--primary)/0.5)]"
          >
            <Plus className="h-6 w-6" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-58 mb-3 shadow-elevated rounded-xl border-border/60">
          <DropdownMenuItem onClick={() => navigate('/sales/new')} className="gap-3 cursor-pointer py-3 text-[13px]">
            <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <ShoppingCart className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="font-medium">Pedido de Venda</p>
              <p className="text-[10px] text-muted-foreground">Criar novo PV</p>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/orders')} className="gap-3 cursor-pointer py-3 text-[13px]">
            <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Plus className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="font-medium">Ordem de Produção</p>
              <p className="text-[10px] text-muted-foreground">Criar nova OP</p>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/estoque')} className="gap-3 cursor-pointer py-3 text-[13px]">
            <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Package className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="font-medium">Entrada de Estoque</p>
              <p className="text-[10px] text-muted-foreground">Registrar entrada</p>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const AppLayoutContext = createContext<boolean>(false);

export default function AppLayout({ children, printMode = false }: { children: React.ReactNode; printMode?: boolean }) {
  const { signOut } = useAuth();
  const { isAdmin, canAccessRoute } = useAccessControl();
  const { data: currentProfile } = useCurrentProfile();
  const { data: currentRoles = [] } = useCurrentUserRoles();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('nav-collapsed-groups');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const isInsideLayout = useContext(AppLayoutContext);
  const navigate = useNavigate();
  const location = useLocation();

  const [favorites, setFavorites] = useState<{ name: string; path: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('menu-favorites') || '[]'); } catch { return []; }
  });

  const filteredFavorites = React.useMemo(
    () => favorites.filter(item => canAccessRoute(item.path)),
    [favorites, canAccessRoute]
  );

  const toggleFavorite = (e: React.MouseEvent, name: string, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setFavorites(prev => {
      const isFavorite = prev.some(f => f.path === path);
      const next = isFavorite ? prev.filter(f => f.path !== path) : [...prev, { name, path }];
      localStorage.setItem('menu-favorites', JSON.stringify(next));
      return next;
    });
  };

  const filteredMenuGroups = React.useMemo(() =>
    menuGroups
      .map(group => ({ ...group, items: group.items.filter(item => canAccessRoute(item.path)) }))
      .filter(group => group.items.length > 0),
    [canAccessRoute]
  );

  const filteredSystemItems = isAdmin ? systemItems : [];
  const { prefetch, cancel: cancelPrefetch } = usePrefetchRoute();
  const isDashboard = location.pathname === '/' || location.pathname === '/dashboard';

  if (isInsideLayout) return <>{children}</>;

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      try { localStorage.setItem('nav-collapsed-groups', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // Precise match: exact path OR path + '/' prefix to avoid false positives
  // e.g. /estoque matches /estoque and /estoque/historico but NOT /estoque-ajuste
  const isGroupActive = (group: typeof menuGroups[0]) =>
    group.items.some(item =>
      location.pathname === item.path ||
      location.pathname.startsWith(item.path + '/')
    );

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar-collapsed', String(next)); } catch {}
      return next;
    });
  };

  // ── Nav item active class ────────────────────────────────
  const navItemClass = (isActive: boolean) => cn(
    "group flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 relative",
    isActive
      ? "bg-sidebar-primary/15 text-sidebar-primary font-semibold border-l-[3px] border-sidebar-primary"
      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
  );

  const collapsedItemClass = (isActive: boolean) => cn(
    "flex items-center justify-center h-9 w-9 rounded-lg mx-auto mb-0.5 transition-all duration-100",
    isActive
      ? "bg-sidebar-accent text-sidebar-primary shadow-sm ring-1 ring-sidebar-primary/20"
      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
  );

  // ── Sidebar content ──────────────────────────────────────
  const sidebarContent = (mobile: boolean) => {
    const isCollapsed = !mobile && sidebarCollapsed;

    return (
      <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground overflow-hidden glass-sidebar">

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
               <NotificationBell key="desktop-notif" />
            </>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg overflow-hidden ring-1 ring-sidebar-border shadow-sm shrink-0 bg-card">
                  <img src={logoImg} alt="Squad Shoes" className="h-full w-full object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-extrabold text-sidebar-foreground leading-tight tracking-tight">Squad Shoes</p>
                  <p className="text-[9px] text-sidebar-muted leading-tight mt-0.5 font-semibold tracking-[0.15em] uppercase">Gestão Industrial</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <ModeToggle className="h-7 w-7 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent" />
               <NotificationBell key="sidebar-mobile-notif" />
                  {mobile && (
                    <Button variant="ghost" size="icon" className="shrink-0 md:hidden h-7 w-7 text-sidebar-muted" onClick={() => setMobileOpen(false)}>
                      <X className="h-4 w-4" />
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

          {/* Dashboard — item fixo no topo, sem grupo */}
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
                  {topItem.name}
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
                  <span className="truncate">{topItem.name}</span>
                </div>
              </NavLink>
            </div>
          )}

          {/* Favoritos */}
          {!isCollapsed && filteredFavorites.length > 0 && (
            <div className="px-2 pb-2">
              <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sidebar-muted">
                <Star className="h-3 w-3 fill-primary text-primary" />
                <span>Favoritos</span>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {filteredFavorites.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className="group flex items-center justify-between px-3 py-1.5 rounded-lg text-[13px] font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all duration-100"
                  >
                    <span className="truncate">{item.name}</span>
                    <button onClick={(e) => toggleFavorite(e, item.name, item.path)} className="opacity-0 group-hover:opacity-100 p-1 hover:text-primary transition-opacity">
                      <Star className="h-3 w-3 fill-primary text-primary" />
                    </button>
                  </NavLink>
                ))}
              </div>
            </div>
          )}

          {/* Menu groups */}
          {isCollapsed ? (
            <div className="px-2 space-y-3">
              {/* Favoritos colapsados */}
              {filteredFavorites.length > 0 && (
                <div className="pb-3 border-b border-sidebar-border/40">
                  {filteredFavorites.map((item) => {
                    let Icon = Star;
                    for (const group of filteredMenuGroups) {
                      const found = group.items.find(i => i.path === item.path);
                      if (found) { Icon = found.icon; break; }
                    }
                    return (
                      <Tooltip key={item.path} delayDuration={0}>
                        <TooltipTrigger asChild>
                          <NavLink to={item.path} className={({ isActive }) => cn(collapsedItemClass(isActive), "relative")}>
                            <Icon className="h-4 w-4 shrink-0" />
                            <div className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
                          </NavLink>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8} className="text-xs font-medium flex items-center gap-2">
                          <span>{item.name}</span>
                          <Star className="h-3 w-3 fill-primary text-primary" />
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              )}
              {/* Grupos colapsados */}
              {filteredMenuGroups.map((group, gi) => (
                <div key={group.label} className={cn(gi > 0 && "pt-2 border-t border-sidebar-border/40")}>
                  {group.items.map((item) => {
                    const isFavorite = favorites.some(f => f.path === item.path);
                    return (
                      <Tooltip key={item.name} delayDuration={0}>
                        <TooltipTrigger asChild>
                          <NavLink to={item.path} className={({ isActive }) => collapsedItemClass(isActive)}>
                            <item.icon className="h-4 w-4 shrink-0" />
                          </NavLink>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8} className="text-xs font-medium flex items-center gap-2">
                          <span>{item.name}</span>
                          {isFavorite && <Star className="h-3 w-3 fill-primary text-primary" />}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
              {/* Sistema colapsado (admin) */}
              {filteredSystemItems.length > 0 && (
                <div className="pt-2 border-t border-sidebar-border/40">
                  {filteredSystemItems.map((item) => (
                    <Tooltip key={item.to} delayDuration={0}>
                      <TooltipTrigger asChild>
                        <NavLink to={item.to} className={({ isActive }) => collapsedItemClass(isActive)}>
                          <item.icon className="h-4 w-4 shrink-0" />
                        </NavLink>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8} className="text-xs font-medium">{item.label}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="px-2 space-y-0.5">
              {filteredMenuGroups.map((group) => {
                const active = isGroupActive(group);
                const isGroupCollapsed = collapsedGroups.has(group.label) && !active;
                return (
                  <div key={group.label}>
                    <button
                      onClick={() => toggleGroup(group.label)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors mt-2",
                        active ? "text-sidebar-primary" : "text-sidebar-muted hover:text-sidebar-foreground"
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <group.icon className="h-3 w-3 shrink-0 opacity-70" />
                        <span>{group.label}</span>
                      </div>
                      <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", isGroupCollapsed && "-rotate-90")} />
                    </button>
                    {!isGroupCollapsed && (
                      <div className="mt-0.5 space-y-0.5">
                        {group.items.map((item) => {
                          const isFavorite = favorites.some(f => f.path === item.path);
                          const isSubItem = !!(item as any).parent;
                          return (
                            <NavLink
                              key={item.name}
                              to={item.path}
                              onClick={mobile ? () => setMobileOpen(false) : undefined}
                              onMouseEnter={() => prefetch(item.path)}
                              onMouseLeave={cancelPrefetch}
                              onFocus={() => prefetch(item.path)}
                              className={({ isActive }) => cn(navItemClass(isActive), isSubItem && "ml-5 border-l border-sidebar-border/40 pl-3")}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <item.icon className={cn("shrink-0", isSubItem ? "h-3.5 w-3.5" : "h-4 w-4")} />
                                <span className={cn("truncate", isSubItem && "text-[12px]")}>{item.name}</span>
                              </div>
                              <button
                                onClick={(e) => toggleFavorite(e, item.name, item.path)}
                                className={cn(
                                  "p-1 transition-all duration-200",
                                  isFavorite ? "opacity-100 text-primary" : "opacity-0 group-hover:opacity-100 text-sidebar-muted hover:text-primary"
                                )}
                              >
                                <Star className={cn("h-3 w-3", isFavorite && "fill-current")} />
                              </button>
                            </NavLink>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Seção Sistema — visível para admins no final da sidebar */}
              {filteredSystemItems.length > 0 && (
                <div className="mt-3 pt-3 border-t border-sidebar-border/40">
                  <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-sidebar-muted">Sistema</p>
                  {filteredSystemItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => navItemClass(isActive)}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
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
                <div className="h-7 w-7 rounded-full bg-sidebar-primary/20 ring-1 ring-sidebar-primary/30 flex items-center justify-center shrink-0 text-sidebar-primary font-bold text-[11px]">
                  {currentProfile?.full_name
                    ? currentProfile.full_name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                    : '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-sidebar-foreground/90 truncate leading-tight">
                    {currentProfile?.full_name || 'Usuário'}
                  </p>
                  <p className="text-[9px] text-sidebar-muted truncate leading-tight">
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
                  className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-sidebar-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-all duration-150"
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
        <Button variant="ghost" size="icon" className="h-9 w-9 text-foreground/60 hover:text-foreground">
          <Settings className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {filteredSystemItems.map((item) => (
          <DropdownMenuItem key={item.to} onClick={() => navigate(item.to)} className="gap-2 cursor-pointer">
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return (
    <AppLayoutContext.Provider value={true}>
      <TooltipProvider delayDuration={300}>
        <NavigationAuditWatcher />
        <div className={cn('min-h-screen flex bg-background overflow-x-hidden', printMode && 'print:bg-background')}>
          {mobileOpen && (
            <div
              className={cn('fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden transition-opacity', printMode && 'print:hidden')}
              onClick={() => setMobileOpen(false)}
            />
          )}

          {/* Mobile sidebar */}
          <aside className={cn(
            'fixed inset-y-0 left-0 z-50 w-[260px] flex flex-col transform transition-transform duration-200 ease-out md:hidden',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
            printMode && 'print:hidden'
          )}
            style={{ boxShadow: mobileOpen ? '4px 0 30px -4px rgba(0,0,0,0.5)' : 'none' }}
          >
            {sidebarContent(true)}
          </aside>

          {/* Desktop sidebar */}
          <aside className={cn(
            'hidden md:flex shrink-0 border-r border-sidebar-border flex-col sticky top-0 h-screen transition-all duration-200 ease-in-out overflow-hidden',
            sidebarCollapsed ? 'w-16' : 'w-[248px]',
            printMode && 'print:hidden'
          )}>
            {sidebarContent(false)}
          </aside>

          <div className="flex-1 min-w-0 flex flex-col min-h-screen relative overflow-x-hidden">
            {/* Mobile top bar */}
            <header className={cn(
              'md:hidden sticky top-0 z-30 border-b border-border/60 h-14 flex items-center px-4 gap-2 bg-background/95 backdrop-blur-sm',
              printMode && 'print:hidden'
            )}>
              {!isDashboard ? (
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate(-1)}>
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              ) : (
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setMobileOpen(true)}>
                  <Menu className="h-5 w-5" />
                </Button>
              )}
              <div className="h-8 w-8 rounded-lg overflow-hidden ring-1 ring-border bg-card shrink-0 shadow-sm">
                <img src={logoImg} alt="Squad Shoes" className="h-full w-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-extrabold text-foreground leading-tight tracking-tight truncate">Squad Shoes</p>
                <p className="text-[9px] text-muted-foreground leading-tight mt-0.5 font-semibold tracking-[0.05em] uppercase truncate">
                  {isDashboard ? "Gestão Industrial" : "Sistema"}
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
                <div className="w-full max-w-[1600px] mx-auto h-11 flex items-center px-6 gap-3">
                  <PageHeader compact />
                </div>
              </div>
            )}

            {!printMode && (
              <div className="hidden md:block sticky top-11 z-10 bg-background print:hidden">
                <TabBar />
              </div>
            )}

            <main className={cn(
              'flex-1 w-full max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 pb-20 md:pb-6 overflow-auto',
              printMode && 'print:px-0 print:py-0 print:overflow-visible'
            )}>
              <div className="md:hidden">
                <PageHeader />
              </div>
              <div className="animate-in fade-in duration-200">
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

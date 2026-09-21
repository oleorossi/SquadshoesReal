import { useState, useEffect, useMemo, useRef } from 'react';
import { House as Home, Factory, Package, ShoppingCart, DotsThree as MoreHorizontal, X, Star, Lightning as Zap } from '@phosphor-icons/react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  HUBS,
  orderGroupsForRoles,
  secondaryRoutes,
  hubHasAccessibleChild,
  getAllMenuItems,
  systemShortcuts,
} from '@/data/navigation';
import { useAccessControl } from '@/hooks/useAccessControl';
import { useMenuFavorites } from '@/hooks/useMenuFavorites';
import { useCurrentUserRoles } from '@/hooks/useUserManagement';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';

const PRIMARY_ITEMS = [
  { icon: Home,         label: 'Painel',   path: '/dashboard' },
  { icon: ShoppingCart, label: 'Vendas',   path: '/sales' },
  // Primários fixos nesta onda — path de trabalho, não o hub.
  { icon: Factory,      label: 'Produção', path: '/producao/planejamento' },
  { icon: Package,      label: 'Estoque',  path: '/estoque' },
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [maisQuery, setMaisQuery] = useState('');
  const { canAccessRoute } = useAccessControl();
  const primaryItems = useMemo(() => PRIMARY_ITEMS.filter(i => canAccessRoute(i.path)), [canAccessRoute]);
  const { data: currentRoles = [] } = useCurrentUserRoles();
  const roleNames = useMemo(() => currentRoles.map(role => role.role), [currentRoles]);

  const visibleHubs = useMemo(
    () => orderGroupsForRoles(
      HUBS.filter((hub) => hubHasAccessibleChild(hub, canAccessRoute)),
      roleNames,
    ),
    [canAccessRoute, roleNames],
  );

  const secondaryItems = useMemo(
    () => secondaryRoutes.filter(item => canAccessRoute(item.path)),
    [canAccessRoute],
  );

  const shortcutItems = useMemo(
    () => systemShortcuts.filter(item => canAccessRoute(item.path)),
    [canAccessRoute],
  );

  const { favorites } = useMenuFavorites();
  const favItems = useMemo(() => favorites.filter(f => canAccessRoute(f.path)), [favorites, canAccessRoute]);
  const iconForPath = (path: string) =>
    getAllMenuItems().find(i => i.path === path)?.icon ?? Star;

  const filteredFavItems = useMemo(() => {
    if (!maisQuery.trim()) return favItems;
    return favItems.filter((item) => searchMatchesAllTerms(maisQuery, item.name));
  }, [favItems, maisQuery]);

  const filteredShortcuts = useMemo(() => {
    if (!maisQuery.trim()) return shortcutItems;
    return shortcutItems.filter((item) => searchMatchesAllTerms(maisQuery, item.label));
  }, [shortcutItems, maisQuery]);

  const filteredHubs = useMemo(() => {
    if (!maisQuery.trim()) return visibleHubs;
    return visibleHubs.filter((hub) => searchMatchesAllTerms(maisQuery, hub.label));
  }, [visibleHubs, maisQuery]);

  const filteredSecondary = useMemo(() => {
    if (!maisQuery.trim()) return secondaryItems;
    return secondaryItems.filter(
      (item) => searchMatchesAllTerms(maisQuery, item.label, item.group),
    );
  }, [secondaryItems, maisQuery]);

  const hasMaisResults =
    filteredFavItems.length > 0
    || filteredShortcuts.length > 0
    || filteredHubs.length > 0
    || filteredSecondary.length > 0;
  const maisResultCount =
    filteredFavItems.length
    + filteredShortcuts.length
    + filteredHubs.length
    + filteredSecondary.length;
  const maisTotalCount =
    favItems.length
    + shortcutItems.length
    + visibleHubs.length
    + secondaryItems.length;

  useEffect(() => {
    setMoreOpen(false);
    setMaisQuery('');
  }, [location.pathname]);

  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!moreOpen) {
      setMaisQuery('');
      return;
    }

    gatilhoRef.current = document.activeElement as HTMLElement | null;
    searchInputRef.current?.focus();

    const focaveis = () => Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((el) => el.offsetParent !== null);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMoreOpen(false); return; }
      if (e.key !== 'Tab') return;
      const els = focaveis();
      if (els.length === 0) return;
      const primeiro = els[0];
      const ultimo = els[els.length - 1];
      const atual = document.activeElement;
      if (e.shiftKey && (atual === primeiro || !sheetRef.current?.contains(atual))) {
        e.preventDefault(); ultimo.focus();
      } else if (!e.shiftKey && atual === ultimo) {
        e.preventDefault(); primeiro.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      gatilhoRef.current?.focus?.();
    };
  }, [moreOpen]);

  const isActive = (path: string) =>
    location.pathname === path ||
    (path !== '/dashboard' && location.pathname.startsWith(path + '/'));

  const tileClass = (active: boolean, favorited = false) => cn(
    'flex min-h-11 flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-xl text-xs font-medium transition-all',
    active
      ? favorited
        ? 'bg-primary/15 text-primary'
        : 'bg-primary/10 text-primary'
      : favorited
        ? 'bg-primary/[0.06] text-foreground hover:bg-primary/10'
        : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
  );

  return (
    <>
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {moreOpen && (
        <div
          id="bottom-nav-mais"
          role="dialog"
          aria-modal="true"
          aria-label="Navegação"
          ref={sheetRef}
          className="md:hidden fixed bottom-16 inset-x-0 z-50 bg-background/98 backdrop-blur-md border-t border-border rounded-t-2xl shadow-elevated safe-bot"
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <p className="text-sm font-semibold text-foreground">Navegação</p>
            <button
              ref={closeBtnRef}
              onClick={() => setMoreOpen(false)}
              aria-label="Fechar menu"
              className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="px-4 pb-2">
            <SearchInput
              ref={searchInputRef}
              value={maisQuery}
              onChange={setMaisQuery}
              placeholder="Buscar tela…"
              aria-label="Buscar tela"
              autoFocus
              hideHint
              disableSlashFocus
              enterKeyHint="search"
              resultCount={maisResultCount}
              totalCount={maisTotalCount}
              className="w-full"
              inputClassName="rounded-xl bg-muted/40"
            />
          </div>
          <div className="px-4 pb-4 space-y-4 max-h-[60vh] overflow-y-auto">
            {!hasMaisResults && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma tela encontrada para “{maisQuery.trim()}”.
              </p>
            )}
            {filteredFavItems.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary mb-1.5">
                  <Star className="h-3 w-3 fill-current" />
                  Favoritos
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {filteredFavItems.map((item) => {
                    const Icon = iconForPath(item.path);
                    const active = isActive(item.path);
                    return (
                      <button
                        key={item.path}
                        onClick={() => { navigate(item.path); setMoreOpen(false); }}
                        className={tileClass(active, true)}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="leading-none text-center">{item.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {filteredShortcuts.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  <Zap className="h-3 w-3" />
                  Atalhos
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {filteredShortcuts.map((item) => {
                    const active = isActive(item.path);
                    return (
                      <button
                        key={item.path}
                        onClick={() => { navigate(item.path); setMoreOpen(false); }}
                        className={tileClass(active)}
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="leading-none text-center">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {filteredHubs.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Áreas
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {filteredHubs.map((hub) => {
                    const active = isActive(hub.path)
                      || hub.children.some((c) => isActive(c.path.split('?')[0]));
                    return (
                      <button
                        key={hub.path}
                        onClick={() => { navigate(hub.path); setMoreOpen(false); }}
                        className={tileClass(active)}
                      >
                        <hub.icon className="h-4 w-4" />
                        <span className="leading-none text-center">{hub.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {filteredSecondary.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  <MoreHorizontal className="h-3 w-3" />
                  Ferramentas
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {filteredSecondary.map((item) => {
                    const active = isActive(item.path);
                    return (
                      <button
                        key={item.path}
                        onClick={() => { navigate(item.path); setMoreOpen(false); }}
                        className={tileClass(active)}
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="leading-none text-center">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-md border-t border-border z-40 safe-bot">
        <div className="flex justify-around items-stretch h-16 px-1">
          {primaryItems.map((item) => {
            const active = isActive(item.path);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className="flex flex-col items-center justify-center gap-1 flex-1 h-full min-h-11 transition-colors relative pt-2"
              >
                <span className={cn(
                  "absolute top-0 left-1/2 -translate-x-1/2 h-[3px] rounded-b-full bg-primary transition-all duration-300 ease-out",
                  active ? "w-8 opacity-100" : "w-0 opacity-0"
                )} />
                <item.icon className={cn("h-5 w-5 transition-all duration-200", active ? "text-primary scale-110" : "text-muted-foreground")} />
                <span className={cn("text-xs font-medium transition-colors leading-none", active ? "text-primary font-semibold" : "text-muted-foreground")}>
                  {item.label}
                </span>
              </NavLink>
            );
          })}

          <button
            onClick={() => setMoreOpen(v => !v)}
            aria-expanded={moreOpen}
            aria-controls="bottom-nav-mais"
            className="flex flex-col items-center justify-center gap-1 flex-1 h-full min-h-11 transition-colors relative pt-2"
          >
            <span className={cn(
              "absolute top-0 left-1/2 -translate-x-1/2 h-[3px] rounded-b-full bg-primary transition-all duration-300 ease-out",
              moreOpen ? "w-8 opacity-100" : "w-0 opacity-0"
            )} />
            <MoreHorizontal className={cn("h-5 w-5 transition-all duration-200", moreOpen ? "text-primary scale-110" : "text-muted-foreground")} />
            <span className={cn("text-xs font-medium transition-colors leading-none", moreOpen ? "text-primary font-semibold" : "text-muted-foreground")}>
              Mais
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}

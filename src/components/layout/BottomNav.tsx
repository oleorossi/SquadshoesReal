import { useState, useEffect, useMemo, useRef } from 'react';
import { House as Home, Factory, Package, ShoppingCart, DotsThree as MoreHorizontal, X, Star } from '@phosphor-icons/react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { menuGroups } from '@/data/navigation';
import { useAccessControl } from '@/hooks/useAccessControl';
import { useMenuFavorites } from '@/hooks/useMenuFavorites';

const PRIMARY_ITEMS = [
  { icon: Home,         label: 'Painel',   path: '/dashboard' },
  { icon: ShoppingCart, label: 'Vendas',   path: '/sales' },
  // O alvo precisa ser item de menu real: a allow-list granular resolve o
  // dono por esse catálogo, e /pcp é só um redirect legado sem dono próprio.
  { icon: Factory,      label: 'Produção', path: '/producao/planejamento' },
  { icon: Package,      label: 'Estoque',  path: '/estoque' },
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  // Mesma regra de acesso da sidebar: só mostra o que o usuário pode abrir
  // (permissão por menu). Sem isso o nav mobile expunha itens não liberados.
  const { canAccessRoute } = useAccessControl();
  const primaryItems = useMemo(() => PRIMARY_ITEMS.filter(i => canAccessRoute(i.path)), [canAccessRoute]);
  const visibleGroups = useMemo(
    () => menuGroups
      .map(g => ({ ...g, items: g.items.filter(i => canAccessRoute(i.path)) }))
      .filter(g => g.items.length > 0),
    [canAccessRoute],
  );

  // Favoritos do usuário (mesmos da sidebar, via useMenuFavorites) — aparecem
  // no topo do "Mais" pra ficarem acessíveis também no celular.
  const { favorites } = useMenuFavorites();
  const favItems = useMemo(() => favorites.filter(f => canAccessRoute(f.path)), [favorites, canAccessRoute]);
  const iconForPath = (path: string) => {
    for (const group of menuGroups) {
      const found = group.items.find(i => i.path === path);
      if (found) return found.icon;
    }
    return Star;
  };

  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  // O sheet "Mais" é um div artesanal (não usa o primitive Dialog): prender o
  // foco, fechar no Escape e DEVOLVER o foco ao gatilho são responsabilidade
  // nossa. Antes só o foco inicial e o Escape estavam feitos (achado F17):
  //   • o Tab escapava do sheet e ia navegar o conteúdo ATRÁS do modal;
  //   • ao fechar, o foco caía no <body> — quem usa teclado ou leitor de tela
  //     perdia o lugar e tinha que percorrer a página inteira de novo.
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;

    // Guarda quem abriu, pra devolver o foco na hora de fechar.
    gatilhoRef.current = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const focaveis = () => Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      // Ciclo fechado: do último volta pro primeiro e vice-versa.
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

  return (
    <>
      {/* Overlay */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* "Mais" bottom sheet */}
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
              className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="px-4 pb-4 space-y-4 max-h-[70vh] overflow-y-auto">
            {favItems.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary mb-1.5">
                  <Star className="h-3 w-3 fill-current" />
                  Favoritos
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {favItems.map((item) => {
                    const Icon = iconForPath(item.path);
                    const active = isActive(item.path);
                    return (
                      <button
                        key={item.path}
                        onClick={() => { navigate(item.path); setMoreOpen(false); }}
                        className={cn(
                          "flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-xs font-medium transition-all",
                          active
                            ? "bg-primary/15 text-primary"
                            : "bg-primary/[0.06] text-foreground hover:bg-primary/10"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="leading-none text-center">{item.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {visibleGroups.map((group) => (
              <div key={group.label}>
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  <group.icon className="h-3 w-3" />
                  {group.label}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {group.items.map((item) => {
                    const active = isActive(item.path);
                    return (
                      <button
                        key={item.path}
                        onClick={() => { navigate(item.path); setMoreOpen(false); }}
                        className={cn(
                          "flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-xs font-medium transition-all",
                          active
                            ? "bg-primary/10 text-primary"
                            : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="leading-none text-center">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-md border-t border-border z-40 safe-bot">
        <div className="flex justify-around items-stretch h-16 px-1">
          {primaryItems.map((item) => {
            const active = isActive(item.path);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors relative pt-2"
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

          {/* Mais */}
          <button
            onClick={() => setMoreOpen(v => !v)}
            aria-expanded={moreOpen}
            aria-controls="bottom-nav-mais"
            className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors relative pt-2"
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

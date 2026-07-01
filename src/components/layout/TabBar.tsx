/**
 * Barra de abas no topo do AppLayout — as páginas que o usuário abre ficam aqui
 * (estilo navegador). Recursos de navegação:
 *   - clicar troca de aba; X (ou clique do meio) fecha
 *   - arrastar-e-soltar pra reordenar
 *   - menu de contexto (botão direito): fechar / outras / à direita / todas
 *   - aba ativa rola pra dentro da vista automaticamente
 *   - "+" abre a busca global (Ctrl/⌘K) pra abrir outra página
 * Estética: ícone por página + aba ativa com acento superior (primary) ligada
 * ao conteúdo; inativas discretas. Tudo em design tokens.
 */
import { useEffect, useRef, useState, type CSSProperties, type ComponentType } from 'react';
import { useTabs } from '@/contexts/TabsContext';
import { cn } from '@/lib/utils';
import { X, Plus, File as FileIcon, Broom } from '@phosphor-icons/react';
import { menuGroups, systemItems, topItem, secondaryRoutes } from '@/data/navigation';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';

type IconType = ComponentType<{ className?: string }>;

// Mapa path → ícone, da navegação canônica (mesma fonte do menu/títulos).
const PATH_ICON_MAP: Map<string, IconType> = (() => {
  const m = new Map<string, IconType>();
  m.set(topItem.path, topItem.icon as IconType);
  for (const g of menuGroups) for (const it of g.items) m.set(it.path, it.icon as IconType);
  for (const it of systemItems) m.set(it.to, it.icon as IconType);
  for (const r of secondaryRoutes) m.set(r.path, r.icon as IconType);
  return m;
})();

/** Ícone da página: match exato; senão, prefixo mais longo (ex.: /estoque/historico → ícone de Estoque). */
function iconForPath(path: string): IconType {
  const exact = PATH_ICON_MAP.get(path);
  if (exact) return exact;
  let best = '';
  let bestIcon: IconType | null = null;
  for (const [p, ic] of PATH_ICON_MAP.entries()) {
    if ((path === p || path.startsWith(p + '/')) && p.length > best.length) {
      best = p;
      bestIcon = ic;
    }
  }
  return bestIcon ?? FileIcon;
}

export function TabBar() {
  const { tabs, activeId, closeTab, setActiveTab, reorderTabs, closeOthers, closeToRight, closeAll } = useTabs();

  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);

  // Rola a aba ativa pra dentro da vista quando muda (ou quando a lista cresce).
  useEffect(() => {
    if (!activeId) return;
    // `?.()` no método também — scrollIntoView não existe em alguns ambientes (jsdom/SSR).
    tabRefs.current[activeId]?.scrollIntoView?.({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [activeId, tabs.length]);

  if (tabs.length === 0) return null;

  // antes/depois conforme o cursor cair na metade esquerda ou direita do alvo
  const dropPos = (e: React.DragEvent): 'before' | 'after' => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX - r.left > r.width / 2 ? 'after' : 'before';
  };
  const dropStyle = (id: string): CSSProperties | undefined =>
    dropTarget?.id === id
      ? { boxShadow: dropTarget.pos === 'before' ? 'inset 2px 0 0 0 hsl(var(--primary))' : 'inset -2px 0 0 0 hsl(var(--primary))' }
      : undefined;

  // "+" → abre a busca global (mesmo handler do Ctrl/⌘K) pra escolher a página.
  const openSearch = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }));
  };

  return (
    <div
      role="tablist"
      aria-label="Páginas abertas"
      // Padrão ARIA de tabs: setas navegam entre abas (roving tabindex sozinho
      // deixava as abas inativas inalcançáveis por teclado).
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
        const idx = tabs.findIndex(t => t.id === activeId);
        if (idx === -1) return;
        e.preventDefault();
        const nextIdx =
          e.key === 'Home' ? 0 :
          e.key === 'End' ? tabs.length - 1 :
          e.key === 'ArrowLeft' ? (idx - 1 + tabs.length) % tabs.length :
          (idx + 1) % tabs.length;
        const next = tabs[nextIdx];
        if (next) { setActiveTab(next.id); tabRefs.current[next.id]?.focus(); }
      }}
      className="flex items-end gap-0.5 px-2 pt-1 overflow-x-auto scrollbar-thin border-b border-border bg-muted/40"
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeId;
        const isLast = idx === tabs.length - 1;
        const Icon = iconForPath(tab.path);
        return (
          <ContextMenu key={tab.id}>
            <ContextMenuTrigger asChild>
              <div
                ref={(el) => { tabRefs.current[tab.id] = el; }}
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                draggable
                onDragStart={(e) => { setDragId(tab.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', tab.id); } catch { /* firefox */ } }}
                onDragOver={(e) => { if (!dragId || dragId === tab.id) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget({ id: tab.id, pos: dropPos(e) }); }}
                onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== tab.id) reorderTabs(dragId, tab.id, dropTarget?.id === tab.id ? dropTarget.pos : dropPos(e)); setDragId(null); setDropTarget(null); }}
                onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                onClick={() => setActiveTab(tab.id)}
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); /* evita scroll do meio */ }}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab(tab.id); } }}
                title={tab.path}
                style={dropStyle(tab.id)}
                className={cn(
                  'group relative flex items-center gap-1.5 h-8 pl-2.5 pr-1 text-[13px] rounded-t-md max-w-[210px] min-w-0 shrink-0 cursor-pointer select-none transition-colors',
                  isActive
                    ? 'bg-background text-foreground font-medium border-t-2 border-t-primary border-x border-x-border'
                    : 'bg-muted/20 text-muted-foreground border-t-2 border-t-transparent hover:bg-muted/50 hover:text-foreground',
                  dragId === tab.id && 'opacity-50',
                )}
              >
                <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-primary' : 'opacity-70')} />
                <span className="truncate">{tab.title}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  aria-label={`Fechar ${tab.title}`}
                  className={cn(
                    'flex items-center justify-center h-4 w-4 rounded p-0 shrink-0 transition-all hover:bg-foreground/10',
                    isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:!opacity-100',
                  )}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-48">
              <ContextMenuItem onSelect={() => closeTab(tab.id)}>Fechar aba</ContextMenuItem>
              <ContextMenuItem onSelect={() => closeOthers(tab.id)} disabled={tabs.length <= 1}>
                Fechar outras
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => closeToRight(tab.id)} disabled={isLast}>
                Fechar à direita
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => closeAll()}>Fechar todas</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}

      {/* Abrir nova página (busca global) */}
      <button
        type="button"
        onClick={openSearch}
        aria-label="Abrir página (Ctrl/Command+K)"
        title="Abrir página (Ctrl/⌘K)"
        className="shrink-0 mb-1 ml-0.5 flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {/* Fechar todas — só aparece com 2+ abas. Antes só existia no menu de
          contexto (botão direito), que o usuário comum não descobre. */}
      {tabs.length > 1 && (
        <button
          type="button"
          onClick={() => closeAll()}
          aria-label="Fechar todas as abas"
          title="Fechar todas as abas"
          className="shrink-0 mb-1 ml-auto mr-0.5 flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Broom className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

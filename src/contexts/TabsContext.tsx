/**
 * Tabs in-app — permite múltiplas "telas" abertas simultaneamente, com barra
 * de abas no topo do AppLayout. Cada aba guarda path + título.
 *
 * Comportamento atual (MVP):
 * - Navegar pra rota nova cria/promove aba automaticamente.
 * - Clicar em aba navega pra rota dela.
 * - Botão X remove aba; se era a ativa, navega pra próxima/anterior.
 * - Persiste em localStorage entre sessões.
 *
 * Limitação: cada aba RE-MONTA o componente ao trocar (router unmount/mount).
 * Estado interno se perde ao trocar de aba. Futuro: keep-alive via display
 * none/block + memory routers por aba. Por enquanto, o usuário usa o sistema
 * de tabs como "atalho de bookmarks no topo" — mais rápido que recriar URL
 * cada vez.
 */
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { menuGroups, systemItems, topItem, secondaryRoutes } from '@/data/navigation';

export interface TabEntry {
  id: string;
  path: string;
  title: string;
}

interface TabsCtx {
  tabs: TabEntry[];
  activeId: string | null;
  openTab: (path: string, title?: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  /** Reordena abas (arrastar-e-soltar). Move `fromId` pra antes/depois de `toId`. */
  reorderTabs: (fromId: string, toId: string, pos: 'before' | 'after') => void;
  /** Fecha todas menos a indicada (mantém só ela, ativa). */
  closeOthers: (id: string) => void;
  /** Fecha as abas à direita da indicada. */
  closeToRight: (id: string) => void;
  /** Fecha todas e volta pro Painel. */
  closeAll: () => void;
}

const Context = createContext<TabsCtx | null>(null);
const STORAGE_KEY = 'in-app-tabs-v1';
const MAX_TABS = 6;

// Mapa path → label, construído do único formato de recurso canônico.
function buildPathTitleMap(): Map<string, string> {
  const map = new Map<string, string>();
  map.set(topItem.path, topItem.label);
  for (const g of menuGroups) {
    for (const it of g.items) {
      map.set(it.path, it.label);
    }
  }
  for (const it of systemItems) {
    map.set(it.path, it.label);
  }
  // Rotas secundárias (não estão na sidebar, mas têm título canônico em
  // navigation.ts). Sem isto, abrir /centro-controle, /cronoanalise, etc. caía
  // no fallback feio derivado do path ("Centro controle", minúscula sem "de").
  for (const r of secondaryRoutes) {
    if (!map.has(r.path)) map.set(r.path, r.label);
  }
  // Aliases para rotas extras que aparecem no app mas não no menu principal —
  // evita que o fallback gere títulos em inglês como "Stock" ou
  // "Technical sheets" no topo das tabs.
  const aliases: Record<string, string> = {
    '/stock': 'Estoque',
    '/inventory': 'Estoque',
    '/estoque/historico': 'Histórico de Estoque',
    '/technical-sheets': 'Fichas Técnicas',
    '/fichas-tecnicas': 'Fichas Técnicas',
    '/references': 'Referências',
    '/products': 'Produtos',
    '/component-sheets': 'Fichas de Componentes',
    '/auth': 'Login',
    '/login': 'Login',
    '/index': 'Início',
    '/inicio': 'Início',
  };
  for (const [p, t] of Object.entries(aliases)) {
    if (!map.has(p)) map.set(p, t);
  }
  return map;
}

const PATH_TITLE_MAP = buildPathTitleMap();

function titleForPath(path: string, fallback?: string): string {
  if (PATH_TITLE_MAP.has(path)) return PATH_TITLE_MAP.get(path)!;
  // Match prefix mais longo (ex.: /estoque/historico → Estoque)
  let bestMatch = '';
  let bestTitle = '';
  for (const [p, t] of PATH_TITLE_MAP.entries()) {
    if (path === p || path.startsWith(p + '/')) {
      if (p.length > bestMatch.length) {
        bestMatch = p;
        bestTitle = t;
      }
    }
  }
  if (bestTitle) return bestTitle;
  if (fallback) return fallback;
  // Último fallback: deriva do path
  const last = path.split('/').filter(Boolean).pop() || 'Início';
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
}

function makeId(path: string): string {
  return `tab-${path.replace(/[^a-z0-9]/gi, '_')}-${Math.random().toString(36).slice(2, 6)}`;
}

function loadFromStorage(): { tabs: TabEntry[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tabs: [], activeId: null };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.tabs)) return { tabs: [], activeId: null };
    // Recalcula o título de cada aba a partir do mapa atual — corrige
    // títulos legados ("Stock", "Settings", "Audit logs") gravados em
    // sessões anteriores. Mantém o ID/path para preservar referência.
    const rehydrated: TabEntry[] = parsed.tabs.slice(0, MAX_TABS).map((t: TabEntry) => ({
      id: t.id,
      path: t.path,
      title: titleForPath(t.path, t.title),
    }));
    return {
      tabs: rehydrated,
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
    };
  } catch {
    return { tabs: [], activeId: null };
  }
}

function saveToStorage(tabs: TabEntry[], activeId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }));
  } catch { /* quota / private mode */ }
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [{ tabs, activeId }, setState] = useState<{ tabs: TabEntry[]; activeId: string | null }>(
    () => loadFromStorage(),
  );

  // Persist em qualquer mudança
  useEffect(() => {
    saveToStorage(tabs, activeId);
  }, [tabs, activeId]);

  // Orientação: sincroniza o título da aba do NAVEGADOR com a página ativa, pra
  // o usuário saber onde está mesmo com várias janelas/abas do navegador abertas
  // (antes ficava sempre "Squad Shoes" fixo, sem distinção por tela).
  useEffect(() => {
    const active = tabs.find(t => t.id === activeId);
    document.title = active ? `${active.title} · Squad Shoes` : 'Squad Shoes';
  }, [tabs, activeId]);

  // Auto-criar/promover aba ao navegar
  useEffect(() => {
    const path = location.pathname;
    // Skip rotas de auth / não-listadas
    if (path === '/auth' || path === '/login') return;

    setState(prev => {
      const existing = prev.tabs.find(t => t.path === path);
      if (existing) {
        if (prev.activeId === existing.id) return prev;
        return { ...prev, activeId: existing.id };
      }
      // Cria nova aba
      const newTab: TabEntry = {
        id: makeId(path),
        path,
        title: titleForPath(path),
      };
      let nextTabs = [...prev.tabs, newTab];
      // Se excedeu MAX, remove a mais antiga não ativa
      if (nextTabs.length > MAX_TABS) {
        const idxToRemove = nextTabs.findIndex(t => t.id !== prev.activeId);
        if (idxToRemove >= 0) nextTabs.splice(idxToRemove, 1);
        else nextTabs = nextTabs.slice(-MAX_TABS);
      }
      return { tabs: nextTabs, activeId: newTab.id };
    });
  }, [location.pathname]);

  const openTab = useCallback((path: string, title?: string) => {
    setState(prev => {
      const existing = prev.tabs.find(t => t.path === path);
      if (existing) {
        navigate(path);
        return { ...prev, activeId: existing.id };
      }
      const newTab: TabEntry = {
        id: makeId(path),
        path,
        title: title || titleForPath(path),
      };
      let nextTabs = [...prev.tabs, newTab];
      if (nextTabs.length > MAX_TABS) {
        const idxToRemove = nextTabs.findIndex(t => t.id !== prev.activeId);
        if (idxToRemove >= 0) nextTabs.splice(idxToRemove, 1);
        else nextTabs = nextTabs.slice(-MAX_TABS);
      }
      navigate(path);
      return { tabs: nextTabs, activeId: newTab.id };
    });
  }, [navigate]);

  const closeTab = useCallback((id: string) => {
    setState(prev => {
      const idx = prev.tabs.findIndex(t => t.id === id);
      if (idx < 0) return prev;
      const nextTabs = prev.tabs.filter(t => t.id !== id);
      if (prev.activeId !== id) return { ...prev, tabs: nextTabs };
      // A ativa foi fechada — escolhe próxima/anterior
      const fallback = nextTabs[idx] || nextTabs[idx - 1] || null;
      if (fallback) {
        navigate(fallback.path);
        return { tabs: nextTabs, activeId: fallback.id };
      }
      return { tabs: nextTabs, activeId: null };
    });
  }, [navigate]);

  const setActiveTab = useCallback((id: string) => {
    setState(prev => {
      const tab = prev.tabs.find(t => t.id === id);
      if (!tab) return prev;
      navigate(tab.path);
      return { ...prev, activeId: id };
    });
  }, [navigate]);

  const reorderTabs = useCallback((fromId: string, toId: string, pos: 'before' | 'after') => {
    setState(prev => {
      if (fromId === toId) return prev;
      const from = prev.tabs.findIndex(t => t.id === fromId);
      if (from < 0) return prev;
      const arr = [...prev.tabs];
      const [moved] = arr.splice(from, 1);
      // recalcula o índice do alvo APÓS a remoção (pode ter deslocado)
      const to = arr.findIndex(t => t.id === toId);
      if (to < 0) return prev;
      arr.splice(pos === 'after' ? to + 1 : to, 0, moved);
      return { ...prev, tabs: arr };
    });
  }, []);

  const closeOthers = useCallback((id: string) => {
    setState(prev => {
      const keep = prev.tabs.find(t => t.id === id);
      if (!keep) return prev;
      if (prev.activeId !== id) navigate(keep.path);
      return { tabs: [keep], activeId: id };
    });
  }, [navigate]);

  const closeToRight = useCallback((id: string) => {
    setState(prev => {
      const idx = prev.tabs.findIndex(t => t.id === id);
      if (idx < 0) return prev;
      const nextTabs = prev.tabs.slice(0, idx + 1);
      // Se a ativa estava à direita (foi removida), a indicada vira a ativa.
      if (!nextTabs.some(t => t.id === prev.activeId)) {
        navigate(nextTabs[idx].path);
        return { tabs: nextTabs, activeId: id };
      }
      return { ...prev, tabs: nextTabs };
    });
  }, [navigate]);

  const closeAll = useCallback(() => {
    setState({ tabs: [], activeId: null });
    navigate('/dashboard'); // o efeito de auto-criar recria a aba do Painel
  }, [navigate]);

  return (
    <Context.Provider value={{ tabs, activeId, openTab, closeTab, setActiveTab, reorderTabs, closeOthers, closeToRight, closeAll }}>
      {children}
    </Context.Provider>
  );
}

export function useTabs(): TabsCtx {
  const ctx = useContext(Context);
  if (!ctx) {
    // Fallback no-op pra evitar crash quando Provider não existe (rota auth)
    return {
      tabs: [],
      activeId: null,
      openTab: () => {},
      closeTab: () => {},
      setActiveTab: () => {},
      reorderTabs: () => {},
      closeOthers: () => {},
      closeToRight: () => {},
      closeAll: () => {},
    };
  }
  return ctx;
}

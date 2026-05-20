import { useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { useQueries, keepPreviousData } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { useNavigate } from 'react-router-dom';
import {
  MagnifyingGlass as Search, ClipboardText as ClipboardList, Users, Package, FileText,
  X, ArrowRight, House as Home, Buildings, ClockCounterClockwise as Clock,
} from '@phosphor-icons/react';
import { menuGroups, secondaryRoutes } from '@/data/navigation';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { normalizeForSearch } from '@/lib/searchUtils';

type QueryType = 'cnpj' | 'barcode' | 'invoice' | 'order_number' | 'group' | 'general';
type Scope = 'all' | 'orders' | 'sales' | 'clients' | 'products' | 'references' | 'suppliers';

function detectQueryType(query: string): QueryType {
  const trimmed = query.trim();
  if (trimmed.startsWith('/')) return 'group';
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(trimmed)) return 'cnpj';
  if (/^\d{10,13}$/.test(trimmed)) return 'barcode';
  if (/^NF\s?\d+$/i.test(trimmed)) return 'invoice';
  if (/^OP[-\s]?\d+$/i.test(trimmed)) return 'order_number';
  return 'general';
}

/**
 * Sanitiza input pra `.or(...)` do PostgREST. Vírgula separa clauses, parênteses
 * delimitam grupos, asterisco/percent é wildcard, contrabarra escapa. Quando o
 * usuário digita qualquer um (ex.: "TM, 12"), o filtro fica malformado e a query
 * retorna 0 resultados sem erro visível. Remove os chars problemáticos.
 */
function sanitizeForPostgrestOr(s: string): string {
  return s.replace(/[,()]/g, ' ').replace(/[\\%_]/g, '').trim();
}

/**
 * Constrói o filtro `.or()` do PostgREST com suporte a busca multi-palavra.
 * Termo de 1 palavra → `field.ilike.%termo%` por campo, unidos por OR.
 * Termo com várias palavras → cada campo precisa casar TODAS as palavras
 * (`and(field.ilike.%a%,field.ilike.%b%)`), campos unidos por OR. Assim
 * "sandalia preta" acha o que tem "sandalia" E "preta" no mesmo campo,
 * em qualquer ordem — antes exigia a substring exata "sandalia preta".
 */
function multiWordOr(fields: string[], rawTerm: string): string {
  const tokens = rawTerm
    .split(/\s+/)
    .map(t => t.replace(/[\\%_,()]/g, '').trim())
    .filter(t => t.length >= 1);
  if (tokens.length <= 1) {
    const t = tokens[0] ?? rawTerm;
    return fields.map(f => `${f}.ilike.%${t}%`).join(',');
  }
  return fields.map(f => `and(${tokens.map(t => `${f}.ilike.%${t}%`).join(',')})`).join(',');
}

const TYPE_LABELS: Record<QueryType, string> = {
  cnpj: 'CNPJ',
  barcode: 'Código de Barras',
  invoice: 'Nota Fiscal',
  order_number: 'Ordem de Produção',
  group: 'Grupo Econômico',
  general: 'Busca Geral',
};

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'Tudo' },
  { key: 'orders', label: 'OPs' },
  { key: 'sales', label: 'Pedidos' },
  { key: 'clients', label: 'Clientes' },
  { key: 'products', label: 'Materiais' },
  { key: 'references', label: 'Modelos' },
  { key: 'suppliers', label: 'Fornecedores' },
];

const RECENT_KEY = 'global-search-recent';
function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function pushRecent(term: string) {
  const t = term.trim();
  if (t.length < 2) return;
  const next = [t, ...loadRecent().filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, 6);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota */ }
}

/** Destaca os tokens da busca dentro de um texto de resultado. */
function Highlight({ text, term }: { text: string | null | undefined; term: string }): ReactNode {
  if (!text) return null;
  const tokens = (term || '')
    .replace(/^\//, '')
    .split(/\s+/)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(t => t.length >= 2);
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.join('|')})`, 'ig');
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1
      ? <mark key={i} className="bg-primary/20 text-foreground rounded-[2px]">{p}</mark>
      : <span key={i}>{p}</span>
  );
}

// Singleton guard: AppLayout renderiza o GlobalSearch em 3 lugares (sidebar
// expanded/collapsed/mobile). Sem isso, cada instância escuta o cmd+K e o
// usuário via 3 dialogs sobrepostos.
let activeShortcutOwner: symbol | null = null;

export function GlobalSearch({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [recent, setRecent] = useState<string[]>([]);
  const navigate = useNavigate();
  const [debouncedQuery] = useDebounce(query.trim(), 180);

  // Keyboard shortcut: Ctrl+K / Cmd+K — só a 1ª instância montada registra.
  useEffect(() => {
    const id = Symbol('global-search');
    if (activeShortcutOwner) return;
    activeShortcutOwner = id;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      if (activeShortcutOwner === id) activeShortcutOwner = null;
    };
  }, []);

  // Recarrega buscas recentes toda vez que abre.
  useEffect(() => { if (open) setRecent(loadRecent()); }, [open]);
  // Reseta scope ao fechar.
  useEffect(() => { if (!open) setScope('all'); }, [open]);

  const detectedType = useMemo(() => detectQueryType(query), [query]);
  const isGroupSearch = detectedType === 'group';
  // q normalizado (sem espaços/acentos) pra match com nav items locais.
  // "novo ped"/"NovoPed" devem casar com "Novo Pedido" — pedido user.
  const q = normalizeForSearch(query);

  // Busca por grupo: tira a "/" do começo. Busca normal: sanitiza pro PostgREST.
  const groupTerm = isGroupSearch ? sanitizeForPostgrestOr(debouncedQuery.replace(/^\//, '')) : '';
  const searchTerm = isGroupSearch ? '' : sanitizeForPostgrestOr(debouncedQuery);
  const hasMinChars = (isGroupSearch ? groupTerm : searchTerm).length >= 2;
  const searchEnabled = open && hasMinChars && !isGroupSearch;
  const groupEnabled = open && hasMinChars && isGroupSearch;

  // Extrai dígitos sempre que houver ≥4 consecutivos — CNPJ truncado ("00012345")
  // não casa com "00.012.345/..." armazenado com pontos sem isso.
  const allDigits = searchTerm.replace(/\D/g, '');
  const cnpjDigits = allDigits.length >= 4 ? allDigits : '';

  const inScope = (s: Scope) => scope === 'all' || scope === s;

  const [ordersQuery, clientsQuery, productsQuery, saleOrdersQuery, referencesQuery, suppliersQuery, groupQuery] = useQueries({
    queries: [
      {
        queryKey: ['global-search-orders', searchTerm],
        enabled: searchEnabled && inScope('orders'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const { data, error } = await supabase
            .from('orders')
            .select('id, order_number, status')
            .or(multiWordOr(['order_number'], searchTerm))
            .order('created_at', { ascending: false })
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ['global-search-clients', searchTerm, cnpjDigits],
        enabled: searchEnabled && inScope('clients'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const orParts = [multiWordOr(['razao_social', 'nome_fantasia', 'cnpj', 'client_number'], searchTerm)];
          if (cnpjDigits.length >= 4) orParts.push(`cnpj.ilike.%${cnpjDigits}%`);
          const { data, error } = await supabase
            .from('clients')
            .select('id, razao_social, cnpj, nome_fantasia, client_number')
            .or(orParts.join(','))
            .order('razao_social')
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ['global-search-products', searchTerm],
        enabled: searchEnabled && inScope('products'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const { data, error } = await supabase
            .from('products')
            .select('id, name, sku, color, quantity, unit')
            .or(multiWordOr(['name', 'sku', 'color'], searchTerm))
            .order('updated_at', { ascending: false })
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ['global-search-sale-orders', searchTerm, cnpjDigits],
        enabled: searchEnabled && inScope('sales'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const orParts = [multiWordOr(['order_number', 'client_name', 'client_cnpj'], searchTerm)];
          if (cnpjDigits.length >= 4) orParts.push(`client_cnpj.ilike.%${cnpjDigits}%`);
          const { data, error } = await supabase
            .from('sale_orders')
            .select('id, order_number, client_name, client_cnpj, status')
            .or(orParts.join(','))
            .order('created_at', { ascending: false })
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        // Nomes de modelo vivem em technical_sheets.name (product_references
        // costuma ficar vazia neste DB). Buscamos as duas fontes e unimos.
        queryKey: ['global-search-references', searchTerm],
        enabled: searchEnabled && inScope('references'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const [refRes, sheetRes] = await Promise.all([
            supabase.from('product_references').select('id, name, shoe_category')
              .or(multiWordOr(['name'], searchTerm)).order('updated_at', { ascending: false }).limit(6),
            supabase.from('technical_sheets').select('id, name, shoe_category')
              .or(multiWordOr(['name'], searchTerm)).order('updated_at', { ascending: false }).limit(6),
          ]);
          const fromRefs = (refRes.data ?? []).map(r => ({ id: r.id, name: r.name, category: r.shoe_category, source: 'product_references' as const }));
          const fromSheets = (sheetRes.data ?? []).map((r: any) => ({ id: r.id, name: r.name, category: r.shoe_category, source: 'technical_sheets' as const }));
          const seen = new Set<string>();
          return [...fromSheets, ...fromRefs].filter(r => {
            if (!r.name || seen.has(r.name)) return false;
            seen.add(r.name);
            return true;
          }).slice(0, 6);
        },
      },
      {
        queryKey: ['global-search-suppliers', searchTerm],
        enabled: searchEnabled && inScope('suppliers'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const { data, error } = await supabase
            .from('suppliers')
            .select('id, name, trade_name, cnpj, active')
            .or(multiWordOr(['name', 'trade_name', 'cnpj'], searchTerm))
            .order('name')
            .limit(6);
          if (error) throw error;
          return data ?? [];
        },
      },
      {
        // Busca por grupo econômico (prefixo "/"). Encadeia:
        // economic_groups → clients (economic_group_id) → sale_orders (client_id)
        // → orders (sale_order_id). Mostra o grupo + um preview dos PVs e OPs.
        queryKey: ['global-search-group', groupTerm],
        enabled: groupEnabled,
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
          const empty = { groups: [], saleOrders: [], orders: [], clientCount: 0 };
          const { data: groups, error: gErr } = await supabase
            .from('economic_groups')
            .select('id, name, group_number')
            .or(multiWordOr(['name'], groupTerm))
            .limit(5);
          if (gErr) throw gErr;
          if (!groups || groups.length === 0) return empty;

          const groupIds = groups.map(g => g.id);
          const { data: clients, error: cErr } = await supabase
            .from('clients')
            .select('id, economic_group_id')
            .in('economic_group_id', groupIds);
          if (cErr) throw cErr;
          const clientIds = (clients ?? []).map(c => c.id);
          if (clientIds.length === 0) return { ...empty, groups };

          const { data: saleOrders, error: soErr } = await supabase
            .from('sale_orders')
            .select('id, order_number, client_name, status')
            .in('client_id', clientIds)
            .order('created_at', { ascending: false })
            .limit(10);
          if (soErr) throw soErr;

          const soIds = (saleOrders ?? []).map(s => s.id);
          let orders: any[] = [];
          if (soIds.length > 0) {
            const { data: ords } = await supabase
              .from('orders')
              .select('id, order_number, status, sale_order_id')
              .in('sale_order_id', soIds)
              .order('created_at', { ascending: false })
              .limit(10);
            orders = ords ?? [];
          }
          return { groups, saleOrders: saleOrders ?? [], orders, clientCount: clientIds.length };
        },
      },
    ],
  });

  const orders = searchEnabled ? (ordersQuery.data ?? []) : [];
  const clients = searchEnabled ? (clientsQuery.data ?? []) : [];
  const products = searchEnabled ? (productsQuery.data ?? []) : [];
  const saleOrders = searchEnabled ? (saleOrdersQuery.data ?? []) : [];
  const references = searchEnabled ? (referencesQuery.data ?? []) : [];
  const suppliers = searchEnabled ? (suppliersQuery.data ?? []) : [];
  const groupResult = groupEnabled ? (groupQuery.data ?? null) : null;

  // Páginas (atalhos) — busca local, instantânea.
  // Indexa items do sidebar + secondaryRoutes (removidos do sidebar mas
  // ainda buscáveis aqui — sem isso usuário ficaria órfão dessas rotas).
  const filteredNavItems = useMemo(() => {
    if (!q || q.length < 1 || isGroupSearch) return [];
    const fromSidebar = menuGroups.flatMap(group =>
      group.items
        .filter(item => normalizeForSearch(item.name).includes(q) || normalizeForSearch(group.label).includes(q))
        .map(item => ({ name: item.name, icon: item.icon, path: item.path, groupLabel: group.label }))
    );
    const fromSecondary = secondaryRoutes
      .filter(r => normalizeForSearch(r.name).includes(q) || normalizeForSearch(r.group).includes(q))
      .map(r => ({ name: r.name, icon: r.icon, path: r.path, groupLabel: r.group }));
    return [...fromSidebar, ...fromSecondary];
  }, [q, isGroupSearch]);

  const goTo = useCallback((path: string, persistTerm?: string) => {
    if (persistTerm) pushRecent(persistTerm);
    setOpen(false);
    setQuery('');
    navigate(path);
  }, [navigate]);

  const isLoading = searchEnabled && (
    ordersQuery.isFetching || clientsQuery.isFetching || productsQuery.isFetching ||
    saleOrdersQuery.isFetching || referencesQuery.isFetching || suppliersQuery.isFetching
  );
  const groupLoading = groupEnabled && groupQuery.isFetching;
  const totalResults = filteredNavItems.length + orders.length + clients.length +
    products.length + saleOrders.length + references.length + suppliers.length;
  const groupTotal = groupResult
    ? groupResult.groups.length + groupResult.saleOrders.length + groupResult.orders.length
    : 0;
  const queryError = ordersQuery.error || clientsQuery.error || productsQuery.error ||
    saleOrdersQuery.error || referencesQuery.error || suppliersQuery.error || groupQuery.error;

  return (
    <>
      {compact ? (
        <button
          onClick={() => setOpen(true)}
          title="Buscar (⌘K) — pedidos, clientes, páginas"
          aria-label="Abrir busca global (atalho Command+K)"
          className="flex items-center justify-center h-7 w-7 rounded-lg text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir busca global (atalho Command+K)"
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors',
            'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
            'border border-sidebar-border/40 bg-sidebar-accent/20'
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left">Buscar pedidos, clientes...</span>
          <kbd className="inline-flex h-5 items-center gap-0.5 rounded border border-sidebar-border/60 bg-sidebar-background/80 px-1.5 font-mono text-[11px] font-semibold text-sidebar-foreground/80 shrink-0">
            ⌘K
          </kbd>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 max-w-2xl gap-0 overflow-hidden [&>button]:hidden">
          <Command shouldFilter={false} className="rounded-lg">
            <div className="flex items-center border-b border-border px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <CommandInput
                placeholder="Buscar pedidos, clientes, modelos, fornecedores…  ( / = grupo econômico )"
                value={query}
                onValueChange={setQuery}
                className="border-0 focus:ring-0"
              />
              {q && detectedType !== 'general' && (
                <Badge variant="secondary" className="text-[11px] shrink-0 mr-2">
                  {TYPE_LABELS[detectedType]}
                </Badge>
              )}
              {q && (
                <button onClick={() => setQuery('')} className="p-1 rounded hover:bg-muted">
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>

            {/* Chips de escopo — só na busca geral (busca por grupo tem fluxo próprio) */}
            {q && hasMinChars && !isGroupSearch && (
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border overflow-x-auto">
                {SCOPES.map(s => (
                  <button
                    key={s.key}
                    onClick={() => setScope(s.key)}
                    className={cn(
                      'shrink-0 px-2.5 py-1 rounded-md text-[11px] font-semibold tracking-tight transition-colors',
                      scope === s.key
                        ? 'bg-foreground text-background'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            <CommandList className="max-h-[420px]">
              {/* Estado vazio: recentes + atalhos */}
              {!q && (
                <div className="overflow-y-auto max-h-[320px]">
                  {recent.length > 0 && (
                    <CommandGroup heading="Buscas recentes">
                      {recent.map(term => (
                        <CommandItem key={term} onSelect={() => setQuery(term)}>
                          <Clock className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs">{term}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  <CommandGroup heading="Favoritos / Atalhos">
                    <CommandItem onSelect={() => goTo('/dashboard')}>
                      <Home className="mr-2 h-3.5 w-3.5 text-primary" />
                      Início (Dashboard)
                    </CommandItem>
                  </CommandGroup>
                  {menuGroups.map((group) => (
                    <CommandGroup key={group.label} heading={group.label}>
                      {group.items.map((item) => (
                        <CommandItem key={item.path} onSelect={() => goTo(item.path)}>
                          <item.icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                          {item.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </div>
              )}

              {/* Hint: digitou mas não atingiu o mínimo */}
              {q && !hasMinChars && filteredNavItems.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {isGroupSearch
                    ? 'Digite o nome do grupo econômico após a "/".'
                    : 'Digite pelo menos 2 caracteres pra buscar.'}
                </div>
              )}

              {/* ───────── MODO GRUPO ECONÔMICO ───────── */}
              {isGroupSearch && hasMinChars && (
                <>
                  {groupLoading && groupTotal === 0 && (
                    <div className="py-6 text-center text-sm text-muted-foreground">Buscando grupo…</div>
                  )}
                  {!groupLoading && !queryError && groupResult && groupResult.groups.length === 0 && (
                    <CommandEmpty>
                      <div className="py-2">
                        <p>Nenhum grupo econômico para "{groupTerm}"</p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Digite parte do nome do grupo após a "/".
                        </p>
                      </div>
                    </CommandEmpty>
                  )}
                  {groupResult && groupResult.groups.length > 0 && (
                    <>
                      <CommandGroup heading="Grupo econômico">
                        {groupResult.groups.map((g: any) => (
                          <CommandItem key={g.id} onSelect={() => goTo(`/grupos-economicos/${g.id}`, query)}>
                            <Buildings className="mr-2 h-3.5 w-3.5 text-primary" />
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-semibold truncate">
                                <Highlight text={g.name} term={groupTerm} />
                              </span>
                              {g.group_number != null && (
                                <span className="text-muted-foreground text-xs ml-2 font-mono">#{g.group_number}</span>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-foreground shrink-0">ver 360°</span>
                            <ArrowRight className="ml-1.5 h-3 w-3 text-muted-foreground shrink-0" />
                          </CommandItem>
                        ))}
                      </CommandGroup>

                      {groupResult.saleOrders.length > 0 && (
                        <>
                          <CommandSeparator />
                          <CommandGroup heading={`Pedidos de venda do grupo (${groupResult.saleOrders.length})`}>
                            {groupResult.saleOrders.map((so: any) => (
                              <CommandItem key={so.id} onSelect={() => goTo(`/sales/edit/${so.id}`, query)}>
                                <FileText className="mr-2 h-3.5 w-3.5 text-success" />
                                <div className="flex-1 min-w-0">
                                  <span className="font-mono text-xs font-semibold">{so.order_number}</span>
                                  <span className="text-muted-foreground text-xs ml-2 truncate">{so.client_name}</span>
                                </div>
                                <Badge variant="outline" className="text-[11px] shrink-0">{so.status}</Badge>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </>
                      )}

                      {groupResult.orders.length > 0 && (
                        <>
                          <CommandSeparator />
                          <CommandGroup heading={`Ordens de produção do grupo (${groupResult.orders.length})`}>
                            {groupResult.orders.map((op: any) => (
                              <CommandItem key={op.id} onSelect={() => goTo(`/orders/${op.id}/edit`, query)}>
                                <ClipboardList className="mr-2 h-3.5 w-3.5 text-primary" />
                                <div className="flex-1 min-w-0">
                                  <span className="font-mono text-xs font-semibold">{op.order_number}</span>
                                </div>
                                <Badge variant="outline" className="text-[11px] shrink-0">{op.status}</Badge>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ───────── MODO BUSCA GERAL ───────── */}
              {!isGroupSearch && q && hasMinChars && isLoading && totalResults === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">Buscando…</div>
              )}

              {q && hasMinChars && !isLoading && queryError && (
                <div className="py-6 text-center text-sm">
                  <p className="text-destructive font-medium">Erro ao buscar</p>
                  <p className="text-[11px] text-muted-foreground mt-1 max-w-md mx-auto">
                    {String((queryError as any)?.message ?? queryError).slice(0, 200)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Verifique sua conexão e tente de novo. Se persistir, contate o suporte.
                  </p>
                </div>
              )}

              {!isGroupSearch && q && hasMinChars && !isLoading && !queryError && totalResults === 0 && (
                <CommandEmpty>
                  <div className="py-2">
                    <p>Nenhum resultado para "{query}"</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Tente nº do pedido (OP-…), nome do cliente, CNPJ, produto — ou "/" + nome do grupo econômico.
                    </p>
                  </div>
                </CommandEmpty>
              )}

              {filteredNavItems.length > 0 && (
                <CommandGroup heading="Páginas">
                  {filteredNavItems.map(item => (
                    <CommandItem key={item.path} onSelect={() => goTo(item.path)}>
                      <item.icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium"><Highlight text={item.name} term={q} /></span>
                      <span className="ml-2 text-[11px] text-muted-foreground">{item.groupLabel}</span>
                      <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground shrink-0" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {orders.length > 0 && (
                <CommandGroup heading={`Ordens de Produção (${orders.length})`}>
                  {orders.map(op => (
                    <CommandItem key={op.id} onSelect={() => goTo(`/orders/${op.id}/edit`, query)}>
                      <ClipboardList className="mr-2 h-3.5 w-3.5 text-primary" />
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-xs font-semibold">
                          <Highlight text={op.order_number} term={searchTerm} />
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[11px] shrink-0">{op.status}</Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {saleOrders.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Pedidos de Venda (${saleOrders.length})`}>
                    {saleOrders.map(so => (
                      <CommandItem key={so.id} onSelect={() => goTo(`/sales/edit/${so.id}`, query)}>
                        <FileText className="mr-2 h-3.5 w-3.5 text-success" />
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs font-semibold">
                            <Highlight text={so.order_number} term={searchTerm} />
                          </span>
                          <span className="text-muted-foreground text-xs ml-2 truncate">
                            <Highlight text={so.client_name} term={searchTerm} />
                          </span>
                        </div>
                        <Badge variant="outline" className="text-[11px] shrink-0">{so.status}</Badge>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {clients.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Clientes (${clients.length})`}>
                    {clients.map(c => (
                      <CommandItem
                        key={c.id}
                        onSelect={() => goTo(`/clients?q=${encodeURIComponent(c.razao_social || c.cnpj || '')}`, query)}
                      >
                        <Users className="mr-2 h-3.5 w-3.5 text-warning" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">
                            <Highlight text={c.razao_social} term={searchTerm} />
                          </span>
                          {c.cnpj && (
                            <span className="text-muted-foreground text-xs ml-2 font-mono">
                              <Highlight text={c.cnpj} term={searchTerm} />
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {suppliers.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Fornecedores (${suppliers.length})`}>
                    {suppliers.map((s: any) => (
                      <CommandItem
                        key={s.id}
                        onSelect={() => goTo(`/suppliers?q=${encodeURIComponent(s.trade_name || s.name || '')}`, query)}
                      >
                        <Buildings className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">
                            <Highlight text={s.trade_name || s.name} term={searchTerm} />
                          </span>
                          {s.cnpj && (
                            <span className="text-muted-foreground text-xs ml-2 font-mono">
                              <Highlight text={s.cnpj} term={searchTerm} />
                            </span>
                          )}
                        </div>
                        {s.active === false && <Badge variant="outline" className="text-[11px] shrink-0">inativo</Badge>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {products.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Materiais / Estoque (${products.length})`}>
                    {products.map(p => (
                      <CommandItem
                        key={p.id}
                        onSelect={() => goTo(`/estoque?q=${encodeURIComponent(p.sku || p.name || '')}`, query)}
                      >
                        <Package className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">
                            <Highlight text={p.name} term={searchTerm} />
                          </span>
                          {p.color && <span className="text-muted-foreground text-xs ml-1">({p.color})</span>}
                          {p.sku && (
                            <span className="text-muted-foreground text-xs ml-2 font-mono">
                              <Highlight text={p.sku} term={searchTerm} />
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                          {Number(p.quantity).toLocaleString('pt-BR')} {p.unit}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {references.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Modelos / Referências (${references.length})`}>
                    {references.map((r: any) => (
                      <CommandItem
                        key={r.id}
                        onSelect={() => goTo(`/fichas-tecnicas?q=${encodeURIComponent(r.name)}`, query)}
                      >
                        <Package className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">
                            <Highlight text={r.name} term={searchTerm} />
                          </span>
                          {r.category && <span className="text-muted-foreground text-xs ml-2">({r.category})</span>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>

            {q && hasMinChars && (totalResults > 0 || groupTotal > 0) && (
              <div className="border-t border-border p-2 flex items-center justify-between px-3">
                <span className="text-[11px] text-muted-foreground">
                  {(() => { const n = isGroupSearch ? groupTotal : totalResults; return `${n} ${n === 1 ? 'resultado' : 'resultados'}`; })()}
                  {isGroupSearch && groupResult && groupResult.clientCount > 0 && (
                    <span> · {groupResult.clientCount} {groupResult.clientCount === 1 ? 'loja' : 'lojas'} no grupo</span>
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground font-mono">↑↓ navegar · ↵ abrir</span>
              </div>
            )}
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

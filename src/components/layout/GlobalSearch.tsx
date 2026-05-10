import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { useNavigate } from 'react-router-dom';
 import { Search, ClipboardList, Users, Package, FileText, X, ArrowRight, Home } from 'lucide-react';
 import { menuGroups } from '@/data/navigation';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

type QueryType = 'cnpj' | 'barcode' | 'invoice' | 'order_number' | 'general';

function detectQueryType(query: string): QueryType {
  const trimmed = query.trim();
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(trimmed)) return 'cnpj';
  if (/^\d{10,13}$/.test(trimmed)) return 'barcode';
  if (/^NF\s?\d+$/i.test(trimmed)) return 'invoice';
  if (/^OP[-\s]?\d+$/i.test(trimmed)) return 'order_number';
  return 'general';
}

/**
 * Sanitiza input pra `.or(...)` do PostgREST. A vírgula é separator de clauses,
 * parênteses delimitam grupos, asterisco/percent é wildcard, contrabarra escapa.
 * Quando o usuário digita qualquer um desses (ex.: "TM, 12" ou "OP-2026"), o filtro
 * fica malformado e a query retorna 0 resultados sem erro visível — o que é
 * exatamente o sintoma reportado: "digito várias coisas e não acho nada".
 *
 * Solução: remove os chars problemáticos antes de mandar pro Supabase.
 * Hífens, espaços e outros chars normais ficam intactos.
 */
function sanitizeForPostgrestOr(s: string): string {
  return s
    .replace(/[,()]/g, ' ')   // vírgula e parens viram espaço
    .replace(/[\\%_]/g, '')   // wildcards e escape
    .trim();
}

const TYPE_LABELS: Record<QueryType, string> = {
  cnpj: 'CNPJ',
  barcode: 'Código de Barras',
  invoice: 'Nota Fiscal',
  order_number: 'Ordem de Produção',
  general: 'Busca Geral',
};

export function GlobalSearch({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const [debouncedQuery] = useDebounce(query.trim(), 250);

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const detectedType = useMemo(() => detectQueryType(query), [query]);
  const q = query.toLowerCase().trim();
  const searchTerm = sanitizeForPostgrestOr(debouncedQuery);
  const hasMinChars = searchTerm.length >= 2;
  const searchEnabled = open && hasMinChars;
  // CNPJ digitado com máscara: "12.345.678/0001-90". Remove chars não-numéricos
  // pra também buscar sem máscara, já que clients.cnpj pode estar de qualquer jeito.
  const cnpjDigits = detectedType === 'cnpj' ? searchTerm.replace(/\D/g, '') : '';

  const [ordersQuery, clientsQuery, productsQuery, saleOrdersQuery] = useQueries({
    queries: [
      {
        queryKey: ['global-search-orders', searchTerm],
        enabled: searchEnabled,
        staleTime: 60 * 1000,
        queryFn: async () => {
          // status removido do .or() — historicamente trazia ruído (busca "ok" achava
          // OPs em qualquer estado contendo "ok"). Order_number já é o identificador
          // primário e o que o usuário realmente quer encontrar.
          const { data, error } = await supabase
            .from('orders')
            .select('id, order_number, status')
            .ilike('order_number', `%${searchTerm}%`)
            .order('created_at', { ascending: false })
            .limit(5);

          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ['global-search-clients', searchTerm, cnpjDigits],
        enabled: searchEnabled,
        staleTime: 60 * 1000,
        queryFn: async () => {
          const orParts = [
            `razao_social.ilike.%${searchTerm}%`,
            `cnpj.ilike.%${searchTerm}%`,
            `nome_fantasia.ilike.%${searchTerm}%`,
            `client_number.ilike.%${searchTerm}%`,
          ];
          // Match também por CNPJ sem máscara — tabela pode ter qualquer formato.
          if (cnpjDigits.length >= 4) {
            orParts.push(`cnpj.ilike.%${cnpjDigits}%`);
          }
          const { data, error } = await supabase
            .from('clients')
            .select('id, razao_social, cnpj, nome_fantasia, client_number')
            .or(orParts.join(','))
            .order('razao_social')
            .limit(5);

          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ['global-search-products', searchTerm],
        enabled: searchEnabled,
        staleTime: 60 * 1000,
        queryFn: async () => {
          const { data, error } = await supabase
            .from('products')
            .select('id, name, sku, color, quantity, unit')
            .or(`name.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%,color.ilike.%${searchTerm}%`)
            .order('updated_at', { ascending: false })
            .limit(5);

          if (error) throw error;
          return data ?? [];
        },
      },
      {
        queryKey: ['global-search-sale-orders', searchTerm, cnpjDigits],
        enabled: searchEnabled,
        staleTime: 60 * 1000,
        queryFn: async () => {
          const orParts = [
            `order_number.ilike.%${searchTerm}%`,
            `client_name.ilike.%${searchTerm}%`,
            `client_cnpj.ilike.%${searchTerm}%`,
          ];
          if (cnpjDigits.length >= 4) {
            orParts.push(`client_cnpj.ilike.%${cnpjDigits}%`);
          }
          const { data, error } = await supabase
            .from('sale_orders')
            .select('id, order_number, client_name, client_cnpj, status')
            .or(orParts.join(','))
            .order('created_at', { ascending: false })
            .limit(5);

          if (error) throw error;
          return data ?? [];
        },
      },
    ],
  });

  const orders = ordersQuery.data ?? [];
  const clients = clientsQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const saleOrders = saleOrdersQuery.data ?? [];

  // Antes: filteredXxx usava `q` (immediate) mas dados vêm de `searchTerm` (debounced),
  // criando flash de "Nenhum resultado" entre digitação e fim da query. Agora usa
  // searchEnabled como único gate — se não habilitou, lista vazia; se habilitou,
  // mostra o que tem (incluindo enquanto loading).
  const filteredOrders = useMemo(() => (searchEnabled ? orders : []), [searchEnabled, orders]);
  const filteredClients = useMemo(() => (searchEnabled ? clients : []), [searchEnabled, clients]);
  const filteredProducts = useMemo(() => (searchEnabled ? products : []), [searchEnabled, products]);
  const filteredSaleOrders = useMemo(() => (searchEnabled ? saleOrders : []), [searchEnabled, saleOrders]);

  // Páginas (atalhos) — busca em string local, ainda usa `q` imediato (UX rápida).
  const filteredNavItems = useMemo(() => {
    if (!q || q.length < 1) return [];
    return menuGroups.flatMap(group =>
      group.items
        .filter(item =>
          item.name.toLowerCase().includes(q) ||
          group.label.toLowerCase().includes(q)
        )
        .map(item => ({ ...item, groupLabel: group.label }))
    );
  }, [q]);

  const goTo = useCallback((path: string) => {
    setOpen(false);
    setQuery('');
    navigate(path);
  }, [navigate]);

  const isLoading = searchEnabled && (ordersQuery.isFetching || clientsQuery.isFetching || productsQuery.isFetching || saleOrdersQuery.isFetching);
  const totalResults = filteredNavItems.length + filteredOrders.length + filteredClients.length + filteredProducts.length + filteredSaleOrders.length;

  return (
    <>
      {compact ? (
        <button
          onClick={() => setOpen(true)}
          title="Buscar (⌘K)"
          className="flex items-center justify-center h-7 w-7 rounded-lg text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors',
            'text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
            'border border-sidebar-border/30'
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left">Buscar...</span>
          <kbd className="inline-flex h-5 items-center gap-0.5 rounded border border-sidebar-border/50 bg-sidebar-accent/30 px-1.5 font-mono text-[10px] text-sidebar-muted shrink-0">
            ⌘K
          </kbd>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 max-w-2xl gap-0 overflow-hidden [&>button]:hidden">
          <Command shouldFilter={false} className="rounded-lg">
            <div className="flex items-center border-b px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <CommandInput
                placeholder="Buscar pedidos, clientes, materiais, NF-e..."
                value={query}
                onValueChange={setQuery}
                className="border-0 focus:ring-0"
              />
              {q && detectedType !== 'general' && (
                <Badge variant="secondary" className="text-[10px] shrink-0 mr-2">
                  {TYPE_LABELS[detectedType]}
                </Badge>
              )}
              {q && (
                <button onClick={() => setQuery('')} className="p-1 rounded hover:bg-muted">
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>

            <CommandList className="max-h-[400px]">
              {!q && (
                <div className="overflow-y-auto max-h-[300px]">
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

              {/* Hint quando o usuário digitou algo mas ainda não atingiu o mínimo
                  pra disparar busca remota. Antes não tinha feedback e o usuário
                  ficava digitando achando que estava quebrado. */}
              {q && !hasMinChars && filteredNavItems.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Digite pelo menos 2 caracteres pra buscar pedidos, clientes e materiais.
                </div>
              )}

              {q && hasMinChars && isLoading && totalResults === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">Buscando...</div>
              )}

              {q && hasMinChars && !isLoading && totalResults === 0 && (
                <CommandEmpty>
                  <div className="py-2">
                    <p>Nenhum resultado para "{query}"</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Tente buscar por nº do pedido (OP-…), nome do cliente, CNPJ ou nome do produto.
                    </p>
                  </div>
                </CommandEmpty>
              )}

              {filteredNavItems.length > 0 && (
                <CommandGroup heading="Páginas">
                  {filteredNavItems.map(item => (
                    <CommandItem key={item.path} onSelect={() => goTo(item.path)}>
                      <item.icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">{item.name}</span>
                      <span className="ml-2 text-[10px] text-muted-foreground">{item.groupLabel}</span>
                      <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground shrink-0" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {filteredOrders.length > 0 && (
                <CommandGroup heading="Ordens de Produção">
                  {filteredOrders.map(op => (
                    <CommandItem key={op.id} onSelect={() => goTo(`/orders/${op.id}/edit`)}>
                      <ClipboardList className="mr-2 h-3.5 w-3.5 text-primary" />
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-xs font-semibold">{op.order_number}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{op.status}</Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {filteredSaleOrders.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Pedidos de Venda">
                    {filteredSaleOrders.map(so => (
                      <CommandItem key={so.id} onSelect={() => goTo(`/sales/edit/${so.id}`)}>
                        <FileText className="mr-2 h-3.5 w-3.5 text-success" />
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs font-semibold">{so.order_number}</span>
                          <span className="text-muted-foreground text-xs ml-2 truncate">{so.client_name}</span>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">{so.status}</Badge>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {filteredClients.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Clientes">
                    {filteredClients.map(c => (
                      <CommandItem key={c.id} onSelect={() => goTo('/clients')}>
                        <Users className="mr-2 h-3.5 w-3.5 text-warning" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">{c.razao_social}</span>
                          {c.cnpj && <span className="text-muted-foreground text-xs ml-2 font-mono">{c.cnpj}</span>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {filteredProducts.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Materiais / Estoque">
                    {filteredProducts.map(p => (
                      <CommandItem key={p.id} onSelect={() => goTo('/estoque')}>
                        <Package className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold truncate">{p.name}</span>
                          {p.color && <span className="text-muted-foreground text-xs ml-1">({p.color})</span>}
                          {p.sku && <span className="text-muted-foreground text-xs ml-2 font-mono">{p.sku}</span>}
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">{Number(p.quantity).toLocaleString('pt-BR')} {p.unit}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>

            {q && totalResults > 0 && (
              <div className="border-t p-2 text-center">
                <span className="text-[10px] text-muted-foreground">{totalResults} resultado(s) encontrado(s)</span>
              </div>
            )}
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

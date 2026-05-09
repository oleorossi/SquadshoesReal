import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Loader2, Package, Lock, Factory, CheckCircle2,
  ArrowUp, ArrowDown, ArrowUpDown, Eye, RefreshCw, AlertTriangle,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ProductReservationDetailsDialog from '@/components/inventory/ProductReservationDetailsDialog';
import { SmartSearch, SmartSearchSuggestion } from '@/components/ui/smart-search';

interface StockRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string | null;
  color: string | null;
  quantity: number;
  reserved_quantity: number;
  in_production_quantity: number;
  available_quantity: number;
}

type FilterValue = 'all' | 'reserved' | 'in_production' | 'low' | 'alert';
type SortKey = 'name' | 'quantity' | 'reserved_quantity' | 'in_production_quantity' | 'available_quantity' | 'alert_first';

const fmt = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};

const PREFS_KEY = 'stockReservations.prefs.v1';

interface Prefs {
  search: string;
  filter: FilterValue;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  threshold: number;
  autoRefresh: boolean;
  refreshSeconds: number;
}

const DEFAULTS: Prefs = {
  search: '',
  filter: 'all',
  sortKey: 'name',
  sortDir: 'asc',
  threshold: 0,
  autoRefresh: false,
  refreshSeconds: 30,
};

function loadStoredPrefs(): Partial<Prefs> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function isSortKey(v: string | null): v is SortKey {
  return v === 'name' || v === 'quantity' || v === 'reserved_quantity'
    || v === 'in_production_quantity' || v === 'available_quantity' || v === 'alert_first';
}
function isFilter(v: string | null): v is FilterValue {
  return v === 'all' || v === 'reserved' || v === 'in_production' || v === 'low' || v === 'alert';
}

export default function StockReservations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const stored = useMemo(loadStoredPrefs, []);

  // Resolve estado inicial: URL > localStorage > default
  const initial: Prefs = useMemo(() => {
    const fromUrl = (k: keyof Prefs) => searchParams.get(k as string);
    const sortKeyUrl = fromUrl('sortKey');
    const filterUrl = fromUrl('filter');
    const thresholdUrl = fromUrl('threshold');
    const refreshUrl = fromUrl('refreshSeconds');
    return {
      search: fromUrl('search') ?? stored.search ?? DEFAULTS.search,
      filter: isFilter(filterUrl) ? filterUrl : (stored.filter ?? DEFAULTS.filter),
      sortKey: isSortKey(sortKeyUrl) ? sortKeyUrl : (stored.sortKey ?? DEFAULTS.sortKey),
      sortDir: (fromUrl('sortDir') === 'desc' ? 'desc' : (fromUrl('sortDir') === 'asc' ? 'asc' : (stored.sortDir ?? DEFAULTS.sortDir))),
      threshold: thresholdUrl !== null ? Number(thresholdUrl) || 0 : (stored.threshold ?? DEFAULTS.threshold),
      autoRefresh: fromUrl('autoRefresh') === '1' ? true : (fromUrl('autoRefresh') === '0' ? false : (stored.autoRefresh ?? DEFAULTS.autoRefresh)),
      refreshSeconds: refreshUrl !== null ? Math.max(5, Number(refreshUrl) || 30) : (stored.refreshSeconds ?? DEFAULTS.refreshSeconds),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [search, setSearch] = useState(initial.search);
  const [filter, setFilter] = useState<FilterValue>(initial.filter);
  const [sortKey, setSortKey] = useState<SortKey>(initial.sortKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initial.sortDir);
  const [threshold, setThreshold] = useState<number>(initial.threshold);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(initial.autoRefresh);
  const [refreshSeconds] = useState<number>(initial.refreshSeconds);
  const [detailsProduct, setDetailsProduct] = useState<{ id: string; name: string; unit: string | null } | null>(null);

  // Sincroniza estado → URL + localStorage
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filter !== DEFAULTS.filter) params.set('filter', filter);
    if (sortKey !== DEFAULTS.sortKey) params.set('sortKey', sortKey);
    if (sortDir !== DEFAULTS.sortDir) params.set('sortDir', sortDir);
    if (threshold !== DEFAULTS.threshold) params.set('threshold', String(threshold));
    if (autoRefresh) params.set('autoRefresh', '1');
    if (refreshSeconds !== DEFAULTS.refreshSeconds) params.set('refreshSeconds', String(refreshSeconds));
    setSearchParams(params, { replace: true });

    const prefs: Prefs = { search, filter, sortKey, sortDir, threshold, autoRefresh, refreshSeconds };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [search, filter, sortKey, sortDir, threshold, autoRefresh, refreshSeconds, setSearchParams]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 inline opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1 inline" />
      : <ArrowDown className="h-3 w-3 ml-1 inline" />;
  };

  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['product-stock-with-reservations'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('product_stock_with_reservations')
        .select('id, name, sku, category, unit, color, quantity, reserved_quantity, in_production_quantity, available_quantity')
        .order('name', { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data || []) as StockRow[];
    },
    staleTime: 60_000,
    refetchInterval: autoRefresh ? refreshSeconds * 1000 : false,
    refetchIntervalInBackground: false,
  });

  const alertCount = useMemo(() => {
    return (data || []).filter((r) => Number(r.available_quantity || 0) <= threshold).length;
  }, [data, threshold]);

  const filtered = useMemo(() => {
    const list = data || [];
    const term = search.trim().toLowerCase();
    const result = list.filter((r) => {
      if (term) {
        const hay = `${r.name} ${r.sku ?? ''} ${r.category ?? ''} ${r.color ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      switch (filter) {
        case 'reserved': return Number(r.reserved_quantity) > 0;
        case 'in_production': return Number(r.in_production_quantity) > 0;
        case 'low': return Number(r.available_quantity) <= 0 && Number(r.quantity) > 0;
        case 'alert': return Number(r.available_quantity || 0) <= threshold;
        default: return true;
      }
    });

    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '', 'pt-BR');
      } else if (sortKey === 'alert_first') {
        const aA = Number(a.available_quantity || 0) <= threshold ? 1 : 0;
        const bA = Number(b.available_quantity || 0) <= threshold ? 1 : 0;
        // Alertas primeiro; desempate por menor disponível
        cmp = bA - aA;
        if (cmp === 0) cmp = Number(a.available_quantity || 0) - Number(b.available_quantity || 0);
      } else {
        cmp = Number(a[sortKey] || 0) - Number(b[sortKey] || 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [data, search, filter, sortKey, sortDir, threshold]);

  const totals = useMemo(() => {
    const list = data || [];
    return list.reduce(
      (acc, r) => {
        acc.products += 1;
        acc.quantity += Number(r.quantity || 0);
        acc.reserved += Number(r.reserved_quantity || 0);
        acc.inProd += Number(r.in_production_quantity || 0);
        acc.available += Number(r.available_quantity || 0);
        return acc;
      },
      { products: 0, quantity: 0, reserved: 0, inProd: 0, available: 0 },
    );
  }, [data]);

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('pt-BR') : '—';

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="display text-2xl md:text-3xl tracking-tight">Reservas e Em Produção</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visão consolidada de estoque por produto: reservado, já em produção e realmente disponível.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Atualizado: {lastUpdate}</span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Atualizar agora"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="auto-refresh" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <Label htmlFor="auto-refresh" className="text-xs cursor-pointer whitespace-nowrap">
              Auto-atualizar ({refreshSeconds}s)
            </Label>
          </div>
        </div>
      </div>

      {alertCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-semibold text-destructive">{alertCount} produto(s)</span>
            <span className="text-muted-foreground"> com disponibilidade ≤ {fmt(threshold)}.</span>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setSortKey('alert_first'); setSortDir('asc'); }}
            >
              Alertas primeiro
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFilter('alert')}
            >
              Ver alertas
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="eyebrow">Produtos</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="display text-2xl tabular-nums">{fmt(totals.products)}</div>
            <p className="text-xs text-muted-foreground mt-1">Total na visão</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="eyebrow">Reservado</CardTitle>
            <Lock className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="display text-2xl tabular-nums text-warning">{fmt(totals.reserved)}</div>
            <p className="text-xs text-muted-foreground mt-1">Reservas ativas</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="eyebrow">Em Produção</CardTitle>
            <Factory className="h-4 w-4 text-info" />
          </CardHeader>
          <CardContent>
            <div className="display text-2xl tabular-nums text-info">{fmt(totals.inProd)}</div>
            <p className="text-xs text-muted-foreground mt-1">Debitado em OPs ativas</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="eyebrow">Disponível</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="display text-2xl tabular-nums text-success">{fmt(totals.available)}</div>
            <p className="text-xs text-muted-foreground mt-1">Livre após reservas</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Detalhamento por produto</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2">
            <SmartSearch
              className="flex-1"
              value={search}
              onChange={setSearch}
              placeholder="Buscar por nome, SKU ou categoria…"
              getSuggestions={(term) => {
                const t = term.toLowerCase();
                const list = data || [];
                const seen = new Set<string>();
                const out: SmartSearchSuggestion[] = [];
                for (const r of list) {
                  const name = r.name || '';
                  if (name.toLowerCase().includes(t) && !seen.has(`name:${name}`)) {
                    seen.add(`name:${name}`);
                    out.push({ field: 'name', value: name });
                  }
                  if (r.sku && r.sku.toLowerCase().includes(t) && !seen.has(`sku:${r.sku}`)) {
                    seen.add(`sku:${r.sku}`);
                    out.push({ field: 'sku', value: r.sku, meta: name });
                  }
                  if (r.category && r.category.toLowerCase().includes(t) && !seen.has(`cat:${r.category}`)) {
                    seen.add(`cat:${r.category}`);
                    out.push({ field: 'category', value: r.category });
                  }
                }
                return out;
              }}
            />
            <Select value={filter} onValueChange={(v) => setFilter(v as FilterValue)}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Filtro" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os produtos</SelectItem>
                <SelectItem value="reserved">Com reserva ativa</SelectItem>
                <SelectItem value="in_production">Em produção</SelectItem>
                <SelectItem value="low">Sem disponibilidade</SelectItem>
                <SelectItem value="alert">Em alerta (≤ limite)</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 sm:w-[200px]">
              <Label htmlFor="threshold" className="text-xs whitespace-nowrap text-muted-foreground">
                Limite alerta:
              </Label>
              <Input
                id="threshold"
                type="number"
                min={0}
                step={1}
                value={threshold}
                onChange={(e) => setThreshold(Math.max(0, Number(e.target.value) || 0))}
                className="h-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-sm text-destructive py-6 text-center">
              Erro ao carregar dados. Verifique sua conexão e tente novamente.
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">
              Nenhum produto encontrado para os filtros selecionados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      onClick={() => toggleSort('name')}
                      className="cursor-pointer select-none hover:bg-muted/40 transition-colors"
                    >
                      Produto<SortIcon col="name" />
                    </TableHead>
                    <TableHead className="hidden md:table-cell">SKU</TableHead>
                    <TableHead className="hidden lg:table-cell">Categoria</TableHead>
                    <TableHead
                      onClick={() => toggleSort('quantity')}
                      className="text-right cursor-pointer select-none hover:bg-muted/40 transition-colors"
                    >
                      Estoque<SortIcon col="quantity" />
                    </TableHead>
                    <TableHead
                      onClick={() => toggleSort('reserved_quantity')}
                      className="text-right cursor-pointer select-none hover:bg-muted/40 transition-colors"
                    >
                      Reservado<SortIcon col="reserved_quantity" />
                    </TableHead>
                    <TableHead
                      onClick={() => toggleSort('in_production_quantity')}
                      className="text-right cursor-pointer select-none hover:bg-muted/40 transition-colors"
                    >
                      Em Produção<SortIcon col="in_production_quantity" />
                    </TableHead>
                    <TableHead
                      onClick={() => toggleSort('available_quantity')}
                      className="text-right cursor-pointer select-none hover:bg-muted/40 transition-colors"
                    >
                      Disponível<SortIcon col="available_quantity" />
                    </TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const reserved = Number(r.reserved_quantity || 0);
                    const inProd = Number(r.in_production_quantity || 0);
                    const avail = Number(r.available_quantity || 0);
                    const isAlert = avail <= threshold;
                    return (
                      <TableRow
                        key={r.id}
                        className={isAlert ? 'bg-destructive/5 hover:bg-destructive/10' : ''}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {isAlert && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                            <div>
                              <div className="font-medium">{r.name}</div>
                              {r.color && (
                                <div className="text-xs text-muted-foreground">{r.color}</div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {r.sku || '—'}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                          {r.category || '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {fmt(r.quantity)} <span className="text-xs text-muted-foreground">{r.unit || ''}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          {reserved > 0 ? (
                            <Badge variant="outline" className="font-mono bg-amber-500/10 text-amber-700 border-amber-500/30">
                              {fmt(reserved)}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {inProd > 0 ? (
                            <Badge variant="outline" className="font-mono bg-blue-500/10 text-blue-700 border-blue-500/30">
                              {fmt(inProd)}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">
                          <span className={isAlert ? 'text-destructive' : 'text-emerald-700'}>
                            {fmt(avail)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setDetailsProduct({ id: r.id, name: r.name, unit: r.unit })}
                            disabled={reserved === 0 && inProd === 0}
                            aria-label="Ver detalhes"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="text-xs text-muted-foreground mt-3">
                Mostrando {filtered.length} de {data?.length ?? 0} produtos.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ProductReservationDetailsDialog
        open={!!detailsProduct}
        onOpenChange={(open) => { if (!open) setDetailsProduct(null); }}
        productId={detailsProduct?.id ?? null}
        productName={detailsProduct?.name}
        unit={detailsProduct?.unit}
      />
    </div>
  );
}
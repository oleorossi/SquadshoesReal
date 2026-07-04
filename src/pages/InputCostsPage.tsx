import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { useProducts } from '@/hooks/useProducts';
import { useProductPriceSummary, type ProductPriceSummary } from '@/hooks/useSuppliers';
import { useSuppliers } from '@/hooks/useSuppliers';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import { TrendUp as TrendingUp, TrendDown as TrendingDown, Minus, MagnifyingGlass as Search, CircleNotch as Loader2, Warning as AlertTriangle, ArrowsClockwise as RefreshCw, Package as PackageSearch } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { normalizeForSearch } from '@/lib/searchUtils';
import { useCan } from '@/hooks/useAccessControl';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(v);

const fmtDate = (d: string | null) =>
  d ? format(parseISO(d), 'dd/MM/yyyy', { locale: ptBR }) : '—';

// ─── Inline price editor ──────────────────────────────────────────────────────
function PriceCell({
  productId,
  value,
  onSaved,
}: {
  productId: string;
  value: number;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(value.toFixed(4));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = useCallback(async () => {
    const parsed = parseFloat(draft.replace(',', '.'));
    if (isNaN(parsed) || parsed < 0) {
      setEditing(false);
      return;
    }
    if (parsed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('products')
      .update({ unit_price: parsed } as any)
      .eq('id', productId);
    setSaving(false);
    if (error) {
      toast.error(`Erro ao salvar: ${error.message}`);
    } else {
      toast.success('Preço atualizado');
      onSaved();
    }
    setEditing(false);
  }, [draft, productId, value, onSaved]);

  if (saving) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        {fmt(value)}
      </div>
    );
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="h-7 w-28 text-xs font-mono text-right"
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      title="Clique para editar o preço"
      className="font-mono text-sm hover:text-primary hover:underline decoration-dotted transition-colors text-right w-full block"
    >
      {fmt(value)}
    </button>
  );
}

// ─── Trend indicator ──────────────────────────────────────────────────────────
function PriceTrend({ latest, previous }: { latest: number; previous: number | null }) {
  if (!previous || previous === 0) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  const pct = ((latest - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  if (pct > 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-0.5 text-destructive text-xs font-medium">
            <TrendingUp className="h-3.5 w-3.5" />+{pct.toFixed(1)}%
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Anterior: {fmt(previous)}
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-0.5 text-green-600 text-xs font-medium">
          <TrendingDown className="h-3.5 w-3.5" />{pct.toFixed(1)}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Anterior: {fmt(previous)}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function InputCostsPage() {
  const qc = useQueryClient();
  const perm = useCan('/custos-insumos');
  const { data: products = [], isLoading: loadingProducts } = useProducts();
  const { data: priceSummaries = [], isLoading: loadingPrices } = useProductPriceSummary();
  const { data: suppliers = [] } = useSuppliers();

  // Realtime: invalidate whenever any product price changes (from any screen)
  useEffect(() => {
    const channel = supabase
      .channel('input-costs-products-watch')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'products' },
        () => {
          qc.invalidateQueries({ queryKey: ['products'] });
          qc.invalidateQueries({ queryKey: ['product_price_summary'] });
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'invoice_items' },
        () => {
          qc.invalidateQueries({ queryKey: ['product_price_summary'] });
        },
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') console.warn('[realtime] input-costs:', err?.message);
      });
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(false);

  const priceMap = useMemo(() => {
    const m = new Map<string, ProductPriceSummary>();
    for (const s of priceSummaries) m.set(s.product_id, s);
    return m;
  }, [priceSummaries]);

  const supplierMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of suppliers) m.set(s.id, s.name);
    return m;
  }, [suppliers]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of products) if (p.category) cats.add(p.category);
    return [...cats].sort();
  }, [products]);

  const rows = useMemo(() => {
    const q = normalizeForSearch(search);
    return products.filter((p: any) => {
      if (!showInactive && !p.active) return false;
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (q && !normalizeForSearch(p.name).includes(q) && !normalizeForSearch(p.sku).includes(q)) return false;
      return true;
    });
  }, [products, search, categoryFilter, showInactive]);

  const onPriceSaved = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['product_price_summary'] });
  }, [qc]);

  const loading = loadingProducts || loadingPrices;

  return (
    <AppLayout>
      <div className="space-y-5">
        <EditorialPageHeader
          sectionLabel="CUSTOS · INSUMOS"
          title="Custos de Insumos"
          description="Valores de cada material — clique no custo atual para editar. Atualiza automaticamente com cada compra lançada."
          actions={
            <Button
              variant="outline"
              size="sm"
              className="gap-2 shrink-0"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['products'] });
                qc.invalidateQueries({ queryKey: ['product_price_summary'] });
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar
            </Button>
          }
        />

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou SKU…"
              className="pl-8 h-8 text-sm"
            />
          </div>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 w-44 text-sm">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Exibir inativos
          </label>

          <span className="text-xs text-muted-foreground ml-auto">
            {rows.length} insumo{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando…
          </div>
        ) : rows.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={PackageSearch}
              title="Nenhum insumo encontrado"
              description="Ajuste a busca ou os filtros de categoria."
            />
          </Panel>
        ) : (
          <Panel flush bodyClassName="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead className="min-w-[220px]">Material</TableHead>
                  <TableHead className="w-[110px]">Categoria</TableHead>
                  <TableHead className="w-[110px] text-center">Un. Consumo</TableHead>
                  <TableHead className="w-[110px] text-center">Un. Compra</TableHead>
                  <TableHead className="w-[90px] text-center">Conversão</TableHead>
                  <TableHead className="w-[140px] text-right">
                    <Tooltip>
                      <TooltipTrigger className="cursor-default">
                        Custo Atual
                      </TooltipTrigger>
                      <TooltipContent>Preço cadastrado no produto — clique para editar</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-[140px] text-right">
                    <Tooltip>
                      <TooltipTrigger className="cursor-default">
                        Últ. Compra (NF)
                      </TooltipTrigger>
                      <TooltipContent>Último preço registrado via nota fiscal</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-[90px] text-center">Variação</TableHead>
                  <TableHead className="w-[120px]">Data Compra</TableHead>
                  <TableHead className="min-w-[140px]">Fornecedor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p: any) => {
                  const summary = priceMap.get(p.id);
                  const supplierName =
                    (p.supplier_id ? supplierMap.get(p.supplier_id) : null) ??
                    summary?.supplier_name ??
                    null;

                  const consumptionUnit = p.consumption_unit || p.unit || '—';
                  const purchaseUnit = p.purchase_unit || p.purchase_order_unit || p.unit || '—';
                  const conversion = Number(p.conversion_rate) || 1;
                  const currentPrice = Number(p.unit_price) || 0;
                  const lastPurchasePrice = summary?.latest_price ?? null;

                  // Warn if current price diverges > 10% from last purchase
                  const diverged =
                    lastPurchasePrice !== null &&
                    lastPurchasePrice > 0 &&
                    Math.abs(currentPrice - lastPurchasePrice) / lastPurchasePrice > 0.1;

                  return (
                    <TableRow key={p.id} className={!p.active ? 'opacity-50' : ''}>
                      {/* Material */}
                      <TableCell>
                        <div className="font-medium text-sm leading-tight">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.sku}</div>
                        {p.color && (
                          <div className="text-xs text-muted-foreground">{p.color}</div>
                        )}
                        {!p.active && (
                          <Badge variant="secondary" className="text-xs h-4 mt-0.5">inativo</Badge>
                        )}
                      </TableCell>

                      {/* Categoria */}
                      <TableCell>
                        <span className="text-xs">{p.category || '—'}</span>
                      </TableCell>

                      {/* Unidade de consumo */}
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs font-mono">
                          {consumptionUnit}
                        </Badge>
                      </TableCell>

                      {/* Unidade de compra */}
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs font-mono">
                          {purchaseUnit}
                        </Badge>
                      </TableCell>

                      {/* Conversão */}
                      <TableCell className="text-center">
                        {conversion !== 1 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs font-mono text-primary font-semibold cursor-default">
                                ×{conversion}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              1 {purchaseUnit} = {conversion} {consumptionUnit}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-xs text-muted-foreground">1:1</span>
                        )}
                      </TableCell>

                      {/* Custo atual (editável) */}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {diverged && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent>
                                Divergência &gt;10% em relação à última NF ({fmt(lastPurchasePrice!)})
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {perm.canEdit ? (
                            <PriceCell
                              productId={p.id}
                              value={currentPrice}
                              onSaved={onPriceSaved}
                            />
                          ) : (
                            <span className="font-mono text-sm">{fmt(currentPrice)}</span>
                          )}
                        </div>
                      </TableCell>

                      {/* Último preço NF */}
                      <TableCell className="text-right font-mono text-sm">
                        {lastPurchasePrice !== null ? fmt(lastPurchasePrice) : (
                          <span className="text-muted-foreground text-xs">sem NF</span>
                        )}
                      </TableCell>

                      {/* Variação */}
                      <TableCell className="text-center">
                        {summary ? (
                          <PriceTrend
                            latest={summary.latest_price}
                            previous={summary.previous_price}
                          />
                        ) : (
                          <Minus className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                        )}
                      </TableCell>

                      {/* Data da última compra */}
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(summary?.last_purchased ?? null)}
                      </TableCell>

                      {/* Fornecedor */}
                      <TableCell className="text-sm text-muted-foreground">
                        {supplierName ?? '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Panel>
        )}
      </div>
    </AppLayout>
  );
}

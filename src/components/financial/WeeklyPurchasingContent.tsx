import { useMemo, useState } from 'react';
import { useOrders } from '@/hooks/useOrders';
import { useComponentSheets } from '@/hooks/useComponentSheets';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { generateWeeklyPurchasingPlan, WeeklyOrder, SheetMaterial, buyByKey, type EngineDemandLine } from '@/lib/weeklyPurchasingPlan';
import { type ComponentSheetCandidate } from '@/lib/materialConsumption';
import { calculateConsumption } from '@/services/consumptionService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, ShoppingCart, Warning as AlertTriangle, TrendUp as TrendingUp, Package, Download, GridFour as LayoutGrid, CalendarBlank as CalendarDays, MagnifyingGlass } from '@phosphor-icons/react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

type PackagingModeRow = { id: string; packaging_mode: string | null };
type TimelineBuyByRow = {
  order_id: string | null;
  material_id: string | null;
  data_limite_compra: string | null;
};
type SoiVariantRow = { id: string; material_variant_id: string | null };
type FloorOrderRow = {
  id: string;
  reference_id: string | null;
  quantity: number | null;
  planned_start: string | null;
  planned_delivery: string | null;
  created_at: string;
  grade: Record<string, number> | null;
  color: string | null;
  sale_order_item_id: string | null;
  sale_order_id: string | null;
  status: string | null;
};

function useAllSheetMaterials() {
  return useQuery({
    queryKey: ['all_sheet_materials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sheet_materials')
        .select('sheet_id, product_id, quantity_per_unit, products(id, name, sku, unit, category, quantity, min_stock, reserved_stock, safety_stock, supplier_lead_time_days, lead_time_days, unit_price, is_artisanal)');
      if (error) throw error;
      return data as unknown as SheetMaterial[];
    },
    staleTime: 60 * 1000,
  });
}

function usePvPackagingModes() {
  return useQuery({
    queryKey: ['weekly_pv_packaging_modes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_orders')
        .select('id, packaging_mode');
      if (error) throw error;
      const map = new Map<string, string | null>();
      for (const r of (data || []) as PackagingModeRow[]) map.set(r.id, r.packaging_mode ?? null);
      return map;
    },
    staleTime: 60 * 1000,
  });
}

function useBuyByDates() {
  return useQuery({
    queryKey: ['weekly_buyby_dates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_projection_timeline')
        .select('order_id, material_id, data_limite_compra');
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of (data || []) as TimelineBuyByRow[]) {
        if (!r.order_id || !r.material_id || !r.data_limite_compra) continue;
        const k = buyByKey(r.order_id, r.material_id);
        const prev = map.get(k);
        if (!prev || r.data_limite_compra < prev) map.set(k, r.data_limite_compra);
      }
      return map;
    },
    staleTime: 60 * 1000,
  });
}

export default function WeeklyPurchasingContent() {
  const { data: orders, isLoading: loadingOrders } = useOrders();
  const { data: componentSheets, isLoading: loadingCS } = useComponentSheets();
  const { data: allSheetMaterials, isLoading: loadingSM } = useAllSheetMaterials();
  const { data: buyByDates } = useBuyByDates();
  const { data: pvPackagingModes } = usePvPackagingModes();
  const { data: variantBySoi } = useQuery({
    queryKey: ['weekly_soi_variants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_order_items')
        .select('id, material_variant_id');
      if (error) throw error;
      const map = new Map<string, string | null>();
      for (const r of (data || []) as SoiVariantRow[]) map.set(r.id, r.material_variant_id ?? null);
      return map;
    },
    staleTime: 60 * 1000,
  });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [viewMode, setViewMode] = useState<'matrix' | 'weekly'>('weekly');
  const [selectedWeek, setSelectedWeek] = useState<string>('all');

  const filteredOrders: WeeklyOrder[] = useMemo(() => {
    if (!orders) return [];
    return (orders as FloorOrderRow[])
      .filter((o) => {
        if (!o.reference_id) return false;
        if (statusFilter === 'active') {
          return !['Finalizado', 'Cancelado', 'Faturado'].includes(o.status ?? '');
        }
        return true;
      })
      .map((o) => ({
        id: o.id,
        reference_id: o.reference_id as string,
        quantity: Number(o.quantity) || 0,
        planned_start: o.planned_start,
        planned_delivery: o.planned_delivery,
        created_at: o.created_at,
        grade: o.grade,
        color: o.color ?? null,
        sale_order_item_id: o.sale_order_item_id ?? null,
        packaging_mode: o.sale_order_id ? (pvPackagingModes?.get(o.sale_order_id) ?? null) : null,
      }));
  }, [orders, statusFilter, pvPackagingModes]);

  const { data: engineDemand, isLoading: loadingEngine } = useQuery({
    queryKey: [
      'weekly-engine-demand',
      filteredOrders.map((o) => `${o.id}:${o.quantity}:${o.color || ''}:${o.sale_order_item_id || ''}`).join('|'),
    ],
    enabled: filteredOrders.length > 0,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<EngineDemandLine[]> => {
      const lines: EngineDemandLine[] = [];
      const summaries = await Promise.all(
        filteredOrders.map(async (order) => {
          if (!order.reference_id) return { order, summary: null as Awaited<ReturnType<typeof calculateConsumption>> | null };
          try {
            const summary = await calculateConsumption({
              referenceId: order.reference_id,
              quantity: Number(order.quantity) || 0,
              color: order.color,
              materialVariantId: order.sale_order_item_id
                ? variantBySoi?.get(order.sale_order_item_id) ?? null
                : null,
              grade: order.grade ?? null,
            });
            return { order, summary };
          } catch (err) {
            console.error('[WeeklyPurchasing] falha no motor canônico da OP', order.id, err);
            return { order, summary: null };
          }
        }),
      );
      const productIds = [...new Set(
        summaries.flatMap(({ summary }) => (summary?.lines || []).map((l) => l.product_id).filter(Boolean)),
      )] as string[];
      const productById = new Map<string, NonNullable<SheetMaterial['products']>>();
      if (productIds.length > 0) {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, sku, unit, category, quantity, min_stock, reserved_stock, safety_stock, supplier_lead_time_days, lead_time_days, unit_price, is_artisanal')
          .in('id', productIds);
        if (error) throw error;
        for (const p of (data || []) as NonNullable<SheetMaterial['products']>[]) productById.set(p.id, p);
      }
      for (const { order, summary } of summaries) {
        if (!summary) continue;
        for (const line of summary.lines) {
          if (!line.product_id || !(Number(line.required) > 0)) continue;
          lines.push({
            orderId: order.id,
            productId: line.product_id,
            required: Number(line.required) || 0,
            unit: line.unit ?? null,
            name: line.product_name,
            category: line.category ?? null,
            product: productById.get(line.product_id) ?? null,
          });
        }
      }
      return lines;
    },
  });

  const isLoading = loadingOrders || loadingCS || loadingSM || (filteredOrders.length > 0 && loadingEngine);

  const result = useMemo(() => {
    if (!allSheetMaterials || filteredOrders.length === 0) return null;
    return generateWeeklyPurchasingPlan(
      filteredOrders,
      allSheetMaterials,
      (componentSheets as Array<ComponentSheetCandidate & { product_id: string }> | undefined) || [],
      buyByDates || new Map(),
      engineDemand ?? null,
    );
  }, [filteredOrders, allSheetMaterials, componentSheets, buyByDates, engineDemand]);

  const filteredPlan = useMemo(() => {
    if (!result) return [];
    if (!search.trim()) return result.plan;
    return result.plan.filter((r) => searchMatchesAllTerms(search, r.name, r.sku));
  }, [result, search]);

  const weeklyReports = useMemo(() => {
    if (!result) return [] as { week: string; rows: { materialId: string; name: string; sku: string; unit: string; qty: number; unitPrice: number; cost: number; currentStock: number }[]; totalCost: number; totalItems: number }[];
    const weekToRows = new Map<string, { materialId: string; name: string; sku: string; unit: string; qty: number; unitPrice: number; cost: number; currentStock: number }[]>();
    for (const w of result.sortedWeeks) weekToRows.set(w, []);
    for (const row of filteredPlan) {
      for (const [w, qty] of Object.entries(row.weeklyPurchases)) {
        if (!qty || qty <= 0) continue;
        const arr = weekToRows.get(w) || [];
        arr.push({
          materialId: row.materialId,
          name: row.name,
          sku: row.sku,
          unit: row.unit,
          qty,
          unitPrice: row.unitPrice,
          cost: qty * row.unitPrice,
          currentStock: row.currentStock,
        });
        weekToRows.set(w, arr);
      }
    }
    return result.sortedWeeks
      .map((w) => {
        const rows = (weekToRows.get(w) || []).sort((a, b) => b.cost - a.cost);
        return {
          week: w,
          rows,
          totalCost: rows.reduce((s, r) => s + r.cost, 0),
          totalItems: rows.length,
        };
      })
      .filter((r) => r.rows.length > 0);
  }, [result, filteredPlan]);

  const visibleWeeklyReports = useMemo(() => {
    if (selectedWeek === 'all') return weeklyReports;
    return weeklyReports.filter((r) => r.week === selectedWeek);
  }, [weeklyReports, selectedWeek]);

  const totals = useMemo(() => {
    if (!filteredPlan.length) return { materials: 0, cost: 0, criticalCount: 0 };
    return {
      materials: filteredPlan.length,
      cost: filteredPlan.reduce((s, r) => s + r.estimatedCost, 0),
      criticalCount: filteredPlan.filter((r) => r.currentStock <= 0).length,
    };
  }, [filteredPlan]);

  const formatNumber = (n: number) =>
    n % 1 === 0 ? n.toLocaleString('pt-BR') : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatCurrency = (n: number) =>
    n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const exportWeeklyCSV = () => {
    const lines: string[] = [];
    lines.push(['Semana', 'Material', 'SKU', 'Unid.', 'Qtd a Comprar', 'Estoque Atual', 'Preço Unit.', 'Custo Estimado'].join(';'));
    for (const wr of visibleWeeklyReports) {
      for (const r of wr.rows) {
        lines.push([
          wr.week,
          `"${r.name.replace(/"/g, '""')}"`,
          r.sku || '',
          r.unit || '',
          formatNumber(r.qty),
          formatNumber(r.currentStock),
          formatCurrency(r.unitPrice),
          formatCurrency(r.cost),
        ].join(';'));
      }
      lines.push(['', '', '', '', '', '', `TOTAL ${wr.week}`, formatCurrency(wr.totalCost)].join(';'));
      lines.push('');
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plano-semanal-compras-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Package className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Materiais com Necessidade</p>
              <p className="display text-2xl tabular-nums">{totals.materials}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Custo Estimado Total</p>
              <p className="display text-2xl tabular-nums">{formatCurrency(totals.cost)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <div>
              <p className="text-sm text-muted-foreground">Estoque Zerado</p>
              <p className="display text-2xl tabular-nums">{totals.criticalCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <ShoppingCart className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Semanas Planejadas</p>
              <p className="display text-2xl tabular-nums">{result?.sortedWeeks.length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-muted/20 border-primary/20">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" /> Compra just-in-time
          </p>
          <p>
            • A semana de cada material é a <strong>data-limite de compra</strong>: prazo de entrega do
            cliente − cronograma de produção (setores) − lead time do fornecedor. Compre nela pra o
            material chegar <strong>pouco antes</strong> do ciclo começar — <strong>nem antes</strong> (capital
            parado) <strong>nem depois</strong> (atraso na produção).
          </p>
          <p>
            • A quantidade já é <strong>líquida</strong>: abate o que está em estoque, reservado e a margem de
            segurança. Materiais com prazo vencido caem na <strong>próxima terça</strong> (comprar já).
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por material ou SKU…"
          resultCount={filteredPlan.length}
          totalCount={result?.plan.length}
          className="w-full max-w-sm"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Apenas OPs Ativas</SelectItem>
            <SelectItem value="all">Todas as OPs</SelectItem>
          </SelectContent>
        </Select>
        {viewMode === 'weekly' && (
          <>
            <Select value={selectedWeek} onValueChange={setSelectedWeek}>
              <SelectTrigger className="w-[220px]">
                <CalendarDays className="h-4 w-4 mr-1" />
                <SelectValue placeholder="Semana" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as semanas</SelectItem>
                {weeklyReports.map((w) => (
                  <SelectItem key={w.week} value={w.week}>
                    Semana de {w.week}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportWeeklyCSV} disabled={!visibleWeeklyReports.length}>
              <Download className="h-4 w-4 mr-1" /> Exportar CSV
            </Button>
          </>
        )}
      </div>

      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'matrix' | 'weekly')}>
        <TabsList>
          <TabsTrigger value="weekly" className="gap-1.5">
            <CalendarDays className="h-4 w-4" /> Relatório por Semana
          </TabsTrigger>
          <TabsTrigger value="matrix" className="gap-1.5">
            <LayoutGrid className="h-4 w-4" /> Matriz Consolidada
          </TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="space-y-4 mt-4">
          {visibleWeeklyReports.length === 0 ? (
            <Card>
              <CardContent className="p-8">
                {search.trim() ? (
                  <EmptyState
                    size="sm"
                    icon={MagnifyingGlass}
                    title={`Nenhum resultado para "${search}"`}
                    action={
                      <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                        Limpar busca
                      </Button>
                    }
                  />
                ) : (
                  <p className="text-center text-muted-foreground">
                    Nenhuma necessidade de compra identificada para os filtros selecionados.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            visibleWeeklyReports.map((wr) => (
              <Card key={wr.week}>
                <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                   <div className="flex items-center gap-2">
                     <CalendarDays className="h-5 w-5 text-primary" />
                     <CardTitle className="text-base">Sugestão de Compra para Terça {wr.week}</CardTitle>
                   </div>
                  <div className="flex gap-2">
                    <Badge variant="secondary">{wr.totalItems} itens</Badge>
                    <Badge className="bg-primary text-primary-foreground">{formatCurrency(wr.totalCost)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Material</TableHead>
                        <TableHead className="text-right">Unid.</TableHead>
                        <TableHead className="text-right">Estoque</TableHead>
                        <TableHead className="text-right">Qtd. Comprar</TableHead>
                        <TableHead className="text-right">Preço Unit.</TableHead>
                        <TableHead className="text-right">Custo Est.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {wr.rows.map((r) => (
                        <TableRow key={r.materialId}>
                          <TableCell>
                            <div>
                              <span className="font-medium text-sm">{r.name}</span>
                              {r.sku && <span className="block text-xs text-muted-foreground">{r.sku}</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-xs">{r.unit}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={r.currentStock <= 0 ? 'destructive' : 'secondary'}>
                              {formatNumber(r.currentStock)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-bold">{formatNumber(r.qty)}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">{formatCurrency(r.unitPrice)}</TableCell>
                          <TableCell className="text-right font-medium text-primary">{formatCurrency(r.cost)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="matrix" className="mt-4">
          {filteredPlan.length === 0 ? (
            <Card>
              <CardContent className="p-8">
                {search.trim() ? (
                  <EmptyState
                    size="sm"
                    icon={MagnifyingGlass}
                    title={`Nenhum resultado para "${search}"`}
                    action={
                      <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                        Limpar busca
                      </Button>
                    }
                  />
                ) : (
                  <p className="text-center text-muted-foreground">
                    Nenhuma necessidade de compra identificada para os filtros selecionados.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Matriz de Compras por Semana</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[70vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background z-10 min-w-[200px]">Material</TableHead>
                        <TableHead className="text-right">Unid.</TableHead>
                        <TableHead className="text-right">Estoque Atual</TableHead>
                        {result?.sortedWeeks.map((w) => (
                          <TableHead key={w} className="text-center min-w-[120px]">Sem. {w}</TableHead>
                        ))}
                        <TableHead className="text-right font-bold">Total Comprar</TableHead>
                        <TableHead className="text-right font-bold">Custo Est.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPlan.map((row) => (
                        <TableRow key={row.materialId}>
                          <TableCell className="sticky left-0 bg-background z-10">
                            <div>
                              <span className="font-medium text-sm">{row.name}</span>
                              {row.sku && <span className="block text-xs text-muted-foreground">{row.sku}</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-xs">{row.unit}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={row.currentStock <= 0 ? 'destructive' : 'secondary'}>
                              {formatNumber(row.currentStock)}
                            </Badge>
                          </TableCell>
                          {result?.sortedWeeks.map((w) => {
                            const val = row.weeklyPurchases[w] || 0;
                            return (
                              <TableCell key={w} className="text-center">
                                {val > 0 ? (
                                  <Badge variant="destructive" className="text-xs">{formatNumber(val)}</Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right font-bold">{formatNumber(row.totalToBuy)}</TableCell>
                          <TableCell className="text-right font-medium text-primary">{formatCurrency(row.estimatedCost)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

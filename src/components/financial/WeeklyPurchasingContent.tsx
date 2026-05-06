import { useMemo, useState } from 'react';
import { useOrders } from '@/hooks/useOrders';
import { useComponentSheets } from '@/hooks/useComponentSheets';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { generateWeeklyPurchasingPlan, WeeklyOrder, SheetMaterial } from '@/lib/weeklyPurchasingPlan';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShoppingCart, AlertTriangle, TrendingUp, Package, Download, LayoutGrid, CalendarDays } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

function useAllSheetMaterials() {
  return useQuery({
    queryKey: ['all_sheet_materials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sheet_materials')
        .select('sheet_id, product_id, quantity_per_unit, consumption_per_size, products(id, name, sku, unit, quantity, unit_price, is_artisanal)');
      if (error) throw error;
      return data as unknown as SheetMaterial[];
    },
    staleTime: 60 * 1000,
  });
}

export default function WeeklyPurchasingContent() {
  const { data: orders, isLoading: loadingOrders } = useOrders();
  const { data: componentSheets, isLoading: loadingCS } = useComponentSheets();
  const { data: allSheetMaterials, isLoading: loadingSM } = useAllSheetMaterials();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [viewMode, setViewMode] = useState<'matrix' | 'weekly'>('weekly');
  const [selectedWeek, setSelectedWeek] = useState<string>('all');

  const isLoading = loadingOrders || loadingCS || loadingSM;

  const result = useMemo(() => {
    if (!orders || !allSheetMaterials) return null;

    const filteredOrders: WeeklyOrder[] = (orders as any[])
      .filter((o) => {
        if (statusFilter === 'active') {
          return !['Finalizado', 'Cancelado', 'Faturado'].includes(o.status);
        }
        return true;
      })
      .map((o) => ({
        id: o.id,
        reference_id: o.reference_id,
        quantity: o.quantity,
        planned_start: o.planned_start,
        planned_delivery: o.planned_delivery,
        created_at: o.created_at,
        grade: o.grade as Record<string, number> | null,
      }));

    const wastePctMap: Record<string, number> = {};
    if (componentSheets) {
      for (const cs of componentSheets) {
        wastePctMap[cs.product_id] = cs.waste_pct || 0;
      }
    }

    return generateWeeklyPurchasingPlan(filteredOrders, allSheetMaterials, wastePctMap);
  }, [orders, allSheetMaterials, componentSheets, statusFilter]);

  const filteredPlan = useMemo(() => {
    if (!result) return [];
    if (!search.trim()) return result.plan;
    const q = search.toLowerCase();
    return result.plan.filter(
      (r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)
    );
  }, [result, search]);

  // Per-week aggregated rows for the "weekly" view
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
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Package className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Materiais com Necessidade</p>
              <p className="text-2xl font-bold">{totals.materials}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Custo Estimado Total</p>
              <p className="text-2xl font-bold">{formatCurrency(totals.cost)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <div>
              <p className="text-sm text-muted-foreground">Estoque Zerado</p>
              <p className="text-2xl font-bold">{totals.criticalCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <ShoppingCart className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Semanas Planejadas</p>
              <p className="text-2xl font-bold">{result?.sortedWeeks.length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <Input
          placeholder="Buscar material por nome ou SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
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

        {/* WEEKLY REPORT */}
        <TabsContent value="weekly" className="space-y-4 mt-4">
          {visibleWeeklyReports.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Nenhuma necessidade de compra identificada para os filtros selecionados.
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

        {/* MATRIX VIEW (kept) */}
        <TabsContent value="matrix" className="mt-4">
          {filteredPlan.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Nenhuma necessidade de compra identificada para os filtros selecionados.
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

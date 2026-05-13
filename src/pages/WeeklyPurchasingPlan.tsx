import React, { useMemo, useState } from 'react';
import { useOrders } from '@/hooks/useOrders';
import { useProducts } from '@/hooks/useProducts';
import { useTechnicalSheets, useSheetMaterials } from '@/hooks/useTechnicalSheets';
import { useComponentSheets } from '@/hooks/useComponentSheets';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { generateWeeklyPurchasingPlan, WeeklyOrder, SheetMaterial, MaterialPlanRow } from '@/lib/weeklyPurchasingPlan';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, ShoppingCart, Warning as AlertTriangle, TrendUp as TrendingUp, Package } from '@phosphor-icons/react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

function useAllSheetMaterials() {
  return useQuery({
    queryKey: ['all_sheet_materials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sheet_materials')
        .select('sheet_id, product_id, quantity_per_unit, consumption_per_size, products(id, name, sku, unit, quantity, min_stock, unit_price, is_artisanal)');
      if (error) throw error;
      return data as unknown as SheetMaterial[];
    },
    staleTime: 60 * 1000,
  });
}

export default function WeeklyPurchasingPlan() {
  const { data: orders, isLoading: loadingOrders, isError: errorOrders } = useOrders();
  const { data: componentSheets, isLoading: loadingCS, isError: errorCS } = useComponentSheets();
  const { data: allSheetMaterials, isLoading: loadingSM, isError: errorSM } = useAllSheetMaterials();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('active');

  const isLoading = loadingOrders || loadingCS || loadingSM;
  const isError = errorOrders || errorCS || errorSM;

  const result = useMemo(() => {
    if (!orders || !allSheetMaterials) return null;

    // Filter orders based on status
    const filteredOrders: WeeklyOrder[] = (orders as any[])
      .filter((o) => {
        if (statusFilter === 'active') {
          const s = (o.status || '').toLowerCase();
          return !['finalizado', 'cancelado', 'cancelada', 'faturado', 'completed', 'cancelled'].includes(s);
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

    // Mapeamento de quebra por ficha técnica (referência)
    const sheetWasteMap: Record<string, number> = {};
    if (componentSheets) {
      for (const cs of componentSheets) {
        sheetWasteMap[cs.id] = cs.waste_pct || 0;
      }
    }

    return generateWeeklyPurchasingPlan(filteredOrders, allSheetMaterials, sheetWasteMap);
  }, [orders, allSheetMaterials, componentSheets, statusFilter]);

  const filteredPlan = useMemo(() => {
    if (!result) return [];
    if (!search.trim()) return result.plan;
    const q = search.toLowerCase();
    return result.plan.filter(
      (r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)
    );
  }, [result, search]);

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="font-semibold text-foreground">Falha ao carregar dados</p>
        <p className="text-sm text-muted-foreground">Verifique sua conexão e recarregue a página.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Plano Semanal de Compras</h1>
        <p className="text-muted-foreground">
          Motor cascata: simula consumo semana a semana e indica o que comprar
        </p>
      </div>

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
      <div className="flex flex-col sm:flex-row gap-3">
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
      </div>

      {/* Main Table */}
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
                      <TableHead key={w} className="text-center min-w-[120px]">
                        Sem. {w}
                      </TableHead>
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
                          {row.sku && (
                            <span className="block text-xs text-muted-foreground">{row.sku}</span>
                          )}
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
                              <Badge variant="destructive" className="text-xs">
                                {formatNumber(val)}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-bold">
                        {formatNumber(row.totalToBuy)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-primary">
                        {formatCurrency(row.estimatedCost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

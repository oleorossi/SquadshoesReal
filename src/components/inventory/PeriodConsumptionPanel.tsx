import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatsCard } from '@/components/inventory/StatsCard';
import { TrendingDown, Package, AlertTriangle, DollarSign, Loader2, AlertCircle, CheckCircle2, ShoppingCart } from 'lucide-react';
import { Product } from '@/types/inventory';

interface ConsumedMaterial {
  productId: string;
  name: string;
  color: string;
  unit: string;
  totalNeeded: number;
  stockAvailable: number;
  unitPrice: number;
  totalCost: number;
  deficit: number;
  wasteUsed: number;
}

function useOrdersInPeriod(from: string, to: string) {
  return useQuery({
    queryKey: ['orders_period', from, to],
    enabled: !!from && !!to && from <= to,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, reference_id, quantity, status, created_at')
        .gte('created_at', `${from}T00:00:00`)
        .lte('created_at', `${to}T23:59:59`)
        .in('status', ['Rascunho', 'Reservado', 'Em Produção'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });
}

function useSheetMaterialsForReferences(referenceIds: string[]) {
  return useQuery({
    queryKey: ['sheet_materials_bulk', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      const sheetsResult: any = await (supabase
        .from('technical_sheets' as any)
        .select('id, reference_id')
        .in('reference_id', referenceIds));
      const sheets = (sheetsResult.data || []) as { id: string; reference_id: string }[];

      if (!sheets.length) return [];

      const sheetIds = sheets.map(s => s.id);
      const sheetRefMap = new Map(sheets.map(s => [s.id, s.reference_id]));

      const matsResult: any = await supabase
        .from('sheet_materials')
        .select('sheet_id, product_id, quantity_per_unit, color, group_id, products(id, name, unit, sku, quantity, unit_price, color, waste_pct)')
        .in('sheet_id', sheetIds);
      const materials = (matsResult.data || []) as any[];

      return (materials || []).map(m => ({
        ...m,
        reference_id: sheetRefMap.get(m.sheet_id),
      }));
    },
    staleTime: 60_000,
  });
}

export default function PeriodConsumptionPanel({ products }: { products: Product[] }) {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);

  const { data: orders = [], isLoading: loadingOrders } = useOrdersInPeriod(dateFrom, dateTo);

  const referenceIds = useMemo(() =>
    [...new Set(orders.map(o => o.reference_id).filter(Boolean))] as string[],
    [orders]
  );

  const { data: sheetMaterials = [], isLoading: loadingMaterials } = useSheetMaterialsForReferences(referenceIds);

  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach(p => map.set(p.id, p));
    return map;
  }, [products]);

  const consumptionData = useMemo(() => {
    if (!orders.length || !sheetMaterials.length) return [];

    const matsByRef = new Map<string, typeof sheetMaterials>();
    sheetMaterials.forEach(m => {
      const refId = m.reference_id;
      if (!refId) return;
      const arr = matsByRef.get(refId) || [];
      arr.push(m);
      matsByRef.set(refId, arr);
    });

    const needs = new Map<string, ConsumedMaterial>();

    orders.forEach(order => {
      if (!order.reference_id) return;
      const mats = matsByRef.get(order.reference_id) || [];

      mats.forEach(mat => {
        const productId = mat.product_id;
        if (!productId) return;

        const qtyPerUnit = Number(mat.quantity_per_unit) || 0;
        const prod = mat.products || productMap.get(productId);
        
        // Use individual waste_pct from the product master record (default 0%)
        const individualWaste = Number(prod?.waste_pct) || 0;
        const multiplier = 1 + (individualWaste / 100);
        const totalNeeded = qtyPerUnit * (Number(order.quantity) || 0) * multiplier;

        const unitPrice = Number(prod?.unit_price) || 0;
        const stock = Number(prod?.quantity) || 0;

        const existing = needs.get(productId);
        if (existing) {
          existing.totalNeeded += totalNeeded;
          existing.totalCost += totalNeeded * unitPrice;
          existing.deficit = Math.max(0, existing.totalNeeded - existing.stockAvailable);
        } else {
          needs.set(productId, {
            productId,
            name: prod?.name || 'Desconhecido',
            color: mat.color || prod?.color || '',
            unit: prod?.unit || 'un',
            totalNeeded,
            stockAvailable: stock,
            unitPrice,
            totalCost: totalNeeded * unitPrice,
            deficit: Math.max(0, totalNeeded - stock),
            wasteUsed: individualWaste,
          });
        }
      });
    });

    return Array.from(needs.values()).sort((a, b) => b.totalCost - a.totalCost);
  }, [orders, sheetMaterials, productMap]);

  const totalCost = consumptionData.reduce((s, c) => s + c.totalCost, 0);
  const deficitCount = consumptionData.filter(c => c.deficit > 0).length;
  const totalFinancialNeed = consumptionData.reduce((acc, item) => {
    return acc + (item.deficit > 0 ? item.deficit * item.unitPrice : 0);
  }, 0);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const isLoading = loadingOrders || loadingMaterials;

  return (
    <div className="space-y-6">
      {/* Date range filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
        <div>
          <Label className="text-xs text-muted-foreground">De</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40 mt-1" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Até</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40 mt-1" />
        </div>
        <Badge variant="outline" className="text-xs h-8 px-3">
          {orders.length} OP(s) no período
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatsCard title="Custo Total Estimado" value={formatCurrency(totalCost)} icon={DollarSign} variant="success" />
        <StatsCard title="Materiais Necessários" value={consumptionData.length} icon={Package} />
        <StatsCard
          title="Itens a Comprar"
          value={deficitCount}
          icon={ShoppingCart}
          variant={deficitCount > 0 ? 'warning' : 'default'}
          subtitle={deficitCount > 0 ? formatCurrency(totalFinancialNeed) : 'Estoque OK'}
        />
        <StatsCard
          title="Pares no Período"
          value={orders.reduce((acc: number, o: any) => acc + (Number(o.quantity) || 0), 0)}
          icon={Package}
        />
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-primary" />
            Balanço de Materiais para Produção
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : consumptionData.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>Nenhum pedido encontrado para o período selecionado.</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Material</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead className="text-right">Perda</TableHead>
                    <TableHead className="text-right">Necessário</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-right">Custo Est.</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consumptionData.map(item => {
                    const balance = item.stockAvailable - item.totalNeeded;
                    const isCritical = balance < 0;

                    return (
                      <TableRow key={item.productId}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          {item.color ? <Badge variant="secondary" className="text-xs">{item.color}</Badge> : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {item.wasteUsed}%
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {item.totalNeeded.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {item.unit}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {item.stockAvailable.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${isCritical ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                          {balance.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(item.totalCost)}
                        </TableCell>
                        <TableCell className="text-center">
                          {isCritical ? (
                            <Badge variant="destructive" className="text-xs gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Comprar {Math.abs(balance).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs gap-1 text-green-600 border-green-300">
                              <CheckCircle2 className="h-3 w-3" /> Disponível
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

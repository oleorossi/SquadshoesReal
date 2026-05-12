import { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ChartBar as BarChart3, TrendDown as TrendingDown, Package, CalendarBlank as CalendarDays, ArrowRight } from '@phosphor-icons/react';

type Movement = {
  id: string;
  product_id: string;
  movement_type: string;
  quantity: number;
  description: string | null;
  created_at: string;
  products: { name: string; sku: string; unit: string } | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  movements: Movement[];
}

function getWeekRange(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export default function StrapSummaryDialog({ open, onOpenChange, movements }: Props) {
  // Fetch pending/approved sale orders for projections
  const { data: pendingOrders = [] } = useQuery({
    queryKey: ['strap_projection_orders'],
    enabled: open,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_order_items')
        .select('quantity, strap_colors, sale_orders!inner(status, planned_delivery)')
        .not('strap_colors', 'is', null);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Current strap stock
  const { data: strapProducts = [] } = useQuery({
    queryKey: ['strap_products_stock'],
    enabled: open,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, quantity, unit, group_id, color')
        .eq('active', true)
        .ilike('name', '%tira%');
      if (error) throw error;
      return data || [];
    },
  });

  const now = new Date();
  const thisWeek = getWeekRange(now);
  const nextWeekStart = new Date(thisWeek.end);
  nextWeekStart.setDate(nextWeekStart.getDate() + 1);
  const nextWeek = getWeekRange(nextWeekStart);
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  const stats = useMemo(() => {
    const weekMovements = movements.filter(m => {
      const d = new Date(m.created_at);
      return d >= thisWeek.start && d <= thisWeek.end;
    });

    const totalConsumedWeek = weekMovements
      .filter(m => m.movement_type === 'out')
      .reduce((sum, m) => sum + Number(m.quantity), 0);

    const totalReturnsWeek = weekMovements
      .filter(m => m.movement_type !== 'out')
      .reduce((sum, m) => sum + Number(m.quantity), 0);

    // Group by material
    const byMaterial: Record<string, { name: string; consumed: number; unit: string }> = {};
    weekMovements.filter(m => m.movement_type === 'out').forEach(m => {
      const key = m.product_id;
      if (!byMaterial[key]) {
        byMaterial[key] = { name: m.products?.name || '—', consumed: 0, unit: m.products?.unit || '' };
      }
      byMaterial[key].consumed += Number(m.quantity);
    });

    const topMaterials = Object.values(byMaterial).sort((a, b) => b.consumed - a.consumed);

    return { totalConsumedWeek, totalReturnsWeek, weekMovements: weekMovements.length, topMaterials };
  }, [movements, thisWeek.start, thisWeek.end]);

  // Projections based on pending orders
  const projections = useMemo(() => {
    let nextWeekDemand = 0;
    let nextMonthDemand = 0;

    pendingOrders.forEach((item: any) => {
      const so = item.sale_orders;
      if (!so || (so.status !== 'approved' && so.status !== 'pending')) return;
      const straps = item.strap_colors as any[];
      if (!Array.isArray(straps) || straps.length === 0) return;
      const delivery = so.planned_delivery ? new Date(so.planned_delivery) : null;

      const strapQty = straps.reduce((sum: number, s: any) => {
        const consumptionCm = Number(s.consumption) || 1;
        // Convert cm to meters for reporting
        return sum + (consumptionCm * Number(item.quantity)) / 100;
      }, 0);

      if (delivery && delivery >= nextWeek.start && delivery <= nextWeek.end) {
        nextWeekDemand += strapQty;
      }
      if (delivery && delivery >= now && delivery <= nextMonthEnd) {
        nextMonthDemand += strapQty;
      }
    });

    const totalStrapStock = strapProducts.reduce((sum, p) => sum + Number(p.quantity), 0);

    return { nextWeekDemand, nextMonthDemand, totalStrapStock };
  }, [pendingOrders, strapProducts, nextWeek.start, nextWeek.end, now, nextMonthEnd]);

  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const fmtDate = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Resumo Semanal — Tiras
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-xs text-muted-foreground font-normal">Consumo Semana</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <p className="text-xl font-bold text-destructive">{fmt(stats.totalConsumedWeek)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-xs text-muted-foreground font-normal">Estornos Semana</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <p className="text-xl font-bold text-emerald-600">{fmt(stats.totalReturnsWeek)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-xs text-muted-foreground font-normal">Movimentações</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <p className="text-xl font-bold">{stats.weekMovements}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-xs text-muted-foreground font-normal">Estoque Atual (Tiras)</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <p className="text-xl font-bold">{fmt(projections.totalStrapStock)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Top materials */}
          {stats.topMaterials.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                Materiais mais consumidos ({fmtDate(thisWeek.start)} — {fmtDate(thisWeek.end)})
              </h3>
              <div className="rounded-lg border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="font-semibold">Material</TableHead>
                      <TableHead className="font-semibold text-right">Consumo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.topMaterials.slice(0, 10).map((mat, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{mat.name}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(mat.consumed)} {mat.unit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Projections */}
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Projeções de Demanda
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Card className="border-dashed">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs text-muted-foreground font-normal flex items-center gap-1">
                    <ArrowRight className="h-3 w-3" />
                    Próxima Semana ({fmtDate(nextWeek.start)} — {fmtDate(nextWeek.end)})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 flex items-baseline gap-2">
                  <p className="text-xl font-bold">{fmt(projections.nextWeekDemand)} m</p>
                  <span className="text-xs text-muted-foreground">demanda projetada</span>
                  {projections.nextWeekDemand > projections.totalStrapStock && (
                    <Badge variant="destructive" className="text-[10px] ml-auto">Estoque insuficiente</Badge>
                  )}
                </CardContent>
              </Card>
              <Card className="border-dashed">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs text-muted-foreground font-normal flex items-center gap-1">
                    <ArrowRight className="h-3 w-3" />
                    Próximo Mês (até {fmtDate(nextMonthEnd)})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 flex items-baseline gap-2">
                  <p className="text-xl font-bold">{fmt(projections.nextMonthDemand)} m</p>
                  <span className="text-xs text-muted-foreground">demanda projetada</span>
                  {projections.nextMonthDemand > projections.totalStrapStock && (
                    <Badge variant="destructive" className="text-[10px] ml-auto">Estoque insuficiente</Badge>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Stock overview */}
          {strapProducts.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Package className="h-4 w-4" />
                Estoque Atual de Tiras
              </h3>
              <div className="rounded-lg border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="font-semibold">Material</TableHead>
                      <TableHead className="font-semibold">Cor</TableHead>
                      <TableHead className="font-semibold text-right">Estoque</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {strapProducts
                      .sort((a, b) => Number(a.quantity) - Number(b.quantity))
                      .map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.color || '—'}</TableCell>
                          <TableCell className="text-right font-mono">
                            <span className={Number(p.quantity) <= 0 ? 'text-destructive font-bold' : ''}>
                              {fmt(Number(p.quantity))} {p.unit}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

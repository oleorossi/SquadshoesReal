import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MagnifyingGlass as Search, Package, Warning as AlertTriangle, TrendDown as TrendingDown, Funnel as Filter } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { startOfWeek, endOfWeek, addWeeks } from 'date-fns';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { normalizeForSearch } from '@/lib/searchUtils';

const fmtQty = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

interface MaterialBalance {
  key: string;
  name: string;
  type: string;
  unit: string;
  current_stock: number;
  weeks: { week_label: string; consumption: number; balance: number }[];
  final_balance: number;
}

export default function SaldoFinalTab() {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<MaterialBalance[]>([]);
  const [allWeekLabels, setAllWeekLabels] = useState<string[]>([]);
  const [selectedWeeks, setSelectedWeeks] = useState<Set<string>>(new Set());

  useEffect(() => { fetchData(); }, []);

  // When allWeekLabels load, default to all selected
  useEffect(() => {
    if (allWeekLabels.length > 0 && selectedWeeks.size === 0) {
      setSelectedWeeks(new Set(allWeekLabels));
    }
  }, [allWeekLabels]);

  async function fetchData() {
    setLoading(true);
    try {
      const parseDateValue = (value?: string | null) => {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      };

      const { data: orders = [] } = await supabase
        .from('orders')
        .select(`
          id, order_number, quantity, status, planned_delivery, reference_id,
          sale_orders!orders_sale_order_id_fkey(delivery_deadline, delivery_week, delivery_month)
        `)
        // Status REAIS de orders no backend (audit 2026-05): 'Pronto' não existe.
        .in('status', ['Reservado', 'Em Produção'])
        .order('planned_delivery', { ascending: true });

      const refIds = [...new Set((orders as any[]).map(o => o.reference_id).filter(Boolean))];
      if (refIds.length === 0) { setBalances([]); setLoading(false); return; }

      const [sheetsRes, productsRes] = await Promise.all([
        supabase.from('technical_sheets').select('id, name, upper_material, upper_consumption, lining_material, lining_consumption, insole_material, insole_consumption, sole_material, sole_consumption, sole_type, direct_components, consumption_loss_pct').in('id', refIds),
        supabase.from('products').select('id, name, quantity, unit, group_id'),
      ]);

      const sheetsMap = new Map(((sheetsRes.data ?? []) as any[]).map(s => [s.id, s]));
      const productRows = (productsRes.data ?? []) as any[];
      const pMap = new Map(productRows.map(p => [p.id, p]));

      // Group stock map (sum stock of all products within a group)
      const { data: groupsData = [] } = await supabase.from('product_groups').select('id, name');
      const groupNameMap = new Map<string, string>();
      for (const g of groupsData as any[]) groupNameMap.set(g.name?.toLowerCase(), g.id);

      const groupStockMap = new Map<string, { total_stock: number; unit: string }>();
      for (const p of productRows) {
        if (!p.group_id) continue;
        const existing = groupStockMap.get(p.group_id) || { total_stock: 0, unit: '' };
        existing.total_stock += Number(p.quantity) || 0;
        if (!existing.unit) existing.unit = p.unit || 'un';
        groupStockMap.set(p.group_id, existing);
      }

      function resolveMaterial(materialName: string): { stock: number; unit: string } {
        if (!materialName) return { stock: 0, unit: 'un' };
        const nameLower = materialName.toLowerCase().trim();

        const groupId = groupNameMap.get(nameLower);
        if (groupId) {
          const info = groupStockMap.get(groupId);
          if (info) return { stock: info.total_stock, unit: info.unit || 'un' };
        }
        for (const [gName, gId] of groupNameMap) {
          if (gName.includes(nameLower) || nameLower.includes(gName)) {
            const info = groupStockMap.get(gId);
            if (info) return { stock: info.total_stock, unit: info.unit || 'un' };
          }
        }
        let totalStock = 0, count = 0, foundUnit = 'un';
        for (const p of productRows) {
          const pName = p.name?.toLowerCase() || '';
          if (pName === nameLower || pName.startsWith(nameLower + ':') || pName.startsWith(nameLower + ' ')) {
            totalStock += Number(p.quantity) || 0;
            count++;
            if (count === 1) foundUnit = p.unit || 'un';
          }
        }
        if (count > 0) return { stock: totalStock, unit: foundUnit };
        return { stock: 0, unit: 'un' };
      }

      const today = new Date();
      const materialWeeklyMap = new Map<string, {
        name: string; type: string; unit: string; current_stock: number;
        weeks: Map<string, number>;
      }>();
      const weekLabelsSet = new Set<string>();

      for (const order of orders as any[]) {
        const sheet = sheetsMap.get(order.reference_id);
        if (!sheet) continue;

        const saleOrder = Array.isArray(order.sale_orders) ? order.sale_orders[0] : order.sale_orders;
        const deliveryDate = order.planned_delivery || saleOrder?.delivery_deadline || null;
        const deliveryDateObj = parseDateValue(deliveryDate) ?? addWeeks(today, 4);
        const ws = startOfWeek(deliveryDateObj, { weekStartsOn: 1 });
        const we = endOfWeek(deliveryDateObj, { weekStartsOn: 1 });
        const weekLabel = `${format(ws, 'dd/MM', { locale: ptBR })} - ${format(we, 'dd/MM', { locale: ptBR })}`;
        weekLabelsSet.add(weekLabel);

        const qty = Number(order.quantity) || 0;
        const lossPct = Number(sheet.consumption_loss_pct) || 5;
        const lossFactor = 1 + lossPct / 100;

        const addMaterial = (materialName: string, type: string, consumptionPerPair: number, applyLoss: boolean, productId?: string | null) => {
          if (!materialName || consumptionPerPair <= 0) return;
          const key = `${materialName.toLowerCase()}_${type}`;

          let resolved: { stock: number; unit: string };
          if (productId) {
            const p = pMap.get(productId);
            resolved = { stock: Number(p?.quantity) || 0, unit: p?.unit || 'un' };
          } else {
            resolved = resolveMaterial(materialName);
          }

          // Consumption in same unit as stock (technical sheet unit = stock unit)
          const totalConsumption = consumptionPerPair * qty * (applyLoss ? lossFactor : 1);

          if (!materialWeeklyMap.has(key)) {
            materialWeeklyMap.set(key, {
              name: materialName, type, unit: resolved.unit,
              current_stock: resolved.stock,
              weeks: new Map(),
            });
          }
          const entry = materialWeeklyMap.get(key)!;
          entry.weeks.set(weekLabel, (entry.weeks.get(weekLabel) || 0) + totalConsumption);
        };

        if (sheet.upper_consumption > 0) addMaterial(sheet.upper_material || 'Cabedal', 'Cabedal', sheet.upper_consumption, true);
        if (sheet.lining_consumption > 0) addMaterial(sheet.lining_material || 'Forração', 'Forração', sheet.lining_consumption, true);
        if (sheet.insole_consumption > 0) addMaterial(sheet.insole_material || 'Palmilha', 'Palmilha', sheet.insole_consumption, true);
        if (sheet.sole_consumption > 0) addMaterial(sheet.sole_material || sheet.sole_type || 'Solado', 'Solado', sheet.sole_consumption, false);

        if (Array.isArray(sheet.direct_components)) {
          for (const comp of sheet.direct_components as any[]) {
            addMaterial(comp.product_name || 'Componente', 'Componente', Number(comp.quantity) || 0, false, comp.product_id);
          }
        }
      }

      const sortedWeeks = [...weekLabelsSet].sort((a, b) => {
        const parseWeekStart = (label: string) => {
          const parts = label.split(' - ')[0].split('/');
          return new Date(today.getFullYear(), Number(parts[1]) - 1, Number(parts[0]));
        };
        return parseWeekStart(a).getTime() - parseWeekStart(b).getTime();
      });
      setAllWeekLabels(sortedWeeks);

      // Build cascading balances
      const results: MaterialBalance[] = [];
      for (const [key, entry] of materialWeeklyMap) {
        let runningBalance = entry.current_stock;
        const weeks: MaterialBalance['weeks'] = [];

        for (const wl of sortedWeeks) {
          const consumption = entry.weeks.get(wl) || 0;
          runningBalance -= consumption;
          weeks.push({ week_label: wl, consumption, balance: runningBalance });
        }

        results.push({
          key, name: entry.name, type: entry.type, unit: entry.unit,
          current_stock: entry.current_stock, weeks,
          final_balance: runningBalance,
        });
      }

      results.sort((a, b) => a.final_balance - b.final_balance);
      setBalances(results);
    } catch (err: any) {
      console.error('[SaldoFinal] Error:', err);
    } finally {
      setLoading(false);
    }
  }

  const visibleWeeks = useMemo(() =>
    allWeekLabels.filter(w => selectedWeeks.has(w)),
    [allWeekLabels, selectedWeeks]
  );

  const filtered = useMemo(() => {
    let list = balances;
    if (search) {
      const q = normalizeForSearch(search);
      list = list.filter(b => normalizeForSearch(b.name).includes(q) || normalizeForSearch(b.type).includes(q));
    }
    // Recalculate final_balance based on visible weeks only
    return list.map(b => {
      const lastVisible = b.weeks.filter(w => selectedWeeks.has(w.week_label));
      const displayBalance = lastVisible.length > 0 ? lastVisible[lastVisible.length - 1].balance : b.current_stock;
      return { ...b, final_balance: displayBalance };
    });
  }, [balances, search, selectedWeeks]);

  const negativeCount = useMemo(() => filtered.filter(b => b.final_balance < 0).length, [filtered]);

  const toggleWeek = (wl: string) => {
    setSelectedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(wl)) next.delete(wl);
      else next.add(wl);
      return next;
    });
  };

  const selectAllWeeks = () => setSelectedWeeks(new Set(allWeekLabels));
  const clearAllWeeks = () => setSelectedWeeks(new Set());

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">Calculando saldos finais...</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Package className="h-5 w-5 mx-auto mb-1 text-primary" />
            <p className="display text-2xl tabular-nums">{filtered.length}</p>
            <p className="text-xs text-muted-foreground">Materiais Analisados</p>
          </CardContent>
        </Card>
        <Card className={negativeCount > 0 ? 'border-destructive/30 bg-destructive/5' : ''}>
          <CardContent className="pt-4 pb-3 text-center">
            <TrendingDown className="h-5 w-5 mx-auto mb-1 text-destructive" />
            <p className={`display text-2xl tabular-nums ${negativeCount > 0 ? 'text-destructive' : ''}`}>{negativeCount}</p>
            <p className="text-xs text-muted-foreground">Saldo Negativo</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-warning" />
            <p className="display text-2xl tabular-nums">{visibleWeeks.length}/{allWeekLabels.length}</p>
            <p className="text-xs text-muted-foreground">Semanas Visíveis</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar material..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="h-4 w-4" />
              Semanas ({selectedWeeks.size}/{allWeekLabels.length})
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="end">
            <div className="space-y-3">
              <div className="flex justify-between">
                <p className="text-sm font-medium">Filtrar Semanas</p>
                <div className="flex gap-2">
                  <button className="text-xs text-primary hover:underline" onClick={selectAllWeeks}>Todas</button>
                  <button className="text-xs text-muted-foreground hover:underline" onClick={clearAllWeeks}>Nenhuma</button>
                </div>
              </div>
              <div className="space-y-2 max-h-60 overflow-auto">
                {allWeekLabels.map(wl => (
                  <label key={wl} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox checked={selectedWeeks.has(wl)} onCheckedChange={() => toggleWeek(wl)} />
                    {wl}
                  </label>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" /> Saldo Final por Material
          </CardTitle>
          <CardDescription>
            Estoque atual menos o consumo acumulado de cada semana. Valores negativos indicam falta de material.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background z-10 min-w-[200px]">Material</TableHead>
                  <TableHead className="text-right min-w-[100px]">Estoque Atual</TableHead>
                  {visibleWeeks.map(wl => (
                    <TableHead key={wl} className="text-right min-w-[120px]">
                      <div className="text-xs text-muted-foreground">Saldo</div>
                      <div className="text-xs">{wl}</div>
                    </TableHead>
                  ))}
                  <TableHead className="text-right min-w-[100px] font-bold">Saldo Final</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3 + visibleWeeks.length} className="text-center py-8 text-muted-foreground">
                      Nenhum material encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(mat => (
                    <TableRow key={mat.key} className={mat.final_balance < 0 ? 'bg-destructive/5' : ''}>
                      <TableCell className="sticky left-0 bg-background z-10">
                        <p className="font-medium text-sm">{mat.name}</p>
                        <Badge variant="outline" className="text-xs">{mat.type}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {fmtQty(mat.current_stock)} <span className="text-xs text-muted-foreground">{mat.unit}</span>
                      </TableCell>
                      {mat.weeks.filter(w => selectedWeeks.has(w.week_label)).map(w => (
                        <TableCell key={w.week_label} className={`text-right font-mono text-sm ${w.balance < 0 ? 'text-destructive font-bold' : ''}`}>
                          {fmtQty(w.balance)}
                          {w.consumption > 0 && (
                            <div className="text-xs text-muted-foreground">-{fmtQty(w.consumption)}</div>
                          )}
                        </TableCell>
                      ))}
                      <TableCell className={`text-right font-mono text-sm font-bold ${mat.final_balance < 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {fmtQty(mat.final_balance)} <span className="text-xs text-muted-foreground">{mat.unit}</span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

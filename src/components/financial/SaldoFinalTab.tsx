import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MagnifyingGlass, Package, Warning as AlertTriangle, TrendDown as TrendingDown, Funnel as Filter } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { startOfWeek, endOfWeek, addWeeks } from 'date-fns';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import type { PvMaterialNeed } from '@/lib/perPvPurchasing';

const fmtQty = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

const classifyMaterialType = (productName: string, groupName: string, category: string) => {
  const normalized = `${productName} ${groupName} ${category}`.toLowerCase();
  if (normalized.includes('solado')) return 'Solado';
  if (normalized.includes('palmilha') || normalized.includes('placa')) return 'Palmilha';
  if (normalized.includes('forração') || normalized.includes('forracao') || normalized.includes('forro')) return 'Forração';
  if (normalized.includes('cabedal') || normalized.includes('napa') || normalized.includes('couro')) return 'Cabedal';
  if (normalized.includes('tira')) return 'Tiras';
  if (normalized.includes('cola') || normalized.includes('adesivo')) return 'Químicos';
  if (normalized.includes('embalagem') || normalized.includes('caixa')) return 'Embalagem';
  return 'Componente';
};

interface MaterialBalance {
  key: string;
  name: string;
  type: string;
  unit: string;
  current_stock: number;
  weeks: { week_label: string; consumption: number; balance: number }[];
  final_balance: number;
}

interface SaldoProduct {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  group_id: string | null;
  product_groups: { name: string | null } | Array<{ name: string | null }> | null;
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
    if (allWeekLabels.length > 0) {
      setSelectedWeeks(current => current.size === 0 ? new Set(allWeekLabels) : current);
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

      const { data: orders = [], error: ordersError } = await supabase
        .from('orders')
        .select(`
          id, order_number, quantity, status, planned_delivery, reference_id, sale_order_id,
          sale_orders!orders_sale_order_id_fkey(id, delivery_deadline, delivery_week, delivery_month)
        `)
        // Status REAIS de orders no backend (audit 2026-05): 'Pronto' não existe.
        .in('status', ['Reservado', 'Em Produção'])
        .order('planned_delivery', { ascending: true });
      if (ordersError) throw ordersError;

      const today = new Date();
      const pvsByWeek = new Map<string, string[]>();
      const weekLabelsSet = new Set<string>();
      const seenPvs = new Set<string>();

      // O escopo visual continua sendo o dos PVs com OP ativa. Cada PV entra
      // uma única vez, mesmo quando possui várias OPs/referências.
      for (const order of orders) {
        const pvId = order.sale_order_id as string | null;
        if (!pvId || seenPvs.has(pvId)) continue;
        seenPvs.add(pvId);

        const saleOrder = Array.isArray(order.sale_orders) ? order.sale_orders[0] : order.sale_orders;
        const deliveryDate = order.planned_delivery || saleOrder?.delivery_deadline || null;
        const deliveryDateObj = parseDateValue(deliveryDate) ?? addWeeks(today, 4);
        const ws = startOfWeek(deliveryDateObj, { weekStartsOn: 1 });
        const we = endOfWeek(deliveryDateObj, { weekStartsOn: 1 });
        const weekLabel = `${format(ws, 'dd/MM', { locale: ptBR })} - ${format(we, 'dd/MM', { locale: ptBR })}`;
        weekLabelsSet.add(weekLabel);
        const ids = pvsByWeek.get(weekLabel) || [];
        ids.push(pvId);
        pvsByWeek.set(weekLabel, ids);
      }

      if (seenPvs.size === 0) { setBalances([]); setAllWeekLabels([]); return; }

      // O agregado canônico por PV calcula per-size, conversão física,
      // sole_drives_consumption e deduplicação. Chamadas por semana preservam
      // a grade temporal da UI sem reimplementar o motor no frontend.
      const weeklyNeeds = await Promise.all(
        [...pvsByWeek.entries()].map(async ([weekLabel, pvIds]) => {
          const { data, error } = await supabase.rpc('compute_materials_per_pv', {
            p_pv_ids: pvIds,
          });
          if (error) throw error;
          return { weekLabel, rows: (data || []) as PvMaterialNeed[] };
        }),
      );

      const materialIds = [...new Set(
        weeklyNeeds.flatMap(batch => batch.rows.map(row => row.material_id).filter(Boolean)),
      )] as string[];
      const productRows: SaldoProduct[] = [];
      if (materialIds.length > 0) {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, quantity, unit, category, group_id, product_groups!products_group_id_fkey(name)')
          .in('id', materialIds);
        if (error) throw error;
        productRows.push(...((data || []) as unknown as SaldoProduct[]));
      }
      const productsMap = new Map(productRows.map(product => [product.id, product]));

      const materialWeeklyMap = new Map<string, {
        name: string; type: string; unit: string; current_stock: number;
        weeks: Map<string, number>;
      }>();

      for (const { weekLabel, rows } of weeklyNeeds) {
        for (const row of rows) {
          const consumption = Number(row.needed_qty) || 0;
          if (!row.material_id || consumption <= 0) continue;
          const product = productsMap.get(row.material_id);
          const productGroup = Array.isArray(product?.product_groups)
            ? product.product_groups[0]
            : product?.product_groups;
          const groupName = productGroup?.name || '';
          const type = classifyMaterialType(row.product_name || product?.name || '', groupName, product?.category || '');
          const key = `pid:${row.material_id}`;

          if (!materialWeeklyMap.has(key)) {
            materialWeeklyMap.set(key, {
              name: product?.name || row.product_name || 'Material',
              type,
              unit: row.unit || product?.unit || 'un',
              current_stock: Number(product?.quantity) || 0,
              weeks: new Map(),
            });
          }
          const entry = materialWeeklyMap.get(key)!;
          entry.weeks.set(weekLabel, (entry.weeks.get(weekLabel) || 0) + consumption);
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
    } catch (err: unknown) {
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
      list = list.filter(b => searchMatchesAllTerms(search, b.name, b.type));
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
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por material ou tipo (cabedal, solado…)"
          resultCount={filtered.length}
          totalCount={balances.length}
          className="flex-1 min-w-[200px] max-w-md"
        />

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
                    <TableCell colSpan={3 + visibleWeeks.length}>
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
                        <div className="text-center py-8 text-muted-foreground">
                          Nenhum material encontrado.
                        </div>
                      )}
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

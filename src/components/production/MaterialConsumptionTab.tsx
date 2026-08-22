import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Package, TrendUp as TrendingUp, Stack as Layers, Funnel as Filter, Palette } from '@phosphor-icons/react';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, parseISO, isWithinInterval, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { calculateConsumption, type ConsumptionLine, validateConsumptionPayload } from '@/services/consumptionService';

type PeriodFilter = 'week' | 'month' | 'all';

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--stage-sew-fg))',
  'hsl(var(--stage-cut-fg))',
  'hsl(var(--destructive))',
  'hsl(var(--stage-pack-fg))',
  'hsl(var(--stage-fin-fg))',
  'hsl(var(--stage-assy-fg))',
  'hsl(var(--info))',
  'hsl(var(--muted-foreground))',
  'hsl(var(--accent-foreground))',
];

type ConsumptionRow = {
  orderId: string;
  groupName: string;
  groupId: string | null;
  materialName: string;
  unit: string;
  color: string;
  quantity: number;
  cost: number;
};

type ConsumptionProduct = {
  id: string;
  name: string | null;
  unit: string | null;
  category: string | null;
  unit_price: number | null;
  group_id: string | null;
  color: string | null;
};

const formatUnit = (unit: string) => {
  const labels: Record<string, string> = { metro: 'm', m: 'm', 'm²': 'm²', dm2: 'dm²', par: 'par', un: 'un', kg: 'kg', litro: 'L', cm: 'm' };
  return labels[unit] || unit || 'un';
};

function useConsumptionFromSheets() {
  return useQuery({
    queryKey: ['material-consumption-from-sheets'],
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [ordersRes, groupsRes] = await Promise.all([
        supabase
          .from('orders')
          .select(`
            id, order_number, created_at, quantity, color, status, grade,
            reference_id, sale_order_item_id,
            technical_sheets(
              id, name, code
            )
          `)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('product_groups')
          .select('id, name')
          .order('name'),
      ]);

      if (ordersRes.error) throw ordersRes.error;
      if (groupsRes.error) throw groupsRes.error;
      const orders = ordersRes.data || [];
      const groups = groupsRes.data || [];
      const activeOrders = orders.filter(order => order.reference_id);
      if (activeOrders.length === 0) return { orders, groups, consumptionRows: [] as ConsumptionRow[] };

      // Variante do item do PV: mesma resolução usada pelo Wizard antes de
      // chamar o motor canônico por OP.
      const saleOrderItemIds = [...new Set(activeOrders.map(order => order.sale_order_item_id).filter(Boolean))] as string[];
      const variantBySaleOrderItem = new Map<string, string | null>();
      if (saleOrderItemIds.length > 0) {
        const { data: itemRows, error: itemRowsError } = await supabase
          .from('sale_order_items')
          .select('id, material_variant_id')
          .in('id', saleOrderItemIds);
        if (itemRowsError) throw itemRowsError;
        for (const item of itemRows || []) variantBySaleOrderItem.set(item.id, item.material_variant_id ?? null);
      }

      // Consumo CANÔNICO por OP. Grade presente usa o by_grade; OP legada sem
      // grade cai no wrapper escalar exatamente como no PurchasePlanningWizard.
      const consumptionByOrder = await Promise.all(
        activeOrders.map(async (order): Promise<ConsumptionLine[]> => {
          const variantId = order.sale_order_item_id
            ? variantBySaleOrderItem.get(order.sale_order_item_id) ?? null
            : null;
          const grade = order.grade && typeof order.grade === 'object' && !Array.isArray(order.grade)
            && Object.keys(order.grade).length > 0
            ? order.grade
            : null;

          if (grade) {
            const { data, error } = await supabase.rpc('calculate_order_consumption_by_grade', {
              p_reference_id: order.reference_id!,
              p_grade: grade,
              p_color: order.color ?? '',
              ...(variantId ? { p_material_variant_id: variantId } : {}),
            });
            if (error) throw error;
            return validateConsumptionPayload((data as unknown) ?? []);
          }

          const summary = await calculateConsumption({
            referenceId: order.reference_id!,
            quantity: Number(order.quantity) || 0,
            color: order.color,
            materialVariantId: variantId,
          });
          return summary.lines;
        }),
      );

      const productIds = [...new Set(
        consumptionByOrder.flatMap(lines => lines.map(line => line.product_id).filter(Boolean)),
      )] as string[];
      const productsMap = new Map<string, ConsumptionProduct>();
      if (productIds.length > 0) {
        const { data: productRows, error: productRowsError } = await supabase
          .from('products')
          .select('id, name, unit, category, unit_price, group_id, color')
          .in('id', productIds);
        if (productRowsError) throw productRowsError;
        for (const product of productRows || []) productsMap.set(product.id, product);
      }

      // Linhas de área vêm sem unidade no contrato do RPC. A conversão usa a
      // largura da ficha de componente, como no Wizard; sem largura, conserva
      // dm² e o valor cru em vez de fingir que são metros.
      const areaProductIds = new Set<string>();
      for (const lines of consumptionByOrder) {
        for (const line of lines) {
          if (line.product_id && line.unit == null) areaProductIds.add(line.product_id);
        }
      }
      const conversionInfo = new Map<string, { dm2PerUnit: number; warning: string | null }>();
      await Promise.all([...areaProductIds].map(async (productId) => {
        const { data, error } = await supabase.rpc('get_material_conversion_info', { p_product_id: productId });
        if (error) throw error;
        const row = (Array.isArray(data) ? data[0] : data) as {
          dm2_per_unit?: number | string | null;
          conversion_warning?: string | null;
        } | null;
        if (row) {
          conversionInfo.set(productId, {
            dm2PerUnit: Number(row.dm2_per_unit) || 1,
            warning: row.conversion_warning ?? null,
          });
        }
      }));

      const groupNameById = new Map(groups.map(group => [group.id, group.name]));
      const consumptionRows: ConsumptionRow[] = [];
      activeOrders.forEach((order, orderIndex) => {
        for (const line of consumptionByOrder[orderIndex]) {
          if (!line.product_id) continue;
          const product = productsMap.get(line.product_id);
          const conversion = conversionInfo.get(line.product_id);
          const isAreaLine = line.unit == null;
          const widthMissing = !!line.conversion_warning || (isAreaLine && !!conversion?.warning);
          const required = Number(line.required) || 0;
          const quantity = isAreaLine && !widthMissing
            ? required / Math.max(conversion?.dm2PerUnit || 1, 1)
            : required;
          const groupName = groupNameById.get(product?.group_id)
            || line.category
            || line.component
            || product?.name
            || 'Outros';
          const unit = widthMissing ? 'dm²' : (product?.unit || line.unit || 'un');
          const unitPrice = Number(product?.unit_price) || 0;

          consumptionRows.push({
            orderId: order.id,
            groupName,
            groupId: product?.group_id || null,
            materialName: line.product_name || product?.name || groupName,
            unit,
            color: line.color || product?.color || order.color || '—',
            quantity,
            cost: quantity * unitPrice,
          });
        }
      });

      return { orders, groups, consumptionRows };
    },
  });
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type GroupData = { group: string; groupId: string | null; cost: number; qty: number };
type ColorData = { color: string; cost: number; qty: number; unit: string };
type ProductData = { name: string; sku: string; unit: string; qty: number; cost: number; color: string; groupName: string };

export default function MaterialConsumptionTab() {
  const { data, isLoading, isError, error, refetch } = useConsumptionFromSheets();
  const [period, setPeriod] = useState<PeriodFilter>('month');
  const [selectedOrder, setSelectedOrder] = useState<string>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');

  const filtered = useMemo(() => {
    if (!data) return {
      orders: [], totalQty: 0, totalCost: 0,
      byGroup: [] as GroupData[], byColor: [] as ColorData[], byProduct: [] as ProductData[],
      consumptionRows: [] as ConsumptionRow[],
    };

    const now = new Date();
    let start: Date | null = null;
    let end: Date | null = null;

    if (period === 'week') {
      start = startOfWeek(now, { weekStartsOn: 1 });
      end = endOfWeek(now, { weekStartsOn: 1 });
    } else if (period === 'month') {
      start = startOfMonth(now);
      end = endOfMonth(now);
    }

    let orders = data.orders;

    if (start && end) {
      orders = orders.filter(o => {
        if (!o?.created_at) return false;
        const createdAt = parseISO(o.created_at);
        return isValid(createdAt) && isWithinInterval(createdAt, { start: start!, end: end! });
      });
    }

    if (selectedOrder !== 'all') {
      orders = orders.filter(o => o.id === selectedOrder);
    }

    // Build group name map
    const groupNameMap: Record<string, string> = {};
    for (const g of data.groups) groupNameMap[g.id] = g.name;

    // Aggregate consumption from technical sheets
    const consumptionMap = new Map<string, ConsumptionRow>();

    const addRow = (row: ConsumptionRow) => {
      const qty = Number(row.quantity) || 0;
      const gn = row.groupName?.trim();
      if (!gn || qty <= 0) return;

      const color = row.color?.trim() || '—';
      const unit = row.unit?.trim() || 'un';
      const materialName = row.materialName?.trim() || gn;
      const key = `${gn}||${color}||${unit}`;
      const existing = consumptionMap.get(key);

      if (existing) {
        existing.quantity += qty;
        existing.cost += row.cost || 0;
        return;
      }

      consumptionMap.set(key, { ...row, groupName: gn, materialName, color, unit, quantity: qty });
    };

    const selectedOrderIds = new Set(orders.map(order => order.id));
    for (const row of data.consumptionRows) {
      if (selectedOrderIds.has(row.orderId)) addRow(row);
    }

    const consumptionRows = Array.from(consumptionMap.values()).sort((a, b) =>
      a.groupName.localeCompare(b.groupName, 'pt-BR')
    );

    // Aggregate by group
    const groupMap: Record<string, GroupData> = {};
    for (const row of consumptionRows) {
      const gKey = row.groupName;
      if (!groupMap[gKey]) groupMap[gKey] = { group: gKey, groupId: row.groupId, cost: 0, qty: 0 };
      groupMap[gKey].cost += row.cost;
      groupMap[gKey].qty += row.quantity;
    }
    const byGroup = Object.values(groupMap).sort((a, b) => b.qty - a.qty);

    // Color & Product breakdown (filtered by selectedGroup)
    const colorMap: Record<string, ColorData> = {};
    const productMap: Record<string, ProductData> = {};

    for (const row of consumptionRows) {
      if (selectedGroup !== 'all' && row.groupName !== selectedGroup) continue;

      const color = row.color;
      const unitDisplay = formatUnit(row.unit);

      if (!colorMap[color]) colorMap[color] = { color, cost: 0, qty: 0, unit: unitDisplay };
      colorMap[color].cost += row.cost;
      colorMap[color].qty += row.quantity;

      const pKey = `${row.materialName}||${color}`;
      if (!productMap[pKey]) {
        productMap[pKey] = { name: row.materialName, sku: '', unit: unitDisplay, qty: 0, cost: 0, color, groupName: row.groupName };
      }
      productMap[pKey].qty += row.quantity;
      productMap[pKey].cost += row.cost;
    }

    const byColor = Object.values(colorMap).sort((a, b) => b.qty - a.qty);
    const byProduct = Object.values(productMap).sort((a, b) => b.qty - a.qty);

    const totalQty = consumptionRows.reduce((s, r) => s + r.quantity, 0);
    const totalCost = consumptionRows.reduce((s, r) => s + r.cost, 0);

    return { orders, totalQty, totalCost, byGroup, byColor, byProduct, consumptionRows };
  }, [data, period, selectedOrder, selectedGroup]);

  if (isLoading) return <div className="flex items-center justify-center h-32 text-muted-foreground">Carregando consumo...</div>;
  if (isError) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-4">
          <div className="space-y-2">
            <p className="font-semibold">Não foi possível carregar o consumo</p>
            <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : 'Tente novamente em instantes.'}</p>
          </div>
          <Button variant="outline" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) return <div className="text-sm text-muted-foreground">Nenhum dado disponível.</div>;

  const periodLabel = period === 'week'
    ? `Semana de ${format(startOfWeek(new Date(), { weekStartsOn: 1 }), "dd/MM", { locale: ptBR })} a ${format(endOfWeek(new Date(), { weekStartsOn: 1 }), "dd/MM", { locale: ptBR })}`
    : period === 'month'
    ? format(new Date(), "MMMM 'de' yyyy", { locale: ptBR })
    : 'Todo o período';

  const groupsWithData = filtered.byGroup.filter(g => g.qty > 0);
  const selectedGroupName = selectedGroup === 'all'
    ? 'Todos os Grupos'
    : (groupsWithData.find(g => g.group === selectedGroup)?.group || selectedGroup);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto">Consumo de Material (Ficha Técnica)</h2>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={period} onValueChange={v => setPeriod(v as PeriodFilter)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Esta semana</SelectItem>
              <SelectItem value="month">Este mês</SelectItem>
              <SelectItem value="all">Todo período</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Select value={selectedOrder} onValueChange={setSelectedOrder}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Filtrar por pedido" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os pedidos</SelectItem>
            {data.orders.map(o => {
              const sheet = Array.isArray(o.technical_sheets)
                ? o.technical_sheets[0]
                : o.technical_sheets;
              return (
                <SelectItem key={o.id} value={o.id}>
                  {o.order_number} — {sheet?.name || '?'}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Select value={selectedGroup} onValueChange={setSelectedGroup}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Filtrar por grupo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Grupos</SelectItem>
            {groupsWithData.map(g => (
              <SelectItem key={g.group} value={g.group}>
                {g.group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground -mt-3">{periodLabel} — Consumo teórico baseado nas fichas técnicas × quantidade dos pedidos</p>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pedidos</p>
                <p className="text-lg font-bold">{filtered.orders.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Materiais Distintos</p>
                <p className="text-lg font-bold">{filtered.consumptionRows.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Custo Estimado</p>
                <p className="text-lg font-bold">{fmt(filtered.totalCost)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-accent/50 flex items-center justify-center">
                <Palette className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cores Distintas</p>
                <p className="text-lg font-bold">{filtered.byColor.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1: Group Bar Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" /> Consumo por Grupo de Material
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.byGroup.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sem dados no período</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(280, filtered.byGroup.slice(0, 12).length * 36)}>
              <BarChart data={filtered.byGroup.slice(0, 12)} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" tickFormatter={v => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} />
                <YAxis type="category" dataKey="group" width={160} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number, name: string) => [v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), name === 'qty' ? 'Quantidade' : 'Custo']}
                  labelFormatter={(label: string) => label}
                />
                <Bar dataKey="qty" name="Quantidade" radius={[0, 4, 4, 0]}>
                  {filtered.byGroup.slice(0, 12).map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Charts Row 2: Color breakdown */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              Consumo por Cor
              {selectedGroup !== 'all' && (
                <Badge variant="secondary" className="ml-1 text-xs">{selectedGroupName}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filtered.byColor.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sem dados</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={filtered.byColor.slice(0, 10)}
                    dataKey="qty"
                    nameKey="color"
                    cx="50%"
                    cy="50%"
                    outerRadius={95}
                    label={({ color, qty }) => `${color}: ${qty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`}
                    labelLine={false}
                  >
                    {filtered.byColor.slice(0, 10).map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), 'Quantidade']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              Ranking por Cor
              {selectedGroup !== 'all' && (
                <Badge variant="secondary" className="ml-1 text-xs">{selectedGroupName}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filtered.byColor.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sem dados</p>
            ) : (
              <div className="max-h-[300px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cor</TableHead>
                      <TableHead className="text-right">Quantidade</TableHead>
                      <TableHead className="text-right">Custo Est.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.byColor.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            <span className="font-medium">{c.color}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">{c.qty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {c.unit}</TableCell>
                        <TableCell className="text-right font-semibold">{fmt(c.cost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detailed Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Detalhamento por Material (Ficha Técnica)
            {selectedGroup !== 'all' && (
              <Badge variant="secondary" className="ml-2 text-xs">{selectedGroupName}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.byProduct.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum consumo calculado no período</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Cor</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-center w-20">Unidade</TableHead>
                  <TableHead className="text-right">Custo Est.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.byProduct.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{p.groupName}</Badge></TableCell>
                    <TableCell>{p.color}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{p.qty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="text-xs">{p.unit}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{fmt(p.cost)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell colSpan={5} className="font-bold">Total</TableCell>
                  <TableCell className="text-right font-bold">
                    {fmt(filtered.byProduct.reduce((s, p) => s + p.cost, 0))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

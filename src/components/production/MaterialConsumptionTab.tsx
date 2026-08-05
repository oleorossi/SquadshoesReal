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
import { parseSizes } from '@/lib/labelUtils';

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
  groupName: string;
  groupId: string | null;
  materialName: string;
  unit: string;
  color: string;
  quantity: number;
  cost: number;
};

const classifyComponentType = (groupName: string, productName: string, category: string) => {
  const normalized = `${groupName} ${productName} ${category}`.toLowerCase();
  if (normalized.includes('solado')) return 'Solado';
  if (normalized.includes('palmilha') || normalized.includes('placa')) return 'Palmilha';
  if (normalized.includes('forração') || normalized.includes('forracao') || normalized.includes('forro')) return 'Forração';
  if (normalized.includes('tira')) return 'Tiras';
  if (normalized.includes('cola') || normalized.includes('adesivo')) return 'Químicos';
  if (normalized.includes('embalagem') || normalized.includes('caixa')) return 'Embalagem';
  return 'Outros';
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
            reference_id,
            technical_sheets(
              id, name, code,
              upper_material, upper_consumption,
              lining_material, lining_consumption,
              insole_material, insole_consumption,
              sole_material, sole_consumption, sole_color
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

      // Get all reference_ids to load BOM materials
      const refIds = [...new Set(orders.map(o => o.reference_id).filter(Boolean))];

      let materials: any[] = [];
      if (refIds.length > 0) {
        const matsRes = await supabase
          .from('sheet_materials')
          .select('sheet_id, product_id, group_id, quantity_per_unit, color, sizes, products(name, unit, category, unit_price, group_id, color), product_groups(id, name)')
          .in('sheet_id', refIds);
        // ⚠ O erro daqui era ENGOLIDO (`if (!matsRes.error)`): a BOM ficava
        // vazia e a tela seguia somando SÓ cabedal/forro/palmilha/solado — que
        // não têm custo (`cost: 0`) —, exibindo "Custo Estimado R$ 0,00" e uma
        // lista de materiais incompleta com cara de completa. Falha de consulta
        // agora sobe pro `isError` da query, que já é renderizado abaixo.
        if (matsRes.error) throw matsRes.error;
        materials = matsRes.data || [];
      }

      return { orders, groups, materials };
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

    for (const order of orders) {
      const sheet = Array.isArray((order as any).technical_sheets)
        ? (order as any).technical_sheets[0]
        : (order as any).technical_sheets;
      if (!sheet) continue;

      const orderGrade = (order.grade as Record<string, number>) || {};
      const qty = Number(order.quantity) || 0;
      const orderColor = order.color || '—';

      // Cabedal (upper) - consumption in dm²/par
      if (sheet.upper_material && Number(sheet.upper_consumption) > 0) {
        addRow({
          groupName: sheet.upper_material,
          groupId: null,
          materialName: 'Cabedal',
           unit: 'dm²',
           color: orderColor,
           quantity: Number(sheet.upper_consumption) * qty,
          cost: 0,
        });
      }

      // Forro (lining) - consumption in dm²/par
      if (sheet.lining_material && Number(sheet.lining_consumption) > 0) {
        addRow({
          groupName: sheet.lining_material,
          groupId: null,
          materialName: 'Forração',
           unit: 'dm²',
           color: orderColor,
           quantity: Number(sheet.lining_consumption) * qty,
          cost: 0,
        });
      }

      // Palmilha (insole) - consumption in dm²/par
      if (sheet.insole_material && Number(sheet.insole_consumption) > 0) {
        addRow({
          groupName: sheet.insole_material,
          groupId: null,
          materialName: 'Palmilha',
           unit: 'dm²',
           color: orderColor,
           quantity: Number(sheet.insole_consumption) * qty,
          cost: 0,
        });
      }

      // Solado: regra industrial fixa = 1 par por par produzido
      if (sheet.sole_material) {
        addRow({
          groupName: sheet.sole_material,
          groupId: null,
          materialName: 'Solado',
          unit: 'par',
          color: sheet.sole_color || orderColor,
          quantity: 1 * qty,
          cost: 0,
        });
      }

      // BOM materials (sheet_materials)
      const orderMaterials = data.materials.filter(m => m.sheet_id === order.reference_id);
      for (const material of orderMaterials) {
        const product = material.products as any;
        const group = material.product_groups as any;
        if (!product) continue;

        let productUnit = product.unit || 'un';
        
        // Calculate quantity based on material sizes and order grade
        let appliedQty = qty;
        if (material.sizes && material.sizes.trim() !== '') {
          const materialSizes = parseSizes(material.sizes);
          appliedQty = materialSizes.reduce((sum, size) => sum + (Number(orderGrade[size]) || 0), 0);
          
          // If no matching sizes in grade, but total qty > 0, we might need a fallback, 
          // but typically if sizes are specified, it only applies to those.
          // If the sum is 0, it means this material is not used for any of the sizes in this order.
          if (appliedQty === 0 && Object.keys(orderGrade).length === 0) {
            appliedQty = qty; // Fallback if grade is missing
          }
        }

        let totalQty = (Number(material.quantity_per_unit) || 0) * appliedQty;

        // Convert cm to m
        if (productUnit === 'cm') {
          totalQty /= 100;
          productUnit = 'metro';
        }

        const groupName = group?.name || product.category || product.name || 'Outros';
        const unitPrice = Number(product.unit_price) || 0;


        addRow({
          groupName,
          groupId: group?.id || product.group_id || null,
          materialName: product.name || groupName,
          unit: productUnit,
          color: material.color || orderColor,
          quantity: totalQty,
          cost: totalQty * unitPrice,
        });
      }
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
            {data.orders.map(o => (
              <SelectItem key={o.id} value={o.id}>
                {o.order_number} — {(o as any).technical_sheets?.name || '?'}
              </SelectItem>
            ))}
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

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Warning as AlertTriangle, TrendDown as TrendingDown, TrendUp as TrendingUp, Calendar, Package } from '@phosphor-icons/react';
import { useProducts } from '@/hooks/useProducts';
import { useGroups, type ProductGroup } from '@/hooks/useGroups';

const HORIZONS = [
  { key: '7', label: '7 Dias', days: 7 },
  { key: '15', label: '15 Dias', days: 15 },
  { key: '21', label: '21 Dias', days: 21 },
  { key: '30', label: '30 Dias', days: 30 },
] as const;

interface ProjectedItem {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  groupId: string | null;
  groupName: string;
  supplierName: string;
  currentStock: number;
  minStock: number;
  dailyConsumption: number;
  projectedStock: number;
  shortage: number;
  daysUntilStockout: number;
  status: 'ok' | 'warning' | 'critical';
}

export default function MrpProjectionsTab() {
  const { data: products = [] } = useProducts();
  const { data: groups = [] } = useGroups();
  const [horizon, setHorizon] = useState('7');
  const [groupFilter, setGroupFilter] = useState('all');

  const days = HORIZONS.find(h => h.key === horizon)?.days ?? 7;

  // Build supplier map by group
  const groupMap = useMemo(() => {
    const m = new Map<string, ProductGroup>();
    for (const g of groups) m.set(g.id, g);
    return m;
  }, [groups]);

  // Build projections per product
  const projections = useMemo(() => {
    const result: ProjectedItem[] = [];

    for (const p of products) {
      if (!p.active) continue;
      if (p.quantity <= 0 && p.min_stock <= 0) continue;

      const groupInfo = p.group_id ? groupMap.get(p.group_id) : null;
      const groupName = groupInfo?.name || 'Sem Grupo';

      // Estimate daily consumption based on historical or min_stock heuristic
      // If min_stock set, assume consumption = min_stock / 30 (monthly safety)
      const dailyConsumption = p.min_stock > 0
        ? Math.max(p.min_stock / 30, 0.1)
        : 0;

      if (dailyConsumption <= 0) continue;

      const projectedStock = Math.max(0, p.quantity - (dailyConsumption * days));
      const shortage = Math.max(0, p.min_stock - projectedStock);
      const daysUntilStockout = dailyConsumption > 0
        ? Math.floor(p.quantity / dailyConsumption)
        : 999;

      let status: 'ok' | 'warning' | 'critical' = 'ok';
      if (daysUntilStockout <= 7) status = 'critical';
      else if (daysUntilStockout <= 15) status = 'warning';

      result.push({
        productId: p.id,
        productName: p.name,
        sku: p.sku || '',
        unit: p.unit || 'un',
        groupId: p.group_id,
        groupName,
        supplierName: (p as any).supplier_name || groupName,
        currentStock: p.quantity,
        minStock: p.min_stock || 0,
        dailyConsumption,
        projectedStock,
        shortage,
        daysUntilStockout,
        status,
      });
    }

    return result.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
  }, [products, groupMap, days]);

  // Group projections by purchase group
  const groupedProjections = useMemo(() => {
    let filtered = projections;
    if (groupFilter !== 'all') {
      filtered = projections.filter(p => p.groupId === groupFilter);
    }

    const grouped = new Map<string, ProjectedItem[]>();
    for (const item of filtered) {
      const key = item.groupName;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    }

    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [projections, groupFilter]);

  // Summary stats
  const summary = useMemo(() => {
    const critical = projections.filter(p => p.status === 'critical').length;
    const warning = projections.filter(p => p.status === 'warning').length;
    const ok = projections.filter(p => p.status === 'ok').length;
    const totalShortage = projections.reduce((s, p) => s + p.shortage, 0);
    return { critical, warning, ok, totalShortage };
  }, [projections]);

  const uniqueGroups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of projections) {
      if (p.groupId && !seen.has(p.groupId)) {
        seen.set(p.groupId, p.groupName);
      }
    }
    return Array.from(seen.entries());
  }, [projections]);

  return (
    <div className="space-y-4">
      {/* Horizon selector */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={horizon} onValueChange={setHorizon}>
          <TabsList>
            {HORIZONS.map(h => (
              <TabsTrigger key={h.key} value={h.key} className="gap-1">
                <Calendar className="h-3 w-3" />
                {h.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Filtrar por grupo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Grupos</SelectItem>
            {uniqueGroups.map(([id, name]) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-muted-foreground">Críticos ({days}d)</span>
            </div>
            <p className="text-2xl font-bold mt-1 text-destructive">{summary.critical}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-warning" />
              <span className="text-sm text-muted-foreground">Alerta ({days}d)</span>
            </div>
            <p className="text-2xl font-bold mt-1">{summary.warning}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" />
              <span className="text-sm text-muted-foreground">OK ({days}d)</span>
            </div>
            <p className="text-2xl font-bold mt-1">{summary.ok}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Itens Projetados</span>
            </div>
            <p className="text-2xl font-bold mt-1">{projections.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Grouped tables */}
      {groupedProjections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum material com projeção de consumo encontrado.
            <br />
            <span className="text-xs">Materiais precisam ter estoque mínimo configurado para gerar projeções.</span>
          </CardContent>
        </Card>
      ) : (
        groupedProjections.map(([groupName, items]) => {
          const criticalCount = items.filter(i => i.status === 'critical').length;
          const warningCount = items.filter(i => i.status === 'warning').length;

          return (
            <Card key={groupName}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    {groupName}
                    <Badge variant="secondary" className="ml-2">{items.length} itens</Badge>
                  </CardTitle>
                  <div className="flex gap-1">
                    {criticalCount > 0 && (
                      <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30">
                        {criticalCount} críticos
                      </Badge>
                    )}
                    {warningCount > 0 && (
                      <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">
                        {warningCount} alertas
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Estoque Atual</TableHead>
                      <TableHead className="text-right">Consumo/Dia</TableHead>
                      <TableHead className="text-right">Projeção {days}d</TableHead>
                      <TableHead className="text-right">Falta</TableHead>
                      <TableHead className="text-center">Dias p/ Ruptura</TableHead>
                      <TableHead>Cobertura</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(item => {
                      const coveragePct = Math.min(100, (item.daysUntilStockout / days) * 100);
                      return (
                        <TableRow
                          key={item.productId}
                          className={item.status === 'critical' ? 'bg-destructive/5' : item.status === 'warning' ? 'bg-warning/5' : ''}
                        >
                          <TableCell className="font-medium">{item.productName}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{item.sku}</TableCell>
                          <TableCell className="text-right">{item.currentStock.toFixed(1)} {item.unit}</TableCell>
                          <TableCell className="text-right">{item.dailyConsumption.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">
                            {item.projectedStock.toFixed(1)} {item.unit}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.shortage > 0 ? (
                              <span className="font-bold text-destructive">-{item.shortage.toFixed(1)}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className={
                                item.status === 'critical'
                                  ? 'bg-destructive/15 text-destructive border-destructive/30'
                                  : item.status === 'warning'
                                    ? 'bg-warning/15 text-warning border-warning/30'
                                    : 'bg-success/15 text-success border-success/30'
                              }
                            >
                              {item.daysUntilStockout > 90 ? '90+' : item.daysUntilStockout} dias
                            </Badge>
                          </TableCell>
                          <TableCell className="min-w-[100px]">
                            <Progress
                              value={coveragePct}
                              className={`h-2 ${
                                coveragePct < 30 ? '[&>div]:bg-destructive'
                                  : coveragePct < 60 ? '[&>div]:bg-warning'
                                    : '[&>div]:bg-success'
                              }`}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

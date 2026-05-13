import { useState, useMemo, lazy, Suspense } from 'react';
import { Warning as AlertTriangle, Package, ShoppingCart, Clock } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { useMrpSuggestions, useUpdateMrpSuggestion } from '@/hooks/useMrpSuggestions';
import { useOrders } from '@/hooks/useOrders';
import { useProducts } from '@/hooks/useProducts';
import { getAvailableToPromise } from '@/lib/inventoryIntelligence';

const MrpProjectionsTab = lazy(() => import('@/components/mrp/MrpProjectionsTab'));

const PRIORITY_COLORS: Record<string, string> = {
  rush: 'bg-destructive/15 text-destructive border-destructive/30',
  normal: 'bg-primary/15 text-primary border-primary/30',
  low: 'bg-muted text-muted-foreground border-border',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-warning/15 text-warning border-warning/30',
  accepted: 'bg-primary/15 text-primary border-primary/30',
  rejected: 'bg-destructive/15 text-destructive border-destructive/30',
  resolved: 'bg-success/15 text-success border-success/30',
};

export default function MrpUnifiedContent() {
  const { data: suggestions = [], isLoading } = useMrpSuggestions();
  const { data: orders = [] } = useOrders();
  const { data: products = [] } = useProducts();
  const updateSuggestion = useUpdateMrpSuggestion();
  const [statusFilter, setStatusFilter] = useState('open');
  const [typeFilter, setTypeFilter] = useState('all');

  const stockAlerts = useMemo(() => {
    const alerts: Array<{ product: any; required: number; available: number; shortage: number; orders: string[] }> = [];
    for (const p of products) {
      // Use Available-To-Promise (physical − reserved − safety), the canonical
      // metric used by validateMaterialAvailability. Reading p.quantity alone
      // misses materials already promised to active orders, masking real
      // shortages until physical stock drops below the threshold.
      const atp = getAvailableToPromise({
        physical: Number(p.quantity || 0),
        reserved: Number((p as any).reserved_stock || 0),
        safety:   Number((p as any).safety_stock || 0),
      });
      if (p.active && p.quantity !== null && p.min_stock > 0 && atp <= p.min_stock) {
        alerts.push({
          product: p,
          required: p.min_stock * 2,
          available: atp,
          shortage: Math.max(0, p.min_stock - atp),
          orders: [],
        });
      }
    }
    return alerts.slice(0, 50);
  }, [products]);

  const filteredSuggestions = useMemo(() => {
    let result = suggestions as any[];
    if (statusFilter !== 'all') result = result.filter(s => s.status === statusFilter);
    if (typeFilter !== 'all') result = result.filter(s => s.suggestion_type === typeFilter);
    return result;
  }, [suggestions, statusFilter, typeFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-muted-foreground">Alertas Estoque</span>
            </div>
            <p className="display text-2xl tabular-nums mt-1">{stockAlerts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" />
              <span className="text-sm text-muted-foreground">Sugestões Abertas</span>
            </div>
            <p className="display text-2xl tabular-nums mt-1">
              {(suggestions as any[]).filter(s => s.status === 'open').length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">OPs Ativas</span>
            </div>
            <p className="display text-2xl tabular-nums mt-1">
              {orders.filter(o => o.status?.toLowerCase() === 'em produção').length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-success" />
              <span className="text-sm text-muted-foreground">Compras Sugeridas</span>
            </div>
            <p className="display text-2xl tabular-nums mt-1">
              {(suggestions as any[]).filter(s => s.suggestion_type === 'purchase' && s.status === 'open').length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="projections">
        <TabsList>
          <TabsTrigger value="projections">Projeções</TabsTrigger>
          <TabsTrigger value="alerts">Alertas de Estoque ({stockAlerts.length})</TabsTrigger>
          <TabsTrigger value="suggestions">Sugestões MRP ({filteredSuggestions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="projections">
          <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
            <MrpProjectionsTab />
          </Suspense>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Mín.</TableHead>
                    <TableHead className="text-right">Falta</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockAlerts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Nenhum alerta de estoque
                      </TableCell>
                    </TableRow>
                  ) : stockAlerts.map((alert, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{alert.product.name}</TableCell>
                      <TableCell className="text-muted-foreground">{alert.product.sku}</TableCell>
                      <TableCell className="text-right">{alert.available} {alert.product.unit}</TableCell>
                      <TableCell className="text-right">{alert.product.min_stock}</TableCell>
                      <TableCell className="text-right font-bold text-destructive">{alert.shortage}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={alert.available === 0 ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning'}>
                          {alert.available === 0 ? 'Sem estoque' : 'Abaixo do mínimo'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suggestions" className="space-y-4">
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="open">Abertas</SelectItem>
                <SelectItem value="accepted">Aceitas</SelectItem>
                <SelectItem value="resolved">Resolvidas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos tipos</SelectItem>
                <SelectItem value="production">Produção</SelectItem>
                <SelectItem value="purchase">Compra</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Necessário</TableHead>
                    <TableHead className="text-right">Disponível</TableHead>
                    <TableHead className="text-right">Falta</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSuggestions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        Nenhuma sugestão encontrada
                      </TableCell>
                    </TableRow>
                  ) : filteredSuggestions.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Badge variant="outline">
                          {s.suggestion_type === 'purchase' ? 'Compra' : 'Produção'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{s.product_name || s.products?.name || '-'}</TableCell>
                      <TableCell className="text-right">{s.required_quantity}</TableCell>
                      <TableCell className="text-right">{s.available_quantity}</TableCell>
                      <TableCell className="text-right font-bold text-destructive">{s.shortage_quantity}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={PRIORITY_COLORS[s.priority] || ''}>
                          {s.priority === 'rush' ? 'Urgente' : s.priority === 'low' ? 'Baixa' : 'Normal'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLORS[s.status] || ''}>
                          {s.status === 'open' ? 'Aberta' : s.status === 'accepted' ? 'Aceita' : s.status === 'resolved' ? 'Resolvida' : s.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {s.status === 'open' && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => updateSuggestion.mutate({ id: s.id, status: 'accepted' })}>
                              Aceitar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => updateSuggestion.mutate({ id: s.id, status: 'resolved', resolved_by: 'manual' })}>
                              Resolver
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

import AppLayout from "@/components/layout/AppLayout";
import { useState, useMemo, lazy, Suspense } from 'react';
import { Warning as AlertTriangle, Package, ShoppingCart, CheckCircle as CheckCircle2, Clock, ArrowsDownUp as ArrowUpDown, Funnel as Filter } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMrpSuggestions, useUpdateMrpSuggestion } from '@/hooks/useMrpSuggestions';
import { useOrders } from '@/hooks/useOrders';
import { useProducts } from '@/hooks/useProducts';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import MrpProjectionsTab from '@/components/mrp/MrpProjectionsTab';
import { MaterialNeedsReport } from '@/components/mrp/MaterialNeedsReport';
import { useMaterialNeedsReport } from '@/hooks/useMaterialNeedsReport';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

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

export default function MrpPage() {
  const { data: suggestions = [], isLoading } = useMrpSuggestions();
  const { data: orders = [] } = useOrders();
  const { data: products = [] } = useProducts();
  const { data: sheets = [] } = useTechnicalSheets();
  const updateSuggestion = useUpdateMrpSuggestion();
  const { data: needsReportData = [], isLoading: isLoadingNeeds } = useMaterialNeedsReport();
  const [statusFilter, setStatusFilter] = useState('open');
  const [typeFilter, setTypeFilter] = useState('all');

  // Alertas de estoque por mínimo (min_stock). A demanda real por PV está nas
  // abas Sugestões/Necessidades (v_mrp_needs / fn_projected_demand, server-side).
  // Auditoria 2026-06-11: removido loop morto sobre `orders` + reqMap nunca usado
  // (fingia agregar necessidade por pedido mas o corpo era vazio).
  const stockAlerts = useMemo(() => {
    const alerts: Array<{ product: any; required: number; available: number; shortage: number; orders: string[] }> = [];

    for (const p of products) {
      if (p.active && p.min_stock > 0 && p.quantity <= p.min_stock) {
        alerts.push({
          product: p,
          required: p.min_stock * 2,
          available: p.quantity,
          shortage: Math.max(0, p.min_stock - p.quantity),
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

  return (
    
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="SUPRIMENTOS · MRP"
          title="MRP — Planejamento de Materiais"
          description="Necessidades de produção, sugestões de compra e análise de disponibilidade"
        />

        {/* KPI strip — kit editorial */}
        <StatGrid>
          <StatCard
            label="Alertas Estoque"
            value={stockAlerts.length}
            tone="destructive"
            icon={AlertTriangle}
          />
          <StatCard
            label="Sugestões Abertas"
            value={(suggestions as any[]).filter(s => s.status === 'open').length}
            tone="warning"
            icon={Clock}
          />
          <StatCard
            label="OPs Ativas"
            value={orders.filter(o => o.status === 'Em Produção').length}
            tone="primary"
            icon={Package}
          />
          <StatCard
            label="Compras Sugeridas"
            value={(suggestions as any[]).filter(s => s.suggestion_type === 'purchase' && s.status === 'open').length}
            tone="success"
            icon={ShoppingCart}
          />
        </StatGrid>

        <Tabs defaultValue="projections">
          <TabsList>
            <TabsTrigger value="projections">Projeções</TabsTrigger>
            <TabsTrigger value="needs-report">Planejamento Compras (DNA Solados)</TabsTrigger>
            <TabsTrigger value="alerts">Alertas de Estoque ({stockAlerts.length})</TabsTrigger>
            <TabsTrigger value="suggestions">Sugestões MRP ({filteredSuggestions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="projections">
            <MrpProjectionsTab />
          </TabsContent>

          <TabsContent value="needs-report">
            {isLoadingNeeds ? (
              <div className="flex items-center justify-center p-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <MaterialNeedsReport needsData={needsReportData} />
            )}
          </TabsContent>

          <TabsContent value="alerts" className="space-y-4">
            {stockAlerts.length === 0 ? (
              <Panel flush>
                <EmptyState
                  icon={AlertTriangle}
                  title="Nenhum alerta de estoque"
                  description="Todos os materiais estão acima do estoque mínimo."
                />
              </Panel>
            ) : (
            <Panel
              eyebrow="SUPRIMENTOS · MRP"
              title="Alertas de Estoque"
              subtitle={`${stockAlerts.length} material(is) abaixo do mínimo`}
              flush
            >
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                      <TableHead>Material</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
                      <TableHead className="text-right">Mín.</TableHead>
                      <TableHead className="text-right">Falta</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockAlerts.map((alert, i) => (
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
            </Panel>
            )}
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

            {filteredSuggestions.length === 0 ? (
              <Panel flush>
                <EmptyState
                  icon={Package}
                  title="Nenhuma sugestão encontrada"
                  description="Ajuste os filtros de status e tipo acima."
                />
              </Panel>
            ) : (
            <Panel
              eyebrow="SUPRIMENTOS · MRP"
              title="Sugestões MRP"
              subtitle={`${filteredSuggestions.length} sugestão(ões)`}
              flush
            >
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
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
                    {filteredSuggestions.map((s: any) => (
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
            </Panel>
            )}
          </TabsContent>
        </Tabs>
      </div>

  );
}

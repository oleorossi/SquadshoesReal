import { useMemo, useState } from 'react';
import { Truck, Path as RouteIcon, ListChecks, Plus, MapPin, Coins, GasPump as Fuel, Wrench, Calendar, WarningCircle as AlertCircle, Trash as Trash2 } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOwnDeliveryOrders, useDeliveryRoutes, useDeleteRoute, useUpdateRouteStatus, type RouteStatus } from '@/hooks/useDeliveryRoutes';
import { useVehicles, useDrivers } from '@/hooks/useFleet';
import RoutePlannerOwn from '@/components/own-delivery/RoutePlannerOwn';
import FleetTab from '@/components/own-delivery/FleetTab';
import { Link } from 'react-router-dom';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { useCan } from '@/hooks/useAccessControl';
import { OrderMultiSelectToolbar } from '@/components/orders/OrderMultiSelectToolbar';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import { MarqueeOverlay } from '@/components/ui/bulk-actions-bar';
import {
  findIdsMatchingOrderCodes,
  matchesOrderSearch,
  parseOrderCodeList,
} from '@/lib/orderCodeSearch';
import { matchesDeliveryWeek } from '@/lib/deliveryWeekOptions';
import { confirmIfHiddenSelection } from '@/lib/confirmHiddenSelection';
import { cn } from '@/lib/utils';

const formatBrl = (n: number | null | undefined) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

const formatDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

const STATUS_LABEL: Record<RouteStatus, string> = {
  draft: 'Rascunho',
  planned: 'Planejada',
  in_progress: 'Em rota',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

const STATUS_COLOR: Record<RouteStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  planned: 'bg-primary/10 text-primary',
  in_progress: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  cancelled: 'bg-destructive/10 text-destructive',
};

export default function OwnDeliveriesPage() {
  // A aba mora na URL (contrato do lote L6a): antes era <Tabs defaultValue>, então
  // F5 e o botão Voltar devolviam o usuário à primeira aba.
  const { value: abaAtiva, setValue: setAbaAtiva } = useUrlTabState({
    values: ['orders', 'routes', 'fleet'] as const,
    defaultValue: 'orders',
  });
  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-4">
      <EditorialPageHeader
        sectionLabel="LOGÍSTICA · ENTREGAS PRÓPRIAS"
        title="Entregas — Frete Próprio"
        description="Planeje rotas com a frota da empresa, otimize ordem de paradas e veja a projeção de combustível e desgaste."
      />

      <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
        <HubTabsList
          tabs={[
            { value: 'orders', label: 'Pedidos prontos', icon: ListChecks },
            { value: 'routes', label: 'Rotas', icon: RouteIcon },
            { value: 'fleet', label: 'Frota', icon: Truck },
          ]}
        />
        <TabsContent value="orders" className="mt-4"><OrdersTab /></TabsContent>
        <TabsContent value="routes" className="mt-4"><RoutesTab /></TabsContent>
        <TabsContent value="fleet" className="mt-4"><FleetTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Orders tab — pedidos com own_delivery=true sem rota ativa
// ────────────────────────────────────────────────────────────────────
function OrdersTab() {
  const perm = useCan('/entregas');
  const { data: orders = [], isLoading } = useOwnDeliveryOrders();
  const [planning, setPlanning] = useState(false);
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [weekFilter, setWeekFilter] = useState('all');

  const available = useMemo(() => orders.filter((o) => !o.current_route_id), [orders]);
  const inRoute = useMemo(() => orders.filter((o) => !!o.current_route_id), [orders]);

  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of available) {
      const name = (o.client?.razao_social || o.client_name || '').trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [available]);

  const filtered = useMemo(() => {
    return available.filter((o) => {
      const clientName = (o.client?.razao_social || o.client_name || '').trim();
      if (clientFilter !== 'all' && clientName !== clientFilter) return false;
      if (weekFilter !== 'all' && !matchesDeliveryWeek(o.delivery_deadline, weekFilter)) return false;
      if (!search.trim()) return true;
      return matchesOrderSearch(search, {
        saleOrderNumber: o.order_number,
        clientName,
      });
    });
  }, [available, search, clientFilter, weekFilter]);

  const sel = useMarqueeSelection(filtered, (o) => o.id);

  const pastedCodes = useMemo(() => parseOrderCodeList(search), [search]);
  const matchedCodeIds = useMemo(
    () => findIdsMatchingOrderCodes(available, pastedCodes, (o) => ({
      id: o.id,
      saleOrderNumber: o.order_number,
    })),
    [available, pastedCodes],
  );

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((o) => sel.isSelected(o.id));
  const toggleVisible = () => {
    if (allVisibleSelected) sel.deselectVisible();
    else sel.selectAll();
  };

  const selectedOrders = available.filter((o) => sel.selectedIds.has(o.id));

  const openPlanner = () => {
    if (sel.count === 0) return;
    if (!confirmIfHiddenSelection({
      totalSelected: sel.count,
      hiddenSelectedCount: sel.hiddenSelectedCount,
      entityLabel: 'PV',
      actionLabel: 'Criar rota com',
    })) return;
    setPlanning(true);
  };

  return (
    <div className="space-y-4">
      <OrderMultiSelectToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por PV, cliente…"
        resultCount={filtered.length}
        totalCount={available.length}
        clientOptions={clientOptions}
        clientFilter={clientFilter}
        onClientFilterChange={setClientFilter}
        weekFilter={weekFilter}
        onWeekFilterChange={setWeekFilter}
        allVisibleSelected={allVisibleSelected}
        visibleCount={filtered.length}
        onToggleVisible={toggleVisible}
        matchedCodeCount={matchedCodeIds.length}
        onSelectMatched={() => sel.selectMatchingIds(matchedCodeIds)}
      />

      <Panel
        eyebrow="LOGÍSTICA · ENTREGAS PRÓPRIAS"
        title={`Disponíveis para roteirizar (${available.length})`}
        actions={
          <div className="flex items-center gap-2">
            {sel.count > 0 && (
              <>
                <span className="text-xs text-muted-foreground">
                  {sel.count} {sel.count === 1 ? 'selecionado' : 'selecionados'}
                  {sel.hiddenSelectedCount > 0 ? ` · ${sel.hiddenSelectedCount} fora` : ''}
                </span>
                <Button size="sm" variant="ghost" onClick={() => sel.clear()}>Limpar</Button>
              </>
            )}
            {perm.canCreate && (
              <Button
                size="sm"
                onClick={openPlanner}
                disabled={sel.count === 0}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />Criar rota
              </Button>
            )}
          </div>
        }
        flush
      >
          {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>}
          {!isLoading && available.length === 0 && (
            <EmptyState
              icon={AlertCircle}
              title='Nenhum pedido com "frete próprio" disponível'
              description="Marque a opção em Pedidos de Venda ao criar/editar um PV."
              action={<Link to="/sales" className="text-primary underline text-sm">Ir para Pedidos de Venda</Link>}
            />
          )}
          {!isLoading && available.length > 0 && filtered.length === 0 && (
            <EmptyState
              size="sm"
              icon={AlertCircle}
              title="Nenhum resultado para o filtro atual"
              action={
                <Button variant="outline" size="sm" onClick={() => { setSearch(''); setClientFilter('all'); setWeekFilter('all'); }}>
                  Limpar filtros
                </Button>
              }
            />
          )}
          {filtered.length > 0 && (
            <ScrollArea className="max-h-[60vh]">
              <div
                ref={sel.containerRef}
                data-marquee-container
                onMouseDown={sel.onContainerMouseDown}
                className="relative divide-y border-y"
              >
                {filtered.map((o) => {
                  const isSelected = sel.isSelected(o.id);
                  return (
                    <div
                      key={o.id}
                      data-marquee-item
                      data-marquee-id={o.id}
                      className={cn(
                        'flex items-start gap-3 px-3 py-2 hover:bg-muted/30 cursor-pointer',
                        isSelected && 'bg-primary/5 ring-1 ring-inset ring-success/30',
                      )}
                      onClick={(e) => sel.toggle(o.id, e)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => sel.toggle(o.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">PV #{o.order_number}</span>
                          <span className="text-sm truncate">{o.client?.razao_social || o.client_name || '—'}</span>
                          {o.client?.branch_code && (
                            <Badge variant="outline" className="text-xs font-mono">
                              {o.client.branch_code}
                              {o.client.branch_name ? ` · ${o.client.branch_name}` : ''}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-xs">{o.status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {[o.client?.endereco, o.client?.bairro, o.client?.cidade, o.client?.estado]
                            .filter(Boolean).join(' · ') || 'Endereço não cadastrado'}
                        </p>
                      </div>
                      <div className="text-right text-xs shrink-0">
                        <div className="font-mono">{o.total_pairs ?? 0} prs</div>
                        {o.delivery_deadline && (
                          <div className="text-muted-foreground flex items-center gap-1 justify-end mt-0.5">
                            <Calendar className="h-3 w-3" />
                            {formatDate(o.delivery_deadline)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <MarqueeOverlay rect={sel.marqueeRect} />
              </div>
            </ScrollArea>
          )}
      </Panel>

      {inRoute.length > 0 && (
        <Panel
          eyebrow="LOGÍSTICA · ENTREGAS PRÓPRIAS"
          title={`Já em rota (${inRoute.length})`}
          flush
        >
            <ul className="divide-y border-y text-sm">
              {inRoute.map((o) => (
                <li key={o.id} className="px-3 py-2 flex items-center justify-between">
                  <span>
                    <span className="font-bold">PV #{o.order_number}</span> ·{' '}
                    {o.client?.razao_social || o.client_name}
                  </span>
                  <span className="text-xs text-muted-foreground">{o.total_pairs ?? 0} prs</span>
                </li>
              ))}
            </ul>
        </Panel>
      )}

      <RoutePlannerOwn
        open={planning}
        onOpenChange={setPlanning}
        orders={selectedOrders}
        onCreated={() => sel.clear()}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Routes tab
// ────────────────────────────────────────────────────────────────────
function RoutesTab() {
  const perm = useCan('/entregas');
  const [statusFilter, setStatusFilter] = useState<RouteStatus | 'all'>('all');
  const { data: routes = [], isLoading } = useDeliveryRoutes(
    statusFilter === 'all' ? undefined : { status: statusFilter },
  );
  const { data: vehicles = [] } = useVehicles();
  const { data: drivers = [] } = useDrivers();
  const updateStatus = useUpdateRouteStatus();
  const del = useDeleteRoute();

  const vehicleLabel = (id: string | null) =>
    id ? vehicles.find((v) => v.id === id)?.plate ?? '—' : '—';
  const driverLabel = (id: string | null) =>
    id ? drivers.find((d) => d.id === id)?.name ?? '—' : '—';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{routes.length} {routes.length === 1 ? 'rota' : 'rotas'}</p>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="planned">Planejada</SelectItem>
            <SelectItem value="in_progress">Em rota</SelectItem>
            <SelectItem value="completed">Concluída</SelectItem>
            <SelectItem value="cancelled">Cancelada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground text-center py-6">Carregando…</p>}
      {!isLoading && routes.length === 0 && (
        <Panel flush>
          <EmptyState
            icon={RouteIcon}
            title="Nenhuma rota encontrada"
            description="Vá na aba Pedidos prontos e crie uma rota."
          />
        </Panel>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {routes.map((r) => (
          <Card key={r.id} className="border-border/60">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm truncate">{r.name || `Rota ${r.id.slice(0, 6)}`}</span>
                    <Badge className={`text-xs ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> {formatDate(r.scheduled_date)}
                    <span className="mx-1">·</span>
                    <Truck className="h-3 w-3" /> {vehicleLabel(r.vehicle_id)}
                    <span className="mx-1">·</span>
                    {driverLabel(r.driver_id)}
                  </p>
                </div>
                {perm.canDelete && (
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7 text-destructive shrink-0"
                    onClick={() => { if (confirm('Excluir esta rota?')) del.mutate(r.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Stat icon={<MapPin className="h-3 w-3" />} label="km" value={r.total_distance_km?.toFixed(1) ?? '—'} />
                <Stat icon={<Fuel className="h-3 w-3" />} label="Combustível" value={formatBrl(r.fuel_cost_brl)} />
                <Stat icon={<Wrench className="h-3 w-3" />} label="Desgaste" value={formatBrl(r.wear_cost_brl)} />
                <Stat icon={<Coins className="h-3 w-3" />} label="Total" value={formatBrl(r.total_cost_brl)} highlight />
              </div>
              {r.cost_per_pair != null && (
                <p className="text-xs text-muted-foreground">
                  Custo de entrega por par: <strong className="text-foreground">{formatBrl(r.cost_per_pair)}</strong>
                </p>
              )}

              <div className="flex gap-1 pt-1">
                {r.status === 'planned' && (
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    disabled={updateStatus.isPending}
                    onClick={() => updateStatus.mutate({ id: r.id, status: 'in_progress' })}>
                    Iniciar entrega
                  </Button>
                )}
                {r.status === 'in_progress' && (
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    disabled={updateStatus.isPending}
                    onClick={() => updateStatus.mutate({ id: r.id, status: 'completed' })}>
                    Concluir
                  </Button>
                )}
                {(r.status === 'planned' || r.status === 'in_progress') && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                    disabled={updateStatus.isPending}
                    onClick={() => updateStatus.mutate({ id: r.id, status: 'cancelled' })}>
                    Cancelar
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Stat({
  icon, label, value, highlight,
}: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded p-1.5 ${highlight ? 'bg-primary/5 border border-primary/30' : 'bg-muted/30'}`}>
      <div className="flex items-center gap-1 text-xs uppercase font-bold tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className={`font-mono text-xs leading-tight ${highlight ? 'text-foreground font-bold' : ''}`}>{value}</div>
    </div>
  );
}

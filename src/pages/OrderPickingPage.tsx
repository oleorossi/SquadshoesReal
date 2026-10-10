import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Panel } from '@/components/ui/panel';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package as PackageCheck, MagnifyingGlass as Search, CaretDown as ChevronDown, CaretRight as ChevronRight, Truck, Warning as AlertTriangle, Clock, XCircle, CheckCircle as CheckCircle2, CalendarBlank as CalendarDays } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getISOWeekFromString } from '@/lib/isoWeek';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string;
  reference_name: string | null;
  color: string | null;
  quantity: number;
  grade: Record<string, number> | null;
}

interface ReadyOrder {
  id: string;
  order_version: number;
  order_number: string | null;
  client_name: string | null;
  delivery_deadline: string | null;
  packaging_mode: string | null;
  items: OrderItem[];
  total_pairs: number;
  /** Janela de pickup da onda em que o PV está. null = sem onda atribuída. */
  pickup_window: 'tuesday' | 'friday' | null;
  pickup_date: string | null;
  wave_code: string | null;
}

interface ShipmentCommandResponse {
  ok: boolean;
  shipped_count?: number;
  error?: { message?: string };
}

interface ReadySaleOrderRow {
  id: string;
  order_version: number;
  order_number: string | null;
  client_name: string | null;
  delivery_deadline: string | null;
  packaging_mode: string | null;
  status: string;
  nfe_required: boolean | null;
  nfe_external: boolean | null;
  orders: Array<{ id: string; status: string }> | null;
  sale_order_items: Array<{
    id: string;
    color: string | null;
    quantity: number | null;
    grade: Record<string, number> | null;
    technical_sheets: { name: string | null } | null;
  }> | null;
}

type PickupTabKey = string; // ex: "W2026-19::tuesday" ou "no-wave"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + 'T00:00:00').getTime() - today.getTime()) / 86_400_000);
}

function gradeLabel(grade: Record<string, number> | null, total: number): string {
  if (!grade || Object.keys(grade).length === 0) return `${total} pares`;
  return Object.entries(grade)
    .filter(([, qty]) => qty > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([sz, qty]) => `${sz}:${qty}`)
    .join(' · ');
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderPickingPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [weekFilter, setWeekFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ── Fetch orders ready to ship ──────────────────────────────────────────────
  const { data: orders = [], isLoading } = useQuery<ReadyOrder[]>({
    queryKey: ['orders_ready_to_ship'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_orders')
        .select(`
          id, order_version, order_number, client_name, delivery_deadline,
          packaging_mode, status, nfe_required, nfe_external,
          orders(id, status),
          sale_order_items(id, reference_id, color, quantity, grade,
            technical_sheets:reference_id(name))
        ` as never)
        .in('status', ['Faturado', 'Em Produção'])
        .is('shipped_at' as never, null)
        .order('delivery_deadline', { ascending: true, nullsFirst: false });
      if (error) throw error;

      const rows = (data ?? []) as unknown as ReadySaleOrderRow[];
      // Path informal (Em Produção) alinhado ao Faturado: o romaneio fecha
      // etapas/OPs. Não exigir Finalizado antecipado — só OP ativa no PV.
      const readyCandidates = rows.filter((so) => {
        if (so.status === 'Faturado') return true;
        if (so.status !== 'Em Produção') return false;
        if (so.nfe_required && !so.nfe_external) return false;
        const productionOrders = Array.isArray(so.orders) ? so.orders : [];
        return productionOrders.some((op) =>
          !['Cancelado', 'Cancelada'].includes(op.status),
        );
      });
      const baseOrders = readyCandidates.map((so) => {
        const items: OrderItem[] = (so.sale_order_items ?? []).map((i) => ({
          id: i.id,
          reference_name: i.technical_sheets?.name ?? null,
          color: i.color ?? null,
          quantity: i.quantity ?? 0,
          grade: i.grade ?? null,
        }));
        const total_pairs = items.reduce((s, i) => s + i.quantity, 0);
        return {
          id: so.id,
          order_version: Number(so.order_version),
          order_number: so.order_number,
          client_name: so.client_name,
          delivery_deadline: so.delivery_deadline,
          packaging_mode: so.packaging_mode,
          items,
          total_pairs,
          pickup_window: null as ReadyOrder['pickup_window'],
          pickup_date: null as string | null,
          wave_code: null as string | null,
        };
      });

      // Ondas aposentadas (remodelagem 2026-07-12, specs/remodelagem-producao.md
      // R9): a janela de pickup por onda deixou de existir — os PVs caem no
      // agrupamento "sem onda" e a conferência segue normal. Os campos
      // pickup_window/pickup_date/wave_code ficam null.
      return baseOrders;
    },
    staleTime: 60_000,
  });

  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      const name = (o.client_name || '').trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [orders]);

  // ── Filtered list ───────────────────────────────────────────────────────────
  const searchFiltered = useMemo(() => {
    return orders.filter((o) => {
      if (clientFilter !== 'all' && (o.client_name || '').trim() !== clientFilter) return false;
      if (weekFilter !== 'all' && !matchesDeliveryWeek(o.delivery_deadline, weekFilter)) return false;
      if (!search.trim()) return true;
      return matchesOrderSearch(search, {
        saleOrderNumber: o.order_number,
        clientName: o.client_name,
        referenceName: o.items.map((i) => i.reference_name).join(' '),
        color: o.items.map((i) => i.color).join(' '),
      });
    });
  }, [orders, search, clientFilter, weekFilter]);

  // ── Agrupamento por janela de pickup (semana ISO + Ter/Sex) ────────────────
  type PickupGroup = {
    key: PickupTabKey;
    label: string;
    weekCode: string;
    pickupWindow: 'tuesday' | 'friday' | null;
    pickupDate: string | null;
    orders: ReadyOrder[];
  };

  const pickupGroups = useMemo((): PickupGroup[] => {
    const map = new Map<PickupTabKey, PickupGroup>();
    for (const o of searchFiltered) {
      let key: PickupTabKey;
      let label: string;
      let weekCode = '—';
      if (o.pickup_window && o.wave_code) {
        weekCode = o.wave_code;
        key = `${o.wave_code}::${o.pickup_window}`;
        label = `${o.wave_code} · ${o.pickup_window === 'tuesday' ? 'Terça' : 'Sexta'}`;
      } else {
        // Sem onda: agrupa por semana ISO do delivery_deadline (fallback).
        const iso = getISOWeekFromString(o.delivery_deadline);
        weekCode = iso?.code ?? 'sem-prazo';
        key = `no-wave::${weekCode}`;
        label = `Sem onda · ${weekCode}`;
      }
      if (!map.has(key)) {
        map.set(key, {
          key,
          label,
          weekCode,
          pickupWindow: o.pickup_window,
          pickupDate: o.pickup_date,
          orders: [],
        });
      }
      map.get(key)!.orders.push(o);
    }
    // Ordena: tuesday antes de friday dentro da mesma semana, semanas em ordem ASC.
    return Array.from(map.values()).sort((a, b) => {
      if (a.weekCode !== b.weekCode) return a.weekCode.localeCompare(b.weekCode);
      const order: Record<string, number> = { tuesday: 0, friday: 1 };
      const ax = a.pickupWindow ? order[a.pickupWindow] : 99;
      const bx = b.pickupWindow ? order[b.pickupWindow] : 99;
      return ax - bx;
    });
  }, [searchFiltered]);

  const [activeTab, setActiveTab] = useState<string>('all');
  const filtered = useMemo(() => {
    if (activeTab === 'all') return searchFiltered;
    const grp = pickupGroups.find((g) => g.key === activeTab);
    return grp?.orders ?? [];
  }, [activeTab, pickupGroups, searchFiltered]);

  const sel = useMarqueeSelection(filtered, (o) => o.id);

  const pastedCodes = useMemo(() => parseOrderCodeList(search), [search]);
  const matchedCodeIds = useMemo(
    () => findIdsMatchingOrderCodes(orders, pastedCodes, (o) => ({
      id: o.id,
      saleOrderNumber: o.order_number,
    })),
    [orders, pastedCodes],
  );

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((o) => sel.isSelected(o.id));
  const toggleVisible = () => {
    if (allVisibleSelected) sel.deselectVisible();
    else sel.selectAll();
  };

  // ── Confirm shipment ────────────────────────────────────────────────────────
  const confirmShipment = useMutation({
    mutationFn: async (ids: string[]) => {
      const selectedOrders = ids.map(id => orders.find(order => order.id === id));
      if (selectedOrders.some(order => !order || !Number.isInteger(order.order_version))) {
        throw new Error('Versão de um ou mais PVs não está disponível. Recarregue a conferência.');
      }
      const expectedVersions = Object.fromEntries(
        selectedOrders.map(order => [order!.id, order!.order_version]),
      );
      // PV, OPs, rota e vínculo com manifesto fecham na mesma transação.
      const requestId = crypto.randomUUID();
      const { data, error: rpcErr } = await supabase.rpc('register_order_shipment_command' as never, {
        p_sale_order_ids: ids,
        p_expected_versions: expectedVersions,
        p_manifest_id: null,
        p_checked_by: null,
        p_client_request_id: requestId,
      } as never);
      if (rpcErr) throw rpcErr;
      const response = data as unknown as ShipmentCommandResponse;
      if (!response?.ok) throw new Error(response?.error?.message || 'Expedição recusada pelo servidor.');
      return Number(response.shipped_count ?? ids.length);
    },
    onSuccess: (count, ids) => {
      if (count < ids.length) {
        toast.warning(`${count} de ${ids.length} pedido(s) expedido(s) — alguns já estavam expedidos.`);
      } else {
        toast.success(`${count} pedido(s) registrado(s) como expedido(s).`);
      }
      sel.clear();
      qc.invalidateQueries({ queryKey: ['orders_ready_to_ship'] });
      qc.invalidateQueries({ queryKey: ['expedicaoStats'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });

  const handleBulkShip = () => {
    if (sel.count === 0) return;
    if (!confirmIfHiddenSelection({
      totalSelected: sel.count,
      hiddenSelectedCount: sel.hiddenSelectedCount,
      entityLabel: 'PV',
      actionLabel: 'Registrar expedição de',
    })) return;
    confirmShipment.mutate(Array.from(sel.selectedIds));
  };

  const toggleExpand = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
  const today = format(todayDate, 'yyyy-MM-dd');
  const overdue = orders.filter(o => o.delivery_deadline && o.delivery_deadline < today).length;
  const dueToday = orders.filter(o => o.delivery_deadline === today).length;

  return (
    <div className="space-y-5 page-enter p-6">
      {/* Header */}
      <EditorialPageHeader
        sectionLabel="LOGÍSTICA · CONFERÊNCIA"
        title="Conferência de Saída"
        description="Pedidos com produção concluída aguardando conferência e expedição"
        actions={
          sel.count > 0 ? (
            <Button
              onClick={handleBulkShip}
              disabled={confirmShipment.isPending}
            >
              <Truck className="w-4 h-4 mr-1.5" />
              Registrar expedição ({sel.count}
              {sel.hiddenSelectedCount > 0 ? ` · ${sel.hiddenSelectedCount} fora` : ''})
            </Button>
          ) : undefined
        }
      />

      {/* KPI strip — kit editorial (StatCard) derivado de dados reais */}
      <StatGrid>
        <StatCard
          label="Prontos"
          value={orders.length}
          hint="aguardando expedição"
          icon={PackageCheck}
        />
        <StatCard
          label="Atrasados"
          value={overdue}
          hint="prazo vencido"
          icon={XCircle}
          tone={overdue > 0 ? 'destructive' : 'default'}
        />
        <StatCard
          label="Vencem hoje"
          value={dueToday}
          hint="prazo é hoje"
          icon={Clock}
          tone={dueToday > 0 ? 'warning' : 'default'}
        />
      </StatGrid>

      {/* Tabs por janela de pickup (semana ISO + Ter/Sex) */}
      {pickupGroups.length > 0 && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="all" className="gap-1.5 text-xs h-8">
              <CalendarDays className="h-3.5 w-3.5" />
              Todas ({searchFiltered.length})
            </TabsTrigger>
            {pickupGroups.map((g) => {
              const isTue = g.pickupWindow === 'tuesday';
              const isFri = g.pickupWindow === 'friday';
              const dateLabel = g.pickupDate ? format(new Date(g.pickupDate + 'T00:00:00'), 'dd/MM', { locale: ptBR }) : null;
              return (
                <TabsTrigger
                  key={g.key}
                  value={g.key}
                  className={cn(
                    'gap-1.5 text-xs h-8',
                    isTue && 'data-[state=active]:bg-blue-500/10 data-[state=active]:text-blue-700',
                    isFri && 'data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-700',
                  )}
                >
                  <Truck className="h-3.5 w-3.5" />
                  {g.label}
                  {dateLabel && <span className="font-mono text-xs opacity-80">{dateLabel}</span>}
                  <span className="opacity-60">({g.orders.length})</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      )}

      <OrderMultiSelectToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar PV, cliente, ref/cor ou ref;cor…"
        resultCount={searchFiltered.length}
        totalCount={orders.length}
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

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
          Carregando pedidos...
        </div>
      ) : filtered.length === 0 ? (
        <Panel flush>
          {search.trim() || clientFilter !== 'all' || weekFilter !== 'all' ? (
            <EmptyState
              size="sm"
              icon={Search}
              title={`Nenhum resultado para o filtro atual`}
              action={
                <Button variant="outline" size="sm" onClick={() => { setSearch(''); setClientFilter('all'); setWeekFilter('all'); }}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="Nenhum pedido aguardando expedição"
              description="Todos os pedidos finalizados foram despachados."
            />
          )}
        </Panel>
      ) : (
        <Panel
          eyebrow="LOGÍSTICA · SEPARAÇÃO"
          title={
            <span className="flex items-center gap-2">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={toggleVisible}
              />
              Visíveis ({filtered.length})
              {sel.count > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  · {sel.count} selecionado{sel.count === 1 ? '' : 's'}
                  {sel.hiddenSelectedCount > 0 ? ` (${sel.hiddenSelectedCount} fora)` : ''}
                </span>
              )}
            </span>
          }
          flush
        >
          <div
            ref={sel.containerRef}
            data-marquee-container
            onMouseDown={sel.onContainerMouseDown}
            className="relative overflow-x-auto"
          >
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="sticky top-0 z-sticky bg-muted/40 backdrop-blur-sm hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead className="w-10 pl-4" />
                  <TableHead className="w-8" />
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right tabular-nums">Pares</TableHead>
                  <TableHead>Embalagem</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead className="text-right pr-4">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(order => {
                  const days = daysUntil(order.delivery_deadline);
                  const isOverdue = days !== null && days < 0;
                  const isDueToday = days === 0;
                  const isDueSoon = days !== null && days > 0 && days <= 2;
                  const isExpanded = expanded.has(order.id);
                  const isSelected = sel.isSelected(order.id);

                  return (
                    <React.Fragment key={order.id}>
                      <TableRow
                        data-marquee-item
                        data-marquee-id={order.id}
                        className={cn(
                          'cursor-pointer hover:bg-muted/30 transition-colors',
                          isSelected && 'bg-primary/5 ring-1 ring-inset ring-success/30',
                          isOverdue && 'bg-destructive/5 hover:bg-destructive/10',
                          isDueToday && 'bg-amber-500/5 hover:bg-amber-500/10',
                        )}
                        onClick={() => toggleExpand(order.id)}
                      >
                        <TableCell className="pl-4" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => sel.toggle(order.id)}
                          />
                        </TableCell>
                        <TableCell>
                          {isExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-mono font-semibold text-sm">
                          {order.order_number ?? '—'}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {order.client_name ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {order.total_pairs}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {order.packaging_mode || 'Padrão'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {order.delivery_deadline ? (
                            <span className={cn(
                              'text-sm font-medium flex items-center gap-1 tabular-nums',
                              isOverdue ? 'text-destructive' : isDueToday ? 'text-amber-600' : isDueSoon ? 'text-amber-500' : 'text-muted-foreground',
                            )}>
                              {isOverdue && <XCircle className="h-3 w-3" />}
                              {isDueToday && <Clock className="h-3 w-3" />}
                              {isDueSoon && !isDueToday && <AlertTriangle className="h-3 w-3" />}
                              {format(new Date(order.delivery_deadline + 'T00:00:00'), 'dd/MM/yy', { locale: ptBR })}
                              {days !== null && days < 0 && ` (${Math.abs(days)}d atraso)`}
                              {days === 0 && ' (hoje)'}
                            </span>
                          ) : <span className="text-muted-foreground text-sm">—</span>}
                        </TableCell>
                        <TableCell className="text-right pr-4" onClick={e => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (!confirmIfHiddenSelection({
                                totalSelected: 1,
                                hiddenSelectedCount: 0,
                                entityLabel: 'PV',
                                actionLabel: 'Expedir',
                              })) return;
                              confirmShipment.mutate([order.id]);
                            }}
                            disabled={confirmShipment.isPending}
                          >
                            <Truck className="w-3 h-3 mr-1" />
                            Expedir
                          </Button>
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow key={`${order.id}-detail`} className="bg-muted/20 hover:bg-muted/30">
                          <TableCell colSpan={8} className="pl-12 py-3">
                            <div className="space-y-1.5">
                              {order.items.map(item => (
                                <div key={item.id} className="flex items-center gap-3 text-sm">
                                  <span className="font-medium w-48 truncate">
                                    {item.reference_name ?? '—'}
                                  </span>
                                  {item.color && (
                                    <Badge variant="outline" className="text-xs shrink-0">
                                      {item.color}
                                    </Badge>
                                  )}
                                  <span className="text-muted-foreground font-mono text-xs">
                                    {gradeLabel(item.grade, item.quantity)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <MarqueeOverlay rect={sel.marqueeRect} />
          </div>
        </Panel>
      )}
    </div>
  );
}

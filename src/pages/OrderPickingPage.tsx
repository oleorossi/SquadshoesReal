import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  PackageCheck, Search, ChevronDown, ChevronRight,
  Truck, AlertTriangle, Clock, XCircle, CheckCircle2, CalendarDays,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { READY_TO_SHIP_STATUSES } from '@/lib/logistics/routeManagement';
import { getISOWeekFromString, fmtDayMonthBR } from '@/lib/isoWeek';

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ── Fetch orders ready to ship ──────────────────────────────────────────────
  const { data: orders = [], isLoading } = useQuery<ReadyOrder[]>({
    queryKey: ['orders_ready_to_ship'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_orders')
        .select(`
          id, order_number, client_name, delivery_deadline, packaging_mode,
          sale_order_items(id, reference_id, color, quantity, grade,
            technical_sheets:reference_id(name))
        `)
        .in('status', [...READY_TO_SHIP_STATUSES])
        .is('shipped_at' as any, null)
        .order('delivery_deadline', { ascending: true, nullsFirst: false });
      if (error) throw error;

      const baseOrders = (data ?? []).map((so: any) => {
        const items: OrderItem[] = (so.sale_order_items ?? []).map((i: any) => ({
          id: i.id,
          reference_name: i.technical_sheets?.name ?? null,
          color: i.color ?? null,
          quantity: i.quantity ?? 0,
          grade: i.grade ?? null,
        }));
        const total_pairs = items.reduce((s, i) => s + i.quantity, 0);
        return {
          id: so.id,
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

      const ids = baseOrders.map((o) => o.id);
      if (!ids.length) return baseOrders;

      // Carrega janela de pickup por PV via wave_items + waves.
      // Um PV pode ter múltiplos items na mesma wave (cores/refs); pegamos o
      // pickup_window do PRIMEIRO item por block_sequence (representa o item mais
      // urgente do PV — se TER, tudo do PV sai TER; se FRI, sai FRI).
      const { data: waveLink } = await supabase
        .from('production_wave_item_sources' as any)
        .select(`
          sale_order_id,
          production_wave_items!inner(
            wave_id, pickup_window, block_sequence,
            production_waves!inner(code, status, pickup_tuesday_date, pickup_friday_date)
          )
        `)
        .in('sale_order_id', ids)
        .in('production_wave_items.production_waves.status', ['draft','planning','running']);

      const linkMap = new Map<string, { window: 'tuesday'|'friday'|null; date: string|null; code: string|null; seq: number }>();
      for (const row of (waveLink ?? []) as any[]) {
        if (!row.sale_order_id) continue;
        const wi = row.production_wave_items;
        const pw = wi?.production_waves;
        if (!wi || !pw) continue;
        const win = wi.pickup_window as 'tuesday'|'friday'|null;
        const seq = Number(wi.block_sequence ?? 9_999_999);
        const date = win === 'tuesday' ? pw.pickup_tuesday_date
                   : win === 'friday'  ? pw.pickup_friday_date
                   : null;
        const existing = linkMap.get(row.sale_order_id);
        if (!existing || seq < existing.seq) {
          linkMap.set(row.sale_order_id, { window: win, date, code: pw.code ?? null, seq });
        }
      }

      return baseOrders.map((o) => {
        const link = linkMap.get(o.id);
        return link
          ? { ...o, pickup_window: link.window, pickup_date: link.date, wave_code: link.code }
          : o;
      });
    },
    staleTime: 60_000,
  });

  // ── Confirm shipment ────────────────────────────────────────────────────────
  const confirmShipment = useMutation({
    mutationFn: async (ids: string[]) => {
      // Atomic: sets shipped_at + optional manifest link via SELECT FOR UPDATE
      const { data: count, error: rpcErr } = await supabase.rpc('register_order_shipment' as any, {
        p_sale_order_ids: ids,
        p_manifest_id: null,
        p_checked_by: null,
      });
      if (rpcErr) throw rpcErr;
      // register_order_shipment already sets status='Expedido' server-side
      return Number(count ?? ids.length);
    },
    onSuccess: (count, ids) => {
      if (count < ids.length) {
        toast.warning(`${count} de ${ids.length} pedido(s) expedido(s) — alguns já estavam expedidos.`);
      } else {
        toast.success(`${count} pedido(s) registrado(s) como expedido(s).`);
      }
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['orders_ready_to_ship'] });
      qc.invalidateQueries({ queryKey: ['expedicaoStats'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });

  // ── Filtered list ───────────────────────────────────────────────────────────
  const searchFiltered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter(o =>
      (o.order_number ?? '').toLowerCase().includes(q) ||
      (o.client_name ?? '').toLowerCase().includes(q),
    );
  }, [orders, search]);

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

  const toggleSelect = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleAll = () => {
    const allShown = filtered.every(o => selected.has(o.id));
    setSelected(allShown ? new Set() : new Set(filtered.map(o => o.id)));
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <PackageCheck className="w-6 h-6 text-primary" />
            Conferência de Saída
          </h1>
          <p className="text-sm text-muted-foreground">
            Pedidos com produção concluída aguardando conferência e expedição
          </p>
        </div>
        {selected.size > 0 && (
          <Button
            onClick={() => confirmShipment.mutate(Array.from(selected))}
            disabled={confirmShipment.isPending}
          >
            <Truck className="w-4 h-4 mr-1.5" />
            Registrar expedição ({selected.size})
          </Button>
        )}
      </div>

      {/* KPI strip */}
      <div className="flex gap-3 flex-wrap">
        <Badge variant="outline" className="gap-1.5 px-3 py-1.5 text-sm">
          <PackageCheck className="h-3.5 w-3.5" />
          {orders.length} prontos
        </Badge>
        {overdue > 0 && (
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5 text-sm bg-destructive/10 text-destructive border-destructive/20">
            <XCircle className="h-3.5 w-3.5" />
            {overdue} atrasado{overdue !== 1 ? 's' : ''}
          </Badge>
        )}
        {dueToday > 0 && (
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5 text-sm bg-amber-500/10 text-amber-600 border-amber-500/20">
            <Clock className="h-3.5 w-3.5" />
            {dueToday} vencem hoje
          </Badge>
        )}
      </div>

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
                  {dateLabel && <span className="font-mono text-[10px] opacity-80">{dateLabel}</span>}
                  <span className="opacity-60">({g.orders.length})</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por PV ou cliente..."
          className="pl-9"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
          Carregando pedidos...
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-success/40" />
            <p className="font-semibold">Nenhum pedido aguardando expedição</p>
            <p className="text-sm text-muted-foreground">
              Todos os pedidos finalizados foram despachados.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="flex items-center gap-2">
                <Checkbox
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onCheckedChange={toggleAll}
                />
                Selecionar todos ({filtered.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4" />
                  <TableHead className="w-8" />
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Pares</TableHead>
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

                  return (
                    <React.Fragment key={order.id}>
                      <TableRow
                        className={cn(
                          'cursor-pointer',
                          isOverdue && 'bg-destructive/5 hover:bg-destructive/10',
                          isDueToday && 'bg-amber-500/5 hover:bg-amber-500/10',
                        )}
                        onClick={() => toggleExpand(order.id)}
                      >
                        <TableCell className="pl-4" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.has(order.id)}
                            onCheckedChange={() => toggleSelect(order.id)}
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
                          <Badge variant="outline" className="text-[10px]">
                            {order.packaging_mode || 'Padrão'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {order.delivery_deadline ? (
                            <span className={cn(
                              'text-sm font-medium flex items-center gap-1',
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
                            onClick={() => confirmShipment.mutate([order.id])}
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
                                    <Badge variant="outline" className="text-[10px] shrink-0">
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type RouteStatus = 'draft' | 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type StopStatus = 'pending' | 'delivered' | 'refused' | 'skipped';

export interface DeliveryRoute {
  id: string;
  name: string | null;
  scheduled_date: string;
  vehicle_id: string | null;
  driver_id: string | null;
  origin_address: { label?: string; latitude?: number; longitude?: number } | null;
  total_distance_km: number | null;
  estimated_duration_min: number | null;
  fuel_cost_brl: number | null;
  wear_cost_brl: number | null;
  total_cost_brl: number | null;
  cost_per_pair: number | null;
  status: RouteStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryRouteStop {
  id: string;
  route_id: string;
  sale_order_id: string | null;
  stop_order: number;
  address_snapshot: {
    label?: string;
    razao_social?: string;
    endereco?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    cep?: string;
    branch_code?: string;
    branch_name?: string;
    cnpj?: string;
  };
  latitude: number | null;
  longitude: number | null;
  distance_from_previous_km: number | null;
  eta_minutes_from_start: number | null;
  status: StopStatus;
  delivered_at: string | null;
  receiver_name: string | null;
  notes: string | null;
}

export interface CreateRoutePayload {
  route: {
    name?: string;
    scheduled_date: string;
    vehicle_id: string | null;
    driver_id: string | null;
    origin_address?: DeliveryRoute['origin_address'];
    notes?: string;
    status?: RouteStatus;
  };
  stops: Array<Omit<DeliveryRouteStop, 'id' | 'route_id'>>;
}

// ============= ROUTES =============

export function useDeliveryRoutes(filters?: { status?: RouteStatus; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['delivery_routes', filters],
    queryFn: async () => {
      let query = (supabase.from as any)('delivery_routes')
        .select('*')
        .order('scheduled_date', { ascending: false });
      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.from) query = query.gte('scheduled_date', filters.from);
      if (filters?.to) query = query.lte('scheduled_date', filters.to);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as DeliveryRoute[];
    },
    staleTime: 60 * 1000,
  });
}

export function useDeliveryRouteStops(routeId: string | null) {
  return useQuery({
    queryKey: ['delivery_route_stops', routeId],
    queryFn: async () => {
      if (!routeId) return [];
      const { data, error } = await (supabase.from as any)('delivery_route_stops')
        .select('*')
        .eq('route_id', routeId)
        .order('stop_order');
      if (error) throw error;
      return (data || []) as DeliveryRouteStop[];
    },
    enabled: !!routeId,
  });
}

export function useCreateDeliveryRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateRoutePayload) => {
      const { data: route, error: routeErr } = await (supabase.from as any)('delivery_routes')
        .insert({ ...payload.route, status: payload.route.status ?? 'planned' })
        .select()
        .single();
      if (routeErr) throw routeErr;

      if (payload.stops.length > 0) {
        const rows = payload.stops.map((s) => ({ ...s, route_id: route.id }));
        const { error: stopsErr } = await (supabase.from as any)('delivery_route_stops').insert(rows);
        if (stopsErr) {
          await (supabase.from as any)('delivery_routes').delete().eq('id', route.id);
          throw stopsErr;
        }
      }

      const { error: rpcErr } = await (supabase.rpc as any)('recalc_delivery_route_costs', { p_route_id: route.id });
      if (rpcErr) {
        console.warn('[useCreateDeliveryRoute] recalc falhou (rota criada, custos vazios):', rpcErr.message);
      }

      return route as DeliveryRoute;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery_routes'] });
      qc.invalidateQueries({ queryKey: ['delivery_route_stops'] });
      qc.invalidateQueries({ queryKey: ['own_delivery_orders'] });
      toast.success('Rota criada!');
    },
    onError: (err: Error) => toast.error(`Erro ao criar rota: ${err.message}`),
  });
}

export function useUpdateRouteStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RouteStatus }) => {
      const { error } = await (supabase.from as any)('delivery_routes').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery_routes'] });
      qc.invalidateQueries({ queryKey: ['own_delivery_orders'] });
      toast.success('Status da rota atualizado.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateRouteStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<DeliveryRouteStop> }) => {
      const { error } = await (supabase.from as any)('delivery_route_stops').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery_route_stops'] });
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from as any)('delivery_routes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery_routes'] });
      qc.invalidateQueries({ queryKey: ['own_delivery_orders'] });
      toast.success('Rota removida.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ============= PEDIDOS DISPONÍVEIS PRA ROTA =============

export interface OwnDeliveryOrder {
  id: string;
  order_number: string;
  status: string;
  client_id: string | null;
  client_name: string | null;
  client_cnpj: string | null;
  total_pairs: number | null;
  delivery_deadline: string | null;
  /** Cliente JOIN */
  client?: {
    razao_social?: string;
    endereco?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    cep?: string;
    branch_code?: string;
    branch_name?: string;
    cnpj?: string;
  } | null;
  /** Se já está em alguma rota não cancelada. */
  current_route_id?: string | null;
}

export function useOwnDeliveryOrders() {
  return useQuery({
    queryKey: ['own_delivery_orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_orders')
        .select(`
          id, order_number, status, client_id, client_name, client_cnpj,
          delivery_deadline,
          clients(razao_social, endereco, bairro, cidade, estado, cep, branch_code, branch_name, cnpj),
          sale_order_items(quantity)
        `)
        .eq('own_delivery' as any, true)
        .order('delivery_deadline', { ascending: true, nullsFirst: false });
      if (error) throw error;

      const orders = (data || []) as any[];
      const ids = orders.map((o) => o.id);
      const assignedMap = new Map<string, string>();
      if (ids.length > 0) {
        const { data: stops } = await (supabase.from as any)('delivery_route_stops')
          .select('sale_order_id, route_id, delivery_routes!inner(status)')
          .in('sale_order_id', ids)
          .neq('delivery_routes.status', 'cancelled');
        for (const s of (stops || []) as any[]) {
          if (s.sale_order_id && !assignedMap.has(s.sale_order_id)) {
            assignedMap.set(s.sale_order_id, s.route_id);
          }
        }
      }

      return orders.map((o) => {
        const items = (o.sale_order_items || []) as { quantity: number | null }[];
        const totalPairs = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
        return {
          id: o.id,
          order_number: o.order_number,
          status: o.status,
          client_id: o.client_id,
          client_name: o.client_name,
          client_cnpj: o.client_cnpj,
          total_pairs: totalPairs,
          delivery_deadline: o.delivery_deadline,
          client: o.clients || null,
          current_route_id: assignedMap.get(o.id) || null,
        };
      }) as OwnDeliveryOrder[];
    },
    staleTime: 60 * 1000,
  });
}

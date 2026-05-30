import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface Vehicle {
  id: string;
  plate: string;
  model: string | null;
  type: string | null;
  capacity_kg: number | null;
  capacity_m3: number | null;
  fuel_type: string | null;
  fuel_consumption_km_l: number | null;
  wear_cost_per_km: number | null;
  default_driver_id: string | null;
  active: boolean;
}

export interface Driver {
  id: string;
  name: string;
  cnh: string | null;
  phone: string | null;
  active: boolean;
}

export interface DeliveryRouteSummary {
  id: string;
  name: string;
  scheduled_date: string | null;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled' | string;
  total_distance_km: number | null;
  estimated_duration_min: number | null;
  fuel_cost_brl: number | null;
  wear_cost_brl: number | null;
  total_cost_brl: number | null;
  cost_per_pair: number | null;
  notes: string | null;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  driver_id: string | null;
  driver_name: string | null;
  total_stops: number;
  delivered_stops: number;
  pending_stops: number;
}

export interface RouteStop {
  id: string;
  route_id: string;
  sale_order_id: string | null;
  stop_order: number;
  address_snapshot: any;
  latitude: number | null;
  longitude: number | null;
  distance_from_previous_km: number | null;
  eta_minutes_from_start: number | null;
  status: 'pending' | 'delivered' | 'failed' | string;
  delivered_at: string | null;
  receiver_name: string | null;
  notes: string | null;
}

export function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: async (): Promise<Vehicle[]> => {
      const { data, error } = await (supabase as any).from('vehicles').select('*').order('plate');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useDrivers() {
  return useQuery({
    queryKey: ['drivers'],
    queryFn: async (): Promise<Driver[]> => {
      const { data, error } = await (supabase as any).from('drivers').select('*').order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useDeliveryRoutes() {
  return useQuery({
    queryKey: ['delivery_routes_summary'],
    queryFn: async (): Promise<DeliveryRouteSummary[]> => {
      const { data, error } = await (supabase as any).from('v_delivery_routes_summary').select('*').limit(200);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });
}

export function useRouteStops(routeId: string | null | undefined) {
  return useQuery({
    queryKey: ['route_stops', routeId],
    enabled: !!routeId,
    queryFn: async (): Promise<RouteStop[]> => {
      if (!routeId) return [];
      const { data, error } = await (supabase as any)
        .from('delivery_route_stops')
        .select('*')
        .eq('route_id', routeId)
        .order('stop_order');
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Vehicle> & { plate: string }) => {
      const { data, error } = await (supabase as any).from('vehicles').insert(input as any).select().single();
      if (error) throw new Error(error.message);
      return data as Vehicle;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicles'] }); toast.success('Veículo criado'); },
    onError: (err: any) => toast.error(err?.message || 'Erro ao criar veículo'),
  });
}

export function useCreateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Driver> & { name: string }) => {
      const { data, error } = await (supabase as any).from('drivers').insert(input as any).select().single();
      if (error) throw new Error(error.message);
      return data as Driver;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['drivers'] }); toast.success('Motorista criado'); },
    onError: (err: any) => toast.error(err?.message || 'Erro ao criar motorista'),
  });
}

export function useCreateDeliveryRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; scheduledDate?: string | null; vehicleId?: string | null; driverId?: string | null; notes?: string | null }) => {
      const { data, error } = await (supabase as any).from('delivery_routes').insert({
        name: input.name,
        scheduled_date: input.scheduledDate ?? null,
        vehicle_id: input.vehicleId ?? null,
        driver_id: input.driverId ?? null,
        notes: input.notes ?? null,
        status: 'planned',
      } as any).select('id').single();
      if (error) throw new Error(error.message);
      return data.id as string;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery_routes_summary'] }); toast.success('Rota criada'); },
    onError: (err: any) => toast.error(err?.message || 'Erro ao criar rota'),
  });
}

export function useAddRouteStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { routeId: string; saleOrderId: string; stopOrder?: number; addressSnapshot?: any; etaMinutes?: number | null; notes?: string | null }) => {
      // Determina stop_order automaticamente se não vier (próximo MAX+1)
      let stopOrder = input.stopOrder;
      if (stopOrder == null) {
        const { data: existing } = await (supabase as any)
          .from('delivery_route_stops')
          .select('stop_order')
          .eq('route_id', input.routeId)
          .order('stop_order', { ascending: false })
          .limit(1);
        stopOrder = ((existing?.[0]?.stop_order as number) ?? 0) + 1;
      }
      const { error } = await (supabase as any).from('delivery_route_stops').insert({
        route_id: input.routeId,
        sale_order_id: input.saleOrderId,
        stop_order: stopOrder,
        address_snapshot: input.addressSnapshot ?? null,
        eta_minutes_from_start: input.etaMinutes ?? null,
        notes: input.notes ?? null,
        status: 'pending',
      } as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['route_stops', vars.routeId] });
      qc.invalidateQueries({ queryKey: ['delivery_routes_summary'] });
      toast.success('Parada adicionada');
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao adicionar parada'),
  });
}

export function useMarkStopDelivered() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { stopId: string; receiverName?: string; notes?: string; latitude?: number; longitude?: number; routeId: string }) => {
      const { error } = await (supabase as any).rpc('mark_stop_delivered', {
        p_stop_id: input.stopId,
        p_receiver_name: input.receiverName ?? null,
        p_notes: input.notes ?? null,
        p_latitude: input.latitude ?? null,
        p_longitude: input.longitude ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['route_stops', vars.routeId] });
      qc.invalidateQueries({ queryKey: ['delivery_routes_summary'] });
      toast.success('Parada entregue');
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao marcar entrega'),
  });
}

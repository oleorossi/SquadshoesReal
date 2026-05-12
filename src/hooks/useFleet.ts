import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type FuelType = 'gasolina' | 'diesel' | 'etanol' | 'flex';

export interface Driver {
  id: string;
  name: string;
  cnh: string | null;
  phone: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Vehicle {
  id: string;
  plate: string;
  model: string | null;
  type: string | null;
  capacity_kg: number | null;
  capacity_m3: number | null;
  fuel_type: FuelType;
  fuel_consumption_km_l: number;
  wear_cost_per_km: number;
  default_driver_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FuelPrice {
  fuel_type: 'gasolina' | 'diesel' | 'etanol';
  price_per_liter: number;
  updated_at: string;
  updated_by: string | null;
}

export type DriverFormData = Omit<Driver, 'id' | 'created_at' | 'updated_at'>;
export type VehicleFormData = Omit<Vehicle, 'id' | 'created_at' | 'updated_at'>;

// ============= DRIVERS =============

export function useDrivers() {
  return useQuery({
    queryKey: ['drivers'],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)('drivers')
        .select('*')
        .order('name');
      if (error) throw error;
      return (data || []) as Driver[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: DriverFormData) => {
      const { data, error } = await (supabase.from as any)('drivers')
        .insert(form)
        .select()
        .single();
      if (error) throw error;
      return data as Driver;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      toast.success('Motorista cadastrado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<DriverFormData> }) => {
      const { error } = await (supabase.from as any)('drivers').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      toast.success('Motorista atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from as any)('drivers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      toast.success('Motorista excluído!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ============= VEHICLES =============

export function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)('vehicles')
        .select('*')
        .order('plate');
      if (error) throw error;
      return (data || []) as Vehicle[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: VehicleFormData) => {
      const { data, error } = await (supabase.from as any)('vehicles')
        .insert(form)
        .select()
        .single();
      if (error) throw error;
      return data as Vehicle;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Veículo cadastrado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<VehicleFormData> }) => {
      const { error } = await (supabase.from as any)('vehicles').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Veículo atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from as any)('vehicles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Veículo excluído!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ============= FUEL PRICES =============

export function useFuelPrices() {
  return useQuery({
    queryKey: ['fuel_prices'],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)('fuel_prices').select('*');
      if (error) throw error;
      return (data || []) as FuelPrice[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateFuelPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fuel_type, price_per_liter }: { fuel_type: FuelPrice['fuel_type']; price_per_liter: number }) => {
      const { error } = await (supabase.from as any)('fuel_prices')
        .update({ price_per_liter, updated_at: new Date().toISOString() })
        .eq('fuel_type', fuel_type);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel_prices'] });
      toast.success('Preço de combustível atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

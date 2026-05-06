 import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
 import { logAuditEvent } from '@/services/auditService';

export function useLotTracking(productId?: string) {
  return useQuery({
    queryKey: ['lot_tracking', productId],
    queryFn: async () => {
      let query = supabase
        .from('lot_tracking')
        .select('*, products(name, sku, unit), suppliers(name), bin_locations(code, name)')
        .order('received_date', { ascending: false });
      if (productId) query = query.eq('product_id', productId);
      const { data, error } = await query.limit(300);
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lot: {
      product_id: string;
      lot_number?: string;
      supplier_lot?: string;
      supplier_id?: string;
      invoice_id?: string;
      quantity_received: number;
      unit_cost: number;
      expiry_date?: string;
      bin_location_id?: string;
      notes?: string;
    }) => {
       if (!Number.isFinite(lot.quantity_received) || lot.quantity_received <= 0) {
         throw new Error('Quantidade recebida deve ser um número positivo.');
       }
       if (!Number.isFinite(lot.unit_cost) || lot.unit_cost < 0) {
         throw new Error('Custo unitário deve ser um número não-negativo.');
       }
       const lotData = {
         ...lot,
         quantity_available: lot.quantity_received,
         lot_number: lot.lot_number || `LT-${Date.now()}`,
       };
 
       const { data, error } = await supabase.from('lot_tracking').insert(lotData as any).select().single();
      if (error) throw error;
 
       await logAuditEvent({
         action: 'create',
         resource: 'lot_tracking',
         resourceId: data?.id || null,
         newData: lotData,
         userId: null,
         ipAddress: null,
         userAgent: navigator.userAgent,
         success: true
       });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lot_tracking'] });
      toast.success('Lote registrado!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useBinLocations() {
  return useQuery({
    queryKey: ['bin_locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bin_locations')
        .select('*')
        .eq('active', true)
        .order('code', { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateBinLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bin: {
      code: string;
      name: string;
      warehouse?: string;
      zone?: string;
      aisle?: string;
      rack?: string;
      shelf?: string;
      bin?: string;
      capacity?: number;
    }) => {
      const { error } = await supabase.from('bin_locations').insert(bin as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bin_locations'] });
      toast.success('Localização criada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

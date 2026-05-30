import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Reescrito em 30/05/2026 (auditoria item 6). Versão legacy continha
// useLotTracking/useCreateLot/useBinLocations/useCreateBinLocation sem
// nenhum caller — dead code. Substituído por hooks ancorados nas RPCs
// novas (record_lot_intake, consume_from_lot) e nas views
// v_lots_active e v_order_lot_traceability. Cadastro de bin_locations
// fica em src/hooks/useBinLocations.ts (mais completo).

export interface ActiveLot {
  id: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  lot_number: string;
  supplier_lot: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  quantity_received: number;
  quantity_available: number;
  quantity_consumed: number;
  unit_cost: number | null;
  received_date: string;
  expiry_date: string | null;
  bin_location_id: string | null;
  bin_code: string | null;
  bin_name: string | null;
  status: string | null;
  notes: string | null;
  expiring_soon: boolean;
  expired: boolean;
}

export interface OrderLotTrace {
  order_id: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  lot_id: string;
  lot_number: string;
  supplier_lot: string | null;
  supplier_name: string | null;
  received_date: string;
  expiry_date: string | null;
  quantity_consumed: number;
  unit_cost: number | null;
  cost_impact: number;
  consumed_at: string;
  movement_id: string;
  description: string | null;
}

export interface LotIntakeInput {
  productId: string;
  quantity: number;
  unitCost?: number | null;
  supplierId?: string | null;
  supplierLot?: string | null;
  invoiceId?: string | null;
  binLocationId?: string | null;
  receivedDate?: string;
  expiryDate?: string | null;
  notes?: string | null;
}

export function useActiveLots() {
  return useQuery({
    queryKey: ['lots_active'],
    queryFn: async (): Promise<ActiveLot[]> => {
      const { data, error } = await (supabase as any)
        .from('v_lots_active')
        .select('*')
        .limit(500);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });
}

export function useOrderLotTrace(orderId: string | null | undefined) {
  return useQuery({
    queryKey: ['order_lot_traceability', orderId],
    enabled: !!orderId,
    queryFn: async (): Promise<OrderLotTrace[]> => {
      if (!orderId) return [];
      const { data, error } = await (supabase as any)
        .from('v_order_lot_traceability')
        .select('*')
        .eq('order_id', orderId);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });
}

export function useRecordLotIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LotIntakeInput): Promise<string> => {
      const { data, error } = await (supabase as any).rpc('record_lot_intake', {
        p_product_id: input.productId,
        p_quantity: input.quantity,
        p_unit_cost: input.unitCost ?? null,
        p_supplier_id: input.supplierId ?? null,
        p_supplier_lot: input.supplierLot ?? null,
        p_invoice_id: input.invoiceId ?? null,
        p_bin_location_id: input.binLocationId ?? null,
        p_received_date: input.receivedDate ?? new Date().toISOString().slice(0, 10),
        p_expiry_date: input.expiryDate ?? null,
        p_notes: input.notes ?? null,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lots_active'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Lote registrado');
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao registrar lote'),
  });
}

export function useConsumeFromLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lotId: string; orderId: string; quantity: number; notes?: string }) => {
      const { error } = await (supabase as any).rpc('consume_from_lot', {
        p_lot_id: input.lotId,
        p_order_id: input.orderId,
        p_quantity: input.quantity,
        p_notes: input.notes ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lots_active'] });
      qc.invalidateQueries({ queryKey: ['order_lot_traceability'] });
      toast.success('Consumo do lote registrado');
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao consumir lote'),
  });
}

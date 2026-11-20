import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { SizeGrade } from '@/lib/atelierSplit';

export interface OsAtivaRow {
  serviceOrderId: string;
  osNumber: string;
  contractorId: string | null;
  contractorName: string;
  internal: boolean;
  saleOrderId: string | null;
  saleOrderNumber: string | null;
  lotNumber: string | null;
  reference: string;
  color: string;
  sector: string | null;
  grade: SizeGrade;
  movableGrade: SizeGrade;
  planned: number;
  sent: number;
  unsent: number;
  received: number;
  unproduced: number;
  street: number;
  toSend: number;
  returnOn: string | null;
  late: boolean;
  capacityPerDay: number | null;
}

export interface OsRedistribuicaoRow {
  id: string;
  createdAt: string;
  actor: string;
  sourceOs: string;
  reason: string;
  pairs: number;
  unsentPairs: number;
  returnedPairs: number;
  grade: SizeGrade;
  moves: Array<{
    contractorId: string | null;
    contractorName: string;
    internal: boolean;
    grade: SizeGrade;
    orderNumber: string | null;
    streetPairs: number;
    unsentPairs: number;
  }>;
  payableAdjusted: number;
}

export function useActiveServiceOrders() {
  return useQuery({
    queryKey: ['os-ativas'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_active_service_order_board' as never);
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as OsAtivaRow[];
    },
  });
}

export function useServiceOrderRedistributions() {
  return useQuery({
    queryKey: ['os-redistribuicoes'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_service_order_redistributions' as never);
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as OsRedistribuicaoRow[];
    },
  });
}

export function useRedistributeServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sourceId: string;
      reason: string;
      take: SizeGrade;
      moves: Array<{ contractor_id: string | null; internal: boolean; grade: SizeGrade }>;
    }) => {
      const { data, error } = await supabase.rpc('redistribute_service_order' as never, {
        p_source: input.sourceId,
        p_reason: input.reason,
        p_take: input.take,
        p_moves: input.moves,
      } as never);
      if (error) throw error;
      return data as { alerts?: string[]; returnedPairs?: number; payableAdjusted?: number } | null;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['os-ativas'] });
      qc.invalidateQueries({ queryKey: ['os-redistribuicoes'] });
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['service_order_overview'] });
      const alerts = data?.alerts ?? [];
      if (data?.returnedPairs && data.returnedPairs > 0) {
        toast.success('Devolução sem produção registrada e o saldo foi para os outros prestadores.');
      } else {
        toast.success('Saldo redistribuído.');
      }
      alerts.forEach((alert) => toast.warning(alert));
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Não foi possível redistribuir.');
    },
  });
}

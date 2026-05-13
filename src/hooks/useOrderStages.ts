import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useEffect } from 'react';

// Default fallback stages when no BOM operations exist.
//
// IMPORTANTE: estes `name`s são gravados em `order_stages.stage_name` como
// TEXT. Mantemos "Mesa" aqui (não "Aviamento") porque:
//   • código antigo do banco e queries comparam `stage_name === 'Mesa'`;
//   • mudar criaria divergência com rows existentes.
// O label visível pro usuário é renderizado via STAGE_LABEL/SECTOR_ENUM_TO_DISPLAY
// (ver src/types/production-waves.ts) que mapeia "Mesa" → "Aviamento".
export const PRODUCTION_STAGES = [
  { name: 'Corte Palmilha', order: 1 },
  { name: 'Corte Forração', order: 2 },
  { name: 'Costura', order: 3 },
  { name: 'Mesa', order: 4 },
  { name: 'Silk', order: 5 },
  { name: 'Colagem', order: 6 },
  { name: 'Montagem', order: 7 },
  { name: 'Solagem', order: 8 },
  { name: 'Acabamento', order: 9 },
  { name: 'Expedição', order: 10 },
] as const;

export type OrderStage = {
  id: string;
  order_id: string;
  stage_name: string;
  stage_order: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  quantity_processed: number;
  quantity_total: number;
  observations: string;
  defects: string;
  created_at: string;
  updated_at: string;
  // WIP cost tracking fields
  standard_time_minutes: number;
  cost_per_hour: number;
  actual_time_minutes: number;
  cost_per_pair: number;
};

export function useOrderStages(orderId?: string) {
  return useQuery({
    queryKey: ['order_stages', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_stages')
        .select('*')
        .eq('order_id', orderId!)
        .order('stage_order', { ascending: true });
      if (error) throw error;
      return data as OrderStage[];
    },
    enabled: !!orderId,
  });
}

export function useAllOrderStages(orderIds?: string[]) {
  return useQuery({
    queryKey: ['order_stages', orderIds ? orderIds.sort().join(',') : 'all'],
    queryFn: async () => {
      // If specific order IDs provided, fetch only those
      if (orderIds && orderIds.length > 0) {
        // Batch in chunks of 50 to avoid query size limits
        const CHUNK = 50;
        let allData: OrderStage[] = [];
        for (let i = 0; i < orderIds.length; i += CHUNK) {
          const chunk = orderIds.slice(i, i + CHUNK);
          const { data, error } = await supabase
            .from('order_stages')
            .select('id, order_id, stage_name, stage_order, status, started_at, completed_at, completed_by, quantity_processed, quantity_total, observations, defects, created_at, updated_at, standard_time_minutes, cost_per_hour, actual_time_minutes, cost_per_pair')
            .in('order_id', chunk)
            .order('stage_order', { ascending: true });
          if (error) throw error;
          if (data) allData = allData.concat(data as OrderStage[]);
        }
        return allData;
      }

      // Fallback: fetch all with pagination
      const PAGE_SIZE = 1000;
      let allData: OrderStage[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('order_stages')
          .select('id, order_id, stage_name, stage_order, status, started_at, completed_at, completed_by, quantity_processed, quantity_total, observations, defects, created_at, updated_at, standard_time_minutes, cost_per_hour, actual_time_minutes, cost_per_pair')
          .order('stage_order', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          allData = allData.concat(data as OrderStage[]);
          from += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      return allData;
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * Creates order stages from BOM operations when available,
 * falls back to default PRODUCTION_STAGES otherwise.
 */
export function useCreateOrderStages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, quantity, referenceId }: { orderId: string; quantity: number; referenceId?: string }) => {
      // Idempotency: skip if stages already exist (e.g. created by useCreateOrder,
      // or user double-clicks handleInitStages). Avoids UNIQUE constraint violations.
      const { data: existing, error: existingErr } = await supabase
        .from('order_stages')
        .select('id')
        .eq('order_id', orderId)
        .limit(1);
      if (existingErr) throw existingErr;
      if (existing && existing.length > 0) {
        return; // stages already present — nothing to do
      }

      let rows: any[] = [];

      // Try to pull stages from BOM operations of the referenced sheet
      if (referenceId) {
        const { data: bomOps } = await supabase
          .from('bom_operations')
          .select('*')
          .eq('sheet_id', referenceId)
          .eq('active', true)
          .order('sort_order', { ascending: true });

        if (bomOps && bomOps.length > 0) {
          rows = bomOps.map((op, idx) => ({
            order_id: orderId,
            stage_name: op.operation_name || op.stage,
            stage_order: op.sort_order || idx + 1,
            status: 'pendente',
            quantity_total: quantity,
            quantity_processed: 0,
            observations: '',
            defects: '',
            standard_time_minutes: op.standard_time_minutes || 0,
            cost_per_hour: op.cost_per_hour || 0,
            cost_per_pair: op.cost_per_pair || 0,
            actual_time_minutes: 0,
          }));
        }
      }

      // Fallback: use production_sectors from technical sheet, or default stages
      if (rows.length === 0 && referenceId) {
        const { data: sheetData } = await supabase
          .from('technical_sheets')
          .select('production_sectors')
          .eq('id', referenceId)
          .single();

        const rawSectors = sheetData?.production_sectors;
        const sectors: string[] = Array.isArray(rawSectors) && rawSectors.length > 0
          ? rawSectors.map((s: any) => String(s))
          : PRODUCTION_STAGES.map(s => s.name);

        rows = sectors.map((name, idx) => {
          const defaultStage = PRODUCTION_STAGES.find(s => s.name === name);
          return {
            order_id: orderId,
            stage_name: name,
            stage_order: defaultStage?.order || idx + 1,
            status: 'pendente',
            quantity_total: quantity,
            quantity_processed: 0,
            observations: '',
            defects: '',
            standard_time_minutes: 0,
            cost_per_hour: 0,
            cost_per_pair: 0,
            actual_time_minutes: 0,
          };
        });
      }

      // Final fallback if no referenceId
      if (rows.length === 0) {
        rows = PRODUCTION_STAGES.map(s => ({
          order_id: orderId,
          stage_name: s.name,
          stage_order: s.order,
          status: 'pendente',
          quantity_total: quantity,
          quantity_processed: 0,
          observations: '',
          defects: '',
          standard_time_minutes: 0,
          cost_per_hour: 0,
          cost_per_pair: 0,
          actual_time_minutes: 0,
        }));
      }

      const { error } = await supabase.from('order_stages').insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order_stages'] });
    },
    onError: (err: Error) => toast.error(`Erro ao criar etapas: ${err.message}`),
  });
}

export function useUpdateOrderStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      id: string;
      status?: string;
      started_at?: string | null;
      completed_at?: string | null;
      completed_by?: string | null;
      operator_employee_id?: string | null;
      quantity_processed?: number;
      observations?: string;
      defects?: string;
      actual_time_minutes?: number;
    }) => {
      const { id, ...updates } = payload;
      // Predecessor-status guard: prevents two operators from racing on the
      // same stage transition (double-click iniciar, etc.).
      let q = supabase.from('order_stages').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
      if (payload.status === 'em_andamento') q = (q as any).eq('status', 'pendente');
      else if (payload.status === 'concluido') q = (q as any).eq('status', 'em_andamento');
      const { data: claimed, error } = await (q as any).select('id');
      if (error) throw error;
      if (payload.status && (!claimed || claimed.length === 0)) {
        throw new Error('Etapa já mudou de status — recarregue e tente novamente.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      toast.success('Etapa atualizada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useRealtimeOrderStages() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('order-stages-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_stages' }, () => {
        qc.invalidateQueries({ queryKey: ['order_stages'] });
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') console.warn('[realtime] order-stages:', err?.message);
      });
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

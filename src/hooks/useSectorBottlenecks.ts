import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type SectorKey = 'costura' | 'mesa' | 'corte_palmilha' | 'corte_forracao';

export interface ContributingOrder {
  order_id: string;
  order_number: string;
  sale_order_id: string | null;
  sheet_name: string | null;
  color: string | null;
  quantity: number;
  planned_delivery: string;
  pairs_per_day: number;
}

export interface SectorBottleneck {
  sector: SectorKey;
  week_start: string; // ISO date (Monday)
  iso_year: number;
  iso_week: number;
  ops_count: number;
  total_pairs_planned: number;
  total_capacity_week: number;
  utilization_pct: number;
  is_bottleneck: boolean;
  severity: 'ok' | 'warning' | 'critical';
  contributing_orders: ContributingOrder[];
}

export const SECTOR_LABEL: Record<SectorKey, string> = {
  costura: 'Costura',
  mesa: 'Aviamento',
  corte_palmilha: 'Corte Palmilha',
  corte_forracao: 'Corte Forração',
};

export function useSectorBottlenecks() {
  return useQuery({
    queryKey: ['v_sector_bottlenecks'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_sector_bottlenecks')
        .select('*')
        .order('week_start', { ascending: true })
        .order('sector', { ascending: true });
      if (error) throw error;
      return (data || []) as SectorBottleneck[];
    },
    staleTime: 60_000,
  });
}

// Apenas os gargalos REAIS (is_bottleneck=true), ordenados por severidade
export function useActiveBottlenecks() {
  const all = useSectorBottlenecks();
  const data = (all.data || []).filter(b => b.is_bottleneck).sort((a, b) => {
    const sev = { critical: 0, warning: 1, ok: 2 };
    if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
    return a.week_start.localeCompare(b.week_start);
  });
  return { ...all, data };
}

// OS ativas (não recebidas / não canceladas) pra um determinado gargalo
// (sector + week_start). Permite ao usuário ver se já encaminhou demanda
// e sugerir o mesmo terceirizado para a próxima.
export function useActiveOSForBottleneck(sector: SectorKey | null, weekStart: string | null) {
  return useQuery({
    queryKey: ['service_orders_active_bottleneck', sector, weekStart],
    enabled: !!sector && !!weekStart,
    queryFn: async () => {
      const FINALIZED = ['received', 'Concluído', 'concluido', 'finalizado', 'Finalizado', 'Cancelado', 'cancelled', 'cancelado'];
      const { data, error } = await (supabase as any)
        .from('service_orders')
        .select('id, order_number, contractor_id, quantity, unit_price, total_value, status, quoted_deadline, order_id, contractors:contractor_id(id, name, payment_days)')
        .eq('target_sector', sector)
        .eq('bottleneck_week', weekStart)
        .not('status', 'in', `(${FINALIZED.map(s => `"${s}"`).join(',')})`);
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 30_000,
  });
}

// Bulk: cria N service_orders (uma por OP) com o mesmo contratado/prazo/valor.
// Idempotente por order_id: se OP já tem OS ativa pra esse gargalo, pula.
export interface BulkAssignInput {
  contractor_id: string;
  target_sector: SectorKey;
  bottleneck_week: string;
  unit_price: number;
  quoted_deadline: string;
  contributing_orders: Array<{
    order_id: string;
    sale_order_id: string | null;
    quantity: number;
    order_number: string;
  }>;
}

export function useBulkAssignServiceOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkAssignInput) => {
      // Buscar OPs que JÁ TÊM OS ativa pra esse gargalo (evita duplicar)
      const FINALIZED = ['received', 'Concluído', 'concluido', 'finalizado', 'Finalizado', 'Cancelado', 'cancelled', 'cancelado'];
      const orderIds = input.contributing_orders.map(o => o.order_id);
      const { data: existing } = await (supabase as any)
        .from('service_orders')
        .select('order_id')
        .in('order_id', orderIds)
        .eq('target_sector', input.target_sector)
        .eq('bottleneck_week', input.bottleneck_week)
        .not('status', 'in', `(${FINALIZED.map(s => `"${s}"`).join(',')})`);
      const skippedOrderIds = new Set((existing || []).map((r: any) => r.order_id));

      const toCreate = input.contributing_orders.filter(o => !skippedOrderIds.has(o.order_id));
      if (toCreate.length === 0) {
        return { created: 0, skipped: skippedOrderIds.size };
      }

      const today = new Date().toISOString().slice(0, 10);
      // Lista completa de OPs que originaram a demanda — repetida em cada
      // OS pra dar contexto à contratada de qual lote ela está cobrindo.
      const allOpNumbers = input.contributing_orders.map(o => o.order_number).join(', ');
      const totalPairsInBatch = input.contributing_orders.reduce((s, o) => s + o.quantity, 0);
      const notesPrefix =
        `Demanda agregada do gargalo ${SECTOR_LABEL[input.target_sector]} ` +
        `(semana de ${input.bottleneck_week}).\n` +
        `OPs cobertas neste lote (${input.contributing_orders.length}): ${allOpNumbers}.\n` +
        `Total agregado do lote: ${totalPairsInBatch} pares.`;
      const rows = toCreate.map((o, i) => ({
        contractor_id: input.contractor_id,
        order_id: o.order_id,
        sale_order_id: o.sale_order_id,
        target_sector: input.target_sector,
        bottleneck_week: input.bottleneck_week,
        quantity: o.quantity,
        unit_price: input.unit_price,
        total_value: o.quantity * input.unit_price,
        service_date: today,
        status: 'quoted',
        quoted_at: new Date().toISOString(),
        quoted_deadline: input.quoted_deadline,
        description: `Cobertura de gargalo ${SECTOR_LABEL[input.target_sector]} (lote) — OP ${o.order_number}`,
        notes: notesPrefix,
        // Auditoria 28/05/2026: removido order_number manual — trigger
        // generate_so_number atribui OS-NNNNN sequencial. Antes os OS-GARG
        // ficavam de fora da numeração canônica e quebravam reports/sorts.
      }));

      const { error } = await (supabase as any).from('service_orders').insert(rows);
      if (error) throw error;
      return { created: rows.length, skipped: skippedOrderIds.size };
    },
    onSuccess: ({ created, skipped }) => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['service_orders_active_bottleneck'] });
      qc.invalidateQueries({ queryKey: ['v_sector_bottlenecks'] });
      let msg = `${created} ${created === 1 ? 'OS criada' : 'OSs criadas'}.`;
      if (skipped > 0) msg += ` ${skipped} ${skipped === 1 ? 'OP já tinha' : 'OPs já tinham'} OS ativa — ${skipped === 1 ? 'pulada' : 'puladas'}.`;
      toast.success(msg);
    },
    onError: (err: any) => {
      toast.error(`Falha no encaminhamento em lote: ${err.message || 'erro desconhecido'}`);
    },
  });
}

// Marcar peças como recebidas (status → 'received'). Destrava OP pra Montagem.
export function useReceiveServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ service_order_id, received_notes }: {
      service_order_id: string;
      received_notes?: string;
    }) => {
      const { error } = await (supabase as any)
        .from('service_orders')
        .update({
          status: 'received',
          notes: received_notes ?? undefined,
        })
        .eq('id', service_order_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      toast.success('Peças recebidas. A OP foi destravada pra Montagem.');
    },
    onError: (err: any) => {
      toast.error(`Falha ao marcar como recebida: ${err.message}`);
    },
  });
}

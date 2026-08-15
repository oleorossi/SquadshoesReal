import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { receiveServiceOrderFully } from '@/lib/serviceOrderStock';

// F1-02 (auditoria de motores 2026-07): v_sector_weekly_load/v_sector_bottlenecks
// foram reconstruídas sobre a cascata canônica do compute_wave_timeline e agora
// cobrem os 9 setores do fluxo (antes só 4).
export type SectorKey =
  | 'costura' | 'mesa' | 'corte_palmilha' | 'corte_forracao'
  | 'silk' | 'colagem' | 'montagem' | 'solagem' | 'acabamento';

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

// Inclui 'corte_cabedal' (não é setor de gargalo, mas é um target_sector
// válido de service_orders — OS geradas pelo modal Consumo de Materiais do
// PV) pra que Contractors.tsx e afins exibam o label amigável.
export const SECTOR_LABEL: Record<SectorKey | 'corte_cabedal', string> = {
  costura: 'Costura',
  mesa: 'Aviamento',
  corte_palmilha: 'Corte Palmilha',
  corte_forracao: 'Corte Forração',
  corte_cabedal: 'Corte Cabedal',
  silk: 'Silk',
  colagem: 'Colagem',
  montagem: 'Montagem',
  solagem: 'Solagem',
  acabamento: 'Acabamento',
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
      if (input.unit_price <= 0) throw new Error('Informe o valor por par antes de emitir as OSs.');
      // Lista completa de OPs que originaram a demanda — repetida em cada
      // OS pra dar contexto à contratada de qual lote ela está cobrindo.
      const allOpNumbers = input.contributing_orders.map(o => o.order_number).join(', ');
      const totalPairsInBatch = input.contributing_orders.reduce((s, o) => s + o.quantity, 0);
      const notesPrefix =
        `Demanda agregada do gargalo ${SECTOR_LABEL[input.target_sector]} ` +
        `(semana de ${input.bottleneck_week}).\n` +
        `OPs cobertas neste lote (${input.contributing_orders.length}): ${allOpNumbers}.\n` +
        `Total agregado do lote: ${totalPairsInBatch} pares.`;
      const byPv = new Map<string, BulkAssignInput['contributing_orders']>();
      let skipped = 0;
      for (const order of input.contributing_orders) {
        if (!order.sale_order_id) { skipped += 1; continue; }
        const current = byPv.get(order.sale_order_id) || [];
        current.push(order);
        byPv.set(order.sale_order_id, current);
      }

      let created = 0;
      const osIds: string[] = [];
      const failures: string[] = [];
      for (const [saleOrderId, orders] of byPv) {
        try {
          const { data, error } = await (supabase as any).rpc('generate_op_service_orders', {
            p_sale_order_id: saleOrderId,
            p_lines: orders.map((order) => ({
              order_id: order.order_id,
              sector: input.target_sector,
              contractor_id: input.contractor_id,
              quantity: order.quantity,
              unit_price: input.unit_price,
              quoted_deadline: input.quoted_deadline,
            })),
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          for (const result of data?.lines || []) {
            if (result.action === 'created' || result.action === 'reactivated') created += 1;
            else if (result.action === 'exists') skipped += 1;
            else failures.push(result.reason || 'OP não pertence ao PV');
            if (result.os_id) osIds.push(result.os_id);
          }
        } catch (error: any) {
          failures.push(`PV ${saleOrderId}: ${error?.message || 'erro desconhecido'}`);
        }
      }

      if (osIds.length > 0) {
        const { error } = await (supabase as any)
          .from('service_orders')
          .update({ bottleneck_week: input.bottleneck_week, quoted_at: new Date().toISOString(), notes: notesPrefix })
          .in('id', osIds);
        if (error) failures.push(`OS criada, mas sem metadados do gargalo: ${error.message}`);
      }
      return { created, skipped, failed: failures.length, firstFailure: failures[0] || null };
    },
    onSuccess: ({ created, skipped, failed, firstFailure }) => {
      let msg = `${created} ${created === 1 ? 'OS criada' : 'OSs criadas'}.`;
      if (skipped > 0) msg += ` ${skipped} ${skipped === 1 ? 'OP já tinha' : 'OPs já tinham'} OS ativa — ${skipped === 1 ? 'pulada' : 'puladas'}.`;
      if (failed > 0) {
        toast.warning(`${msg} ${failed} ${failed === 1 ? 'falha requer' : 'falhas requerem'} revisão. ${firstFailure || ''}`);
      } else {
        toast.success(msg);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['service_orders_active_bottleneck'] });
      qc.invalidateQueries({ queryKey: ['v_sector_bottlenecks'] });
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
      // NÃO fechar por update de status: a conta a pagar sairia pelo valor
      // cheio, ignorando refugo. O caminho único registra o retorno e deixa os
      // triggers fecharem a OS e emitirem a conta por pares bons.
      const { skipped } = await receiveServiceOrderFully(service_order_id, {
        notes: received_notes,
      });
      if (skipped) throw new Error('Esta OS já não tem pares na rua para receber.');
      if (received_notes) {
        await (supabase as any)
          .from('service_orders')
          .update({ notes: received_notes })
          .eq('id', service_order_id);
      }
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

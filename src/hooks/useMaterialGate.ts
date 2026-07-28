import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

/**
 * GATE DE MATERIAL DA OP (auditoria 2026-07-28 · Crítico #1)
 *
 * `orders.planned_start` era regressivo puro (entrega − Σ dias de setor) e
 * ignorava a disponibilidade de matéria-prima — dava pra planejar o Corte pra
 * 10/08 com a napa chegando só 15/08. Agora a OP carrega as duas datas:
 *
 *   planned_start_capacity → o regressivo puro (dono: trigger no banco)
 *   material_ready_date    → quando o material tem como chegar (NULL = sem falta)
 *   planned_start          → GREATEST(as duas) = a data honesta
 *
 * A conta de falta vem do MOTOR CANÔNICO (`get_wave_material_needs_core`, o
 * mesmo da onda e das compras) — não recriar aqui, divergir dele foi o Alto #4
 * da mesma auditoria.
 */

export interface MaterialGateFalta {
  product_id: string;
  product_name: string;
  color: string | null;
  unit: string | null;
  needed: number;
  stock: number;
  shortage: number;
  lead_days: number | null;
}

export interface MaterialGate {
  ok: boolean;
  faltas?: MaterialGateFalta[];
  faltas_count?: number;
  /** Faltas sem NENHUMA OC aberta — risco puro: ninguém comprou ainda. */
  sem_oc?: number;
  lead_days?: number;
  ready_date?: string | null;
  /** Data prometida (ou "comprar até") da OC aberta mais tardia. */
  pior_eta_oc?: string | null;
  sale_order_id?: string;
  motivo?: string;
}

/**
 * Recalcula o gate das OPs vivas dos PVs informados. Idempotente — rodar 2×
 * no mesmo PV não muda nada. Silencioso de propósito: é efeito colateral de
 * aprovar/promover PV, não pode derrubar o fluxo se falhar.
 */
export async function recomputeMaterialGate(saleOrderIds: string[]): Promise<void> {
  const ids = Array.from(new Set(saleOrderIds.filter(Boolean)));
  if (ids.length === 0) return;
  try {
    const { error } = await (supabase as any).rpc('recompute_material_gate_for_sale_orders', {
      p_sale_order_ids: ids,
    });
    if (error) console.warn('[recomputeMaterialGate] falhou:', error.message);
  } catch (err: any) {
    console.warn('[recomputeMaterialGate] falhou:', err?.message);
  }
}

/** Gate de UMA OP, com as faltas detalhadas e a ETA da OC aberta. */
export function useOrderMaterialGate(orderId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['order-material-gate', orderId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('check_order_material_gate', {
        p_order_id: orderId,
      });
      if (error) throw error;
      return (data ?? { ok: true }) as MaterialGate;
    },
    enabled: !!orderId && enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export interface OrderGateRow {
  ready_date: string;
  reason: string | null;
}

/**
 * Mapa `order_id → gate` das OPs informadas. Consulta rasa (3 colunas) em vez
 * de engordar `v_production_queue_detail` — a view alimenta o motor de fila e
 * não vale o risco de mexer nela só pra um badge.
 */
export function useOrdersMaterialGate(orderIds: string[]) {
  const ids = Array.from(new Set(orderIds.filter(Boolean)));
  return useQuery({
    queryKey: ['orders-material-gate', ids.length, ids[0] ?? ''],
    queryFn: async () => {
      const map = new Map<string, OrderGateRow>();
      if (ids.length === 0) return map;
      const { data, error } = await supabase
        .from('orders')
        .select('id, material_ready_date, material_gate_reason')
        .in('id', ids)
        .not('material_ready_date', 'is', null);
      if (error) throw error;
      for (const row of (data ?? []) as any[]) {
        map.set(row.id, { ready_date: row.material_ready_date, reason: row.material_gate_reason });
      }
      return map;
    },
    enabled: ids.length > 0,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/** Recompute manual (botão do PCP) — esse avisa o usuário do resultado. */
export function useRecomputeMaterialGate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (saleOrderIds: string[]) => {
      const ids = Array.from(new Set(saleOrderIds.filter(Boolean)));
      if (ids.length === 0) return { travados: 0, orders_updated: 0 };
      const { data, error } = await (supabase as any).rpc('recompute_material_gate_for_sale_orders', {
        p_sale_order_ids: ids,
      });
      if (error) throw error;
      return data as { travados: number; orders_updated: number };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-material-gate'] });
      const travados = Number(res?.travados ?? 0);
      if (travados > 0) {
        toast.warning(
          `${travados} pedido(s) com material em falta — o início do Corte foi empurrado pra data em que o material tem como chegar.`,
          { duration: 8000 },
        );
      } else {
        toast.success('Gate de material recalculado — nenhum pedido travado por falta.');
      }
    },
    onError: (err: any) => toast.error(`Falha ao recalcular gate de material: ${err.message}`),
  });
}
